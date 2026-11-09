import Foundation

/// A non-2xx answer from the server.
public struct HTTPStatusError: Error, Equatable {
    public var status: Int
    public init(status: Int) { self.status = status }
}

/// The signed-in API: the app's implementation adds the bearer token and refreshes it.
@MainActor
public protocol SyncTransport: AnyObject {
    /// The signed-in user's id, or nil when signed out.
    func userId() async -> String?
    /// One request; throws HTTPStatusError for a non-2xx answer. Resolves nil for 204.
    func call(_ method: String, _ path: String, _ body: JSONValue?) async throws -> JSONValue?
}

public struct SyncOutcome: Equatable, Sendable {
    public var ok: Bool
    public var reason: String?
    public var pending = 0
    public var scheduleChanged = false
    public var lastBreakAt: Millis?
    public var profile: ServerProfile?
}

/// Where sync is up to, per account (STATE_KEY in extension/lib/sync.js).
struct SyncState: Codable, Equatable {
    var user: String?
    var cursor = 0
    var backfilled = false
    var seeded = false
    var progressJson: String?
}

/// Cross-device sync, ported from extension/lib/sync.js. Breaks wait in the outbox until POST
/// /sync/breaks takes them; other devices' breaks come back from GET /sync/breaks after a cursor.
/// Shared settings merge per field with PATCH /me/settings, badges and challenges go up with PUT
/// /me/progress, and XP, streak and week XP come from GET /me/profile, which the server derives
/// from every device's breaks. Storage changes between requests run without suspending, so they
/// can't interleave with the engine's.
@MainActor
public final class SyncClient {
    static let maxPages = 20
    static let outboxMaxBatches = 50

    private let store: Store
    private let transport: SyncTransport
    private let clock: () -> Millis
    private var running: Task<SyncOutcome, Never>?

    public init(store: Store, transport: SyncTransport, clock: @escaping () -> Millis) {
        self.store = store
        self.transport = transport
        self.clock = clock
    }

    private func state() -> SyncState { (try? store.kv.get(Store.syncStateKey)?.decode(SyncState.self)) ?? SyncState() }

    private func writeState(_ change: (inout SyncState) -> Void) {
        var s = state()
        change(&s)
        if let v = try? JSONValue(encoding: s) { store.kv.set([Store.syncStateKey: v]) }
    }

    private func localKeys(_ now: Millis) -> String { "day=\(XP.dayKey(now))&week=\(XP.isoWeek(now))" }

    /// One full sync, or the one already running: backfill (first time), push, settings, pull,
    /// progress, profile. `scheduleChanged` and `lastBreakAt` are for Engine.afterSync().
    public func syncNow() async -> SyncOutcome {
        if let running { return await running.value }
        let task = Task { await run() }
        running = task
        let out = await task.value
        running = nil
        return out
    }

