import SquatCore
import XCTest

/// extension/lib/sync.js against an in-memory copy of the server's sync API (server/src/sync).
@MainActor
final class SyncClientTests: XCTestCase {
    /// The server: break events, a settings document, progress, and a derived profile.
    final class FakeServer: SyncTransport {
        var user: String? = "user-1"
        var offline = false
        var refuseBreaks = false
        var events: [JSONValue] = []
        var doc: [String: JSONValue] = [:]
        var progress: JSONValue?
        var profile: [String: JSONValue] = ["xp": .number(0), "streak": .number(0), "week": .string("2026-W46"), "weekXp": .number(0)]
        var requests: [(method: String, path: String, body: JSONValue?)] = []

        func userId() async -> String? { user }

        func call(_ method: String, _ path: String, _ body: JSONValue?) async throws -> JSONValue? {
            if offline { throw URLError(.notConnectedToInternet) }
            requests.append((method, path, body))
            let route = path.split(separator: "?").first.map(String.init) ?? path
            switch (method, route) {
            case ("POST", "/sync/breaks"):
                if refuseBreaks { throw HTTPStatusError(status: 400) }
                let incoming = body?["events"]?.array ?? []
                for e in incoming where !events.contains(where: { $0["id"] == e["id"] }) { events.append(e) }
                return .object(["accepted": .number(Double(incoming.count))])
            case ("GET", "/sync/breaks"):
                let since = Int(path.components(separatedBy: "since=").last?.components(separatedBy: "&").first ?? "0") ?? 0
                let page = Array(events.dropFirst(since))
                return .object(["events": .array(page), "next": .number(Double(events.count))])
            case ("GET", "/me/settings"):
                return .object(["doc": .object(doc), "version": .number(1)])
            case ("PATCH", "/me/settings"):
                for (k, v) in body?["patch"]?.object ?? [:] { doc[k] = v }
                return .object(["doc": .object(doc), "version": .number(2)])
            case ("PUT", "/me/progress"):
                progress = body
                return nil
            case ("GET", "/me/profile"):
                return .object(profile)
            default:
                throw HTTPStatusError(status: 404)
            }
        }

        func calls(_ method: String, _ route: String) -> Int {
            requests.filter { $0.method == method && $0.path.hasPrefix(route) }.count
        }
    }

    var store: Store!
    var server: FakeServer!
    var client: SyncClient!
    let now: Millis = 1_794_222_000_000 // Mon 9 Nov 2026, 12:00 in Berlin

    override func setUp() async throws {
        _ = Parity.fixture
        store = Store(MemoryStore())
        server = FakeServer()
        client = SyncClient(store: store, transport: server, clock: { [unowned self] in self.now })
    }

    private func entry(_ at: Millis, xp: Int = 7) -> LogEntry {
        LogEntry(at: at, reps: 6, moves: 1, score: 80, xp: xp, scored: true, completed: true)
    }

    func testSignedOutDoesNothing() async {
        server.user = nil
        let out = await client.syncNow()
        XCTAssertFalse(out.ok)
        XCTAssertEqual(out.reason, "signed-out")
        XCTAssertTrue(server.requests.isEmpty)
    }

    func testOfflineKeepsTheOutbox() async {
        store.appendLog(entry(now - hourMs), areas: [], now: now)
        server.offline = true
        let out = await client.syncNow()
        XCTAssertFalse(out.ok)
        XCTAssertEqual(out.reason, "offline")
        XCTAssertEqual(store.outbox().count, 1)
    }

    func testFirstSyncUploadsTheWholeLogOnce() async {
        store.setLog([entry(now - 2 * dayMs), entry(now - dayMs)]) // logged before signing in: no ids
        store.appendLog(entry(now - hourMs), areas: ["Knees"], now: now)
        let out = await client.syncNow()
        XCTAssertTrue(out.ok)
        XCTAssertEqual(out.pending, 0)
        XCTAssertEqual(server.events.count, 3)
        XCTAssertTrue(store.log().allSatisfy { $0.id != nil })
        XCTAssertTrue(server.events.contains { $0["id"]?.string == SyncCore.backfillId(playerId: store.profile().playerId, at: now - 2 * dayMs) })
        XCTAssertTrue(store.outbox().isEmpty)
        _ = await client.syncNow()
        XCTAssertEqual(server.events.count, 3)
        XCTAssertEqual(server.calls("POST", "/sync/breaks"), 1)
    }

    func testARefusedBatchIsSetAsideSoItCantBlockTheQueue() async {
        store.appendLog(entry(now - hourMs), areas: [], now: now)
        server.refuseBreaks = true
        let out = await client.syncNow()
        XCTAssertTrue(out.ok)
        XCTAssertTrue(store.outbox().isEmpty)
        XCTAssertEqual(store.kv.get(Store.rejectedKey)?.array?.count, 1)
    }

