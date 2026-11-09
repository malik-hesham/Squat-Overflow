import SquatCore
import XCTest

/// extension/lib/store.js: what the Mac app keeps locally, and how.
final class StoreTests: XCTestCase {
    private let now: Millis = 1_794_222_000_000 // Mon 9 Nov 2026, 12:00 in Berlin

    private func store(_ kv: KeyValueStore = MemoryStore()) -> Store {
        _ = Parity.fixture // time zone
        return Store(kv, defaultServerUrl: "ws://127.0.0.1:8765/ws")
    }

    func testSettingsDefaultToTheExtensionDefaults() throws {
        let expected = Parity.cases("store.constants")[0].out["SETTINGS_DEFAULTS"]!
        let got = try json(store().settings())
        XCTAssertTrue(sameJSON(got, expected), "\(got.canonical)")
    }

    func testLogKeepsTheExtensionsLimit() {
        XCTAssertEqual(Double(Store.logMax), Parity.cases("store.constants")[0].out["LOG_MAX"]?.number)
    }

    func testSavedAreasWithOldNamesReadAsTheCurrentAreas() {
        let s = store()
        s.saveSettings(["areas": .array([.string("Neck"), .string("Hips & glutes")])], now: now)
        XCTAssertEqual(s.settings().areas, ["Neck tension", "Lower back", "Knees"])
    }

    func testSavingAChangedSharedSettingMarksItForSync() {
        let s = store()
        s.saveSettings(["intervalMin": .number(45), "privacy": .bool(false), "voice": .bool(true)], now: now)
        XCTAssertEqual(s.settings().intervalMin, 45)
        XCTAssertEqual(s.settings().privacy, false)
        // voice didn't change and privacy isn't shared between devices
        XCTAssertEqual(s.dirty(), ["intervalMin": now])
        s.saveSettings(["voice": .bool(false)], now: now + 5)
        XCTAssertEqual(s.dirty(), ["intervalMin": now, "voice": now + 5])
    }

    func testProfileIsCreatedOnceWithRandomIds() {
        let kv = MemoryStore()
        let first = store(kv).profile()
        XCTAssertFalse(first.playerId.isEmpty)
        XCTAssertNotEqual(first.playerId, first.secret)
        XCTAssertEqual(store(kv).profile(), first)
    }

    func testScheduleMissingFieldsDefault() {
        let s = store()
        XCTAssertEqual(s.schedule(), ScheduleState())
        var next = BreakSchedule.initial(now: now, intervalMin: 60)
        next.lastKey = "neck_tilt"
        s.setSchedule(next)
        XCTAssertEqual(s.schedule(), next)
    }

    func testAppendLogGivesTheBreakAnIdAndQueuesItForSync() {
        let s = store()
        s.appendLog(LogEntry(at: now, reps: 18, moves: 3, score: 91, xp: 18, scored: true, completed: true), areas: ["Knees"], now: now)
        let log = s.log()
        XCTAssertEqual(log.count, 1)
        let id = try? XCTUnwrap(log[0].id)
        XCTAssertEqual(s.outbox().map(\.id), [id])
        XCTAssertEqual(s.outbox().first?.device, "mac")
        XCTAssertEqual(s.outbox().first?.areas, ["Knees"])
        XCTAssertEqual(s.outbox().first?.day, "2026-11-09")
    }

    func testLogKeepsTheNewest500() {
        let s = store()
        let entry = { (k: Int) in LogEntry(at: self.now + k, reps: 1, moves: 1, score: nil, xp: 0, scored: false, completed: false) }
        s.setLog((0..<498).map(entry))
        for k in 498..<505 { s.appendLog(entry(k), areas: [], now: now + k) }
        XCTAssertEqual(s.log().count, 500)
        XCTAssertEqual(s.log().first?.at, now + 5)
        XCTAssertEqual(s.log().last?.at, now + 504)
        XCTAssertEqual(s.outbox().count, 7)
    }

    func testCatalogCacheIgnoresAnEmptyList() {
        let s = store()
        let e = Exercise(key: "neck_tilt", label: "Neck tilt", category: "Neck tension", camera: "front", howTo: "Tilt")
        s.cacheCatalog([e])
        s.cacheCatalog([])
        XCTAssertEqual(s.catalog(), [e])
    }

    func testFileStoreKeepsValuesAcrossLaunches() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let url = dir.appendingPathComponent("store.json")
        store(FileStore(url: url)).saveSettings(["name": .string("Sam"), "setupDone": .bool(true)], now: now)
        let reopened = store(FileStore(url: url)).settings()
        XCTAssertEqual(reopened.name, "Sam")
        XCTAssertTrue(reopened.setupDone)
    }
}