    private func run() async -> SyncOutcome {
        do {
            guard let user = await transport.userId() else { return SyncOutcome(ok: false, reason: "signed-out") }
            prepare(user: user, now: clock())
            let pending = try await pushOutbox()
            let scheduleChanged = try await syncSettings()
            let before = try await pull()
            try await pushProgress()
            let profile = try decode(ServerProfile.self, try await transport.call("GET", "/me/profile?\(localKeys(clock()))", nil))
            // While breaks are still queued the server's totals miss them: keep the local profile until they're up.
            if pending == 0 && store.outbox().isEmpty {
                store.setProfile(SyncCore.mergeProfile(store.profile(), server: profile))
                let held = SyncCore.progressOf(badges: profile.badges ?? [], daily: profile.daily, weekly: profile.weekly)
                writeState { $0.progressJson = (try? JSONValue(encoding: held))?.canonical }
            }
            let moved = profile.lastBreakAt.map { $0 > before } ?? false
            return SyncOutcome(ok: true, pending: pending, scheduleChanged: scheduleChanged,
                               lastBreakAt: moved ? profile.lastBreakAt : nil, profile: profile)
        } catch let e as HTTPStatusError {
            return SyncOutcome(ok: false, reason: "http \(e.status)")
        } catch {
            return SyncOutcome(ok: false, reason: "offline")
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, _ value: JSONValue?) throws -> T {
        guard let value else { throw HTTPStatusError(status: 204) }
        return try value.decode(T.self)
    }

    /// Sync state belongs to one account: signing in as someone else starts over. The first sync
    /// for an account queues the whole local log, with UUIDv5 ids for breaks logged before sync.
    private func prepare(user: String, now: Millis) {
        if state().user != user { writeState { $0 = SyncState(user: user) } }
        guard !state().backfilled else { return }
        let r = SyncCore.backfillEvents(store.log(), playerId: store.profile().playerId, now: now)
        store.setLog(r.log)
        store.setOutbox(SyncCore.addToOutbox(store.outbox(), r.events))
        writeState { $0.backfilled = true }
    }

    /// Uploads the outbox in batches; a batch the server refuses (400) is set aside so it can't
    /// block the queue. Resolves how many events are still waiting.
    private func pushOutbox() async throws -> Int {
        for _ in 0..<Self.outboxMaxBatches {
            let batch = Array(store.outbox().prefix(SyncCore.pushBatch))
            if batch.isEmpty { break }
            do {
                _ = try await transport.call("POST", "/sync/breaks?\(localKeys(clock()))", .object(["events": try JSONValue(encoding: batch)]))
            } catch let e as HTTPStatusError where e.status == 400 {
                let rejected = (store.kv.get(Store.rejectedKey)?.array ?? []) + ((try? JSONValue(encoding: batch).array) ?? [])
                store.kv.set([Store.rejectedKey: .array(Array(rejected.suffix(SyncCore.pushBatch)))])
            }
            store.setOutbox(SyncCore.removeFromOutbox(store.outbox(), ids: batch.map(\.id)))
        }
        return store.outbox().count
    }

    /// Sends changed shared settings, seeds the ones the server has never seen, then writes the
    /// server's document locally. Resolves whether the break schedule's settings changed.
    private func syncSettings() async throws -> Bool {
        let dirty = store.dirty()
        let settings = store.settings()
        let (patches, invalid) = SyncCore.dirtyPatches(settings.json, dirty: dirty)
        var sent = Dictionary(uniqueKeysWithValues: invalid.map { ($0, dirty[$0] ?? 0) })
        for p in patches {
            do {
                _ = try await transport.call("PATCH", "/me/settings", try JSONValue(encoding: p))
            } catch let e as HTTPStatusError where e.status == 400 {
                // refused: dropped like a sent one, so it can't block every later sync
            }
            for k in p.patch.keys { sent[k] = p.at }
        }
        if !sent.isEmpty { store.setDirty(SyncCore.clearDirty(store.dirty(), sent: sent)) }

        var doc = try await transport.call("GET", "/me/settings", nil)?["doc"]?.object ?? [:]
        if !state().seeded && settings.setupDone {
            let seed = SyncCore.seedPatch(settings.json, doc: doc)
            if !seed.isEmpty {
                do {
                    let res = try await transport.call("PATCH", "/me/settings", .object(["patch": .object(seed), "at": .number(Double(SyncCore.minAt))]))
                    doc = res?["doc"]?.object ?? doc
                } catch let e as HTTPStatusError where e.status == 400 {}
            }
            writeState { $0.seeded = true }
        }
        let cur = store.settings()
        let patch = SyncCore.remotePatch(cur.json, doc: doc, dirty: store.dirty())
        if patch.isEmpty { return false }
        store.applyRemote(patch) // the server's values, not changes made here
        let next = store.settings()
        return cur.setupDone && BreakSchedule.settingsChanged((cur.hours, cur.intervalMin), (next.hours, next.intervalMin))
    }

    /// Pulls other devices' breaks into the log and activity. Resolves the newest break time the
    /// log had before, for the shared timer rule.
    private func pull() async throws -> Millis {
        let before = SyncCore.lastBreakAt(store.log())
        for _ in 0..<Self.maxPages {
            let res = try await transport.call("GET", "/sync/breaks?since=\(state().cursor)&limit=\(SyncCore.pullLimit)", nil)
            let events = try (res?["events"] ?? .array([])).decode([BreakEvent].self)
            let log = store.log()
            let merged = SyncCore.mergeLog(log, events: events, max: Store.logMax)
            if !merged.added.isEmpty {
                var activity = store.activity() ?? Activity.backfill(log.map { ($0.at, $0.xp) })
                for e in merged.added { activity = Activity.record(activity, now: e.at, xp: e.xp) }
                store.setLog(merged.log)
                store.setActivity(activity)
            }
            let next = res?["next"]?.int ?? state().cursor
            writeState { $0.cursor = next }
            if events.count < SyncCore.pullLimit { break }
        }
        return before
    }

    /// PUT /me/progress when badges or challenges changed here since the server last had them.
    private func pushProgress() async throws {
        let progress = try JSONValue(encoding: SyncCore.progressOf(store.profile()))
        if progress.canonical == state().progressJson { return }
        var body = progress.object ?? [:]
        body["at"] = .number(Double(clock()))
        _ = try await transport.call("PUT", "/me/progress", .object(body))
    }
}