    func testChangedSettingsGoUpWithTheirChangeTime() async {
        store.saveSettings(["setupDone": .bool(true)], now: now)
        _ = await client.syncNow() // seeds the server
        store.saveSettings(["intervalMin": .number(45)], now: now + 1000)
        _ = await client.syncNow()
        let patch = server.requests.last { $0.method == "PATCH" }?.body
        XCTAssertEqual(patch?["patch"], .object(["intervalMin": .number(45)]))
        XCTAssertEqual(patch?["at"]?.int, now + 1000)
        XCTAssertTrue(store.dirty().isEmpty)
    }

    func testFirstSyncSeedsSettingsTheServerHasNeverSeen() async {
        store.saveSettings(["setupDone": .bool(true), "name": .string("Sam")], now: now)
        server.doc = ["intervalMin": .number(30)]
        _ = await client.syncNow()
        // "name" changed here, so it went up with its own change time; the rest is seeded with the oldest time
        let seed = server.requests.first { $0.method == "PATCH" && $0.body?["at"]?.int == SyncCore.minAt }?.body
        XCTAssertNotNil(seed)
        XCTAssertNil(seed?["patch"]?["intervalMin"]) // another device's value wins
        XCTAssertEqual(seed?["patch"]?["voice"], .bool(true))
        XCTAssertEqual(server.doc["name"], .string("Sam"))
        XCTAssertEqual(store.settings().intervalMin, 30)
        _ = await client.syncNow()
        XCTAssertEqual(server.requests.filter { $0.body?["at"]?.int == SyncCore.minAt }.count, 1) // seeded once
    }

    func testRemoteScheduleSettingsAreAppliedWithoutMarkingThemDirty() async {
        store.saveSettings(["setupDone": .bool(true)], now: now)
        _ = await client.syncNow()
        server.doc["activeStart"] = .string("08:00")
        let out = await client.syncNow()
        XCTAssertTrue(out.scheduleChanged)
        XCTAssertEqual(store.settings().activeStart, "08:00")
        XCTAssertTrue(store.dirty().isEmpty)
    }

    func testOtherDevicesBreaksArePulledIntoTheLogAndActivity() async {
        server.events = [.object([
            "id": .string("phone-1"), "at": .number(Double(now - hourMs)), "reps": .number(12), "moves": .number(2),
            "score": .number(88), "xp": .number(9), "scored": .bool(true), "completed": .bool(false),
            "device": .string("ios"), "areas": .array([.string("Knees")]),
        ])]
        server.profile["lastBreakAt"] = .number(Double(now - hourMs))
        let out = await client.syncNow()
        XCTAssertEqual(store.log().map(\.id), ["phone-1"])
        XCTAssertEqual(store.log().first?.device, "ios")
        XCTAssertEqual(store.activity()?["2026-11-09"], DayActivity(breaks: 1, xp: 9))
        XCTAssertEqual(out.lastBreakAt, now - hourMs)
        _ = await client.syncNow()
        XCTAssertEqual(store.log().count, 1)
    }

    func testLastBreakAtIsOnlyReportedWhenNewerThanTheLocalLog() async {
        store.appendLog(entry(now - hourMs), areas: [], now: now)
        server.profile["lastBreakAt"] = .number(Double(now - hourMs))
        let out = await client.syncNow()
        XCTAssertNil(out.lastBreakAt)
    }

    func testServerTotalsReplaceTheLocalOnesOnceNothingIsQueued() async {
        server.profile = ["xp": .number(320), "streak": .number(4), "week": .string("2026-W46"), "weekXp": .number(55),
                          "lastBreakDay": .string("2026-11-09"), "badges": .array([.string("daily:variety")])]
        _ = await client.syncNow()
        XCTAssertEqual(store.profile().xp, 320)
        XCTAssertEqual(store.profile().streak, 4)
        XCTAssertEqual(store.profile().badges, ["daily:variety"])
    }

    func testProgressIsOnlyPutWhenItChanged() async {
        var p = store.profile()
        p.badges = ["daily:high_five"]
        store.setProfile(p)
        server.profile["badges"] = .array([.string("daily:high_five")])
        _ = await client.syncNow()
        XCTAssertEqual(server.calls("PUT", "/me/progress"), 1)
        XCTAssertEqual(server.progress?["badges"], .array([.string("daily:high_five")]))
        _ = await client.syncNow()
        XCTAssertEqual(server.calls("PUT", "/me/progress"), 1)
    }

    func testSigningInAsSomeoneElseStartsOver() async {
        store.appendLog(entry(now - hourMs), areas: [], now: now)
        _ = await client.syncNow()
        server.user = "user-2"
        server.events = []
        _ = await client.syncNow()
        XCTAssertEqual(server.events.count, 1) // the log was queued again for the new account
        XCTAssertTrue(server.requests.contains { $0.path.hasPrefix("/sync/breaks?since=0") && $0.method == "GET" })
    }
}
