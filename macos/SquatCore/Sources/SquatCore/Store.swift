import Foundation

/// The settings, with SETTINGS_DEFAULTS from extension/lib/store.js.
public struct Settings: Codable, Equatable, Sendable {
    public var intervalMin = 60
    public var areas: [String] = []
    public var activeStart = "09:00"
    public var activeEnd = "17:00"
    public var workdays = [1, 2, 3, 4, 5]
    public var autoPause = true
    public var privacy = true
    public var privacyStyle = "blur"
    public var voice = true
    public var memes = true
    public var mode = "personal"
    public var name = ""
    public var setupDone = false
    public var theme = "auto"
    public var avatar = "bunny"
    public var lang = "auto"
    public var weekStart = 1

    public init() {}

    public var hours: Hours { Hours(activeStart: activeStart, activeEnd: activeEnd, workdays: workdays) }

    /// The keys of SETTINGS_DEFAULTS, in order.
    public static let keys = ["intervalMin", "areas", "activeStart", "activeEnd", "workdays", "autoPause", "privacy",
                              "privacyStyle", "voice", "memes", "mode", "name", "setupDone", "theme",
                              "avatar", "lang", "weekStart"]

    /// `{ ...SETTINGS_DEFAULTS, ...stored }`: a missing or mistyped value keeps its default.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        func take<T: Decodable>(_ key: CodingKeys, _ into: inout T) { if let v = try? c.decodeIfPresent(T.self, forKey: key) { into = v } }
        take(.intervalMin, &intervalMin); take(.areas, &areas); take(.activeStart, &activeStart); take(.activeEnd, &activeEnd)
        take(.workdays, &workdays); take(.autoPause, &autoPause); take(.privacy, &privacy); take(.privacyStyle, &privacyStyle)
        take(.voice, &voice); take(.memes, &memes); take(.mode, &mode); take(.name, &name)
        take(.setupDone, &setupDone); take(.theme, &theme); take(.avatar, &avatar); take(.lang, &lang); take(.weekStart, &weekStart)
    }

    /// The settings as a JSON object, for the sync merges.
    public var json: [String: JSONValue] { (try? JSONValue(encoding: self).object) ?? [:] }
}

/// chrome.storage.local for the Mac app: JSON values under string keys.
public protocol KeyValueStore: AnyObject {
    func get(_ key: String) -> JSONValue?
    func set(_ values: [String: JSONValue])
    func remove(_ keys: [String])
}

public final class MemoryStore: KeyValueStore {
    private var values: [String: JSONValue] = [:]
    public init() {}
    public func get(_ key: String) -> JSONValue? { values[key] }
    public func set(_ values: [String: JSONValue]) { self.values.merge(values) { $1 } }
    public func remove(_ keys: [String]) { for k in keys { values[k] = nil } }
}

/// A JSON file, read once and rewritten atomically on every change.
public final class FileStore: KeyValueStore {
    private let url: URL
    private let lock = NSLock()
    private var values: [String: JSONValue]

    public init(url: URL) {
        self.url = url
        let data = try? Data(contentsOf: url)
        values = data.flatMap { try? JSONDecoder().decode([String: JSONValue].self, from: $0) } ?? [:]
    }

    public func get(_ key: String) -> JSONValue? {
        lock.lock(); defer { lock.unlock() }
        return values[key]
    }

    public func set(_ values: [String: JSONValue]) {
        lock.lock(); defer { lock.unlock() }
        self.values.merge(values) { $1 }
        save()
    }

    public func remove(_ keys: [String]) {
        lock.lock(); defer { lock.unlock() }
        for k in keys { values[k] = nil }
        save()
    }

    /// Call with the lock held.
    private func save() {
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(self.values).write(to: url, options: .atomic)
        } catch {
            NSLog("Squat Overflow: can't save \(url.path): \(error)")
        }
    }
}

/// Typed access to the local data, port of extension/lib/store.js. Same keys as the extension.
public final class Store {
    public static let logMax = 500

    static let profileKey = "profile"
    static let scheduleKey = "schedule"
    static let logKey = "breakLog"
    static let memeTurnsKey = "memeTurns"
    static let activityKey = "activity"
    public static let outboxKey = "syncOutbox"
    public static let dirtyKey = "syncDirty"
    public static let syncStateKey = "syncState"
    public static let rejectedKey = "syncRejected"

    /// Keys an older version stored that nothing reads any more: the pose server's URL (the model
    /// runs on the device now) and the catalog it sent (RETIRED_KEYS in extension/lib/store.js).
    static let retiredKeys = ["serverUrl", "exerciseCatalog"]

    public let kv: KeyValueStore

    public init(_ kv: KeyValueStore) {
        self.kv = kv
    }

    /// dropRetiredKeys() in extension/lib/store.js; the app runs it at launch.
    public func dropRetiredKeys() {
        kv.remove(Store.retiredKeys)
    }

    func read<T: Decodable>(_ key: String, as: T.Type = T.self) -> T? { try? kv.get(key)?.decode(T.self) }

    func write<T: Encodable>(_ key: String, _ value: T) {
        if let v = try? JSONValue(encoding: value) { kv.set([key: v]) }
    }

    // MARK: Settings

    public func settings() -> Settings {
        var stored: [String: JSONValue] = [:]
        for k in Settings.keys { if let v = kv.get(k) { stored[k] = v } }
        var s = (try? JSONValue.object(stored).decode(Settings.self)) ?? Settings()
        s.areas = Routine.currentAreas(s.areas)
        return s
    }

    /// Saves settings. Shared settings whose value changed are marked with the time of the change,
    /// so the next sync sends them; settings pulled from the server use `applyRemote`.
    public func saveSettings(_ patch: [String: JSONValue], now: Millis) {
        let keys = SyncCore.changedSharedKeys(settings().json, patch)
        var values = patch
        if !keys.isEmpty { values[Store.dirtyKey] = (try? JSONValue(encoding: SyncCore.markDirty(dirty(), keys: keys, at: now))) ?? .null }
        kv.set(values)
    }

    /// Writes the server's values without marking them dirty.
    public func applyRemote(_ patch: [String: JSONValue]) { kv.set(patch) }

    public func dirty() -> [String: Millis] { read(Store.dirtyKey) ?? [:] }

    public func setDirty(_ dirty: [String: Millis]) { write(Store.dirtyKey, dirty) }

    // MARK: Profile and schedule

    public func profile() -> Profile {
        if let p: Profile = read(Store.profileKey), !p.playerId.isEmpty { return p }
        let p = Profile.fresh()
        setProfile(p)
        return p
    }

    public func setProfile(_ p: Profile) { write(Store.profileKey, p) }

    public func schedule() -> ScheduleState { read(Store.scheduleKey) ?? ScheduleState() }

    public func setSchedule(_ s: ScheduleState) { write(Store.scheduleKey, s) }

    // MARK: Break log and outbox

    public func log() -> [LogEntry] { read(Store.logKey) ?? [] }

    public func setLog(_ log: [LogEntry]) { write(Store.logKey, Array(log.suffix(Store.logMax))) }

    public func outbox() -> [BreakEvent] { read(Store.outboxKey) ?? [] }

    public func setOutbox(_ outbox: [BreakEvent]) { write(Store.outboxKey, outbox) }

    /// Logs a finished break and queues it for sync as an event with a fresh id; `areas` are the
    /// pain areas the break worked on.
    public func appendLog(_ entry: LogEntry, areas: [String], now: Millis) {
        let id = UUID().uuidString.lowercased()
        var e = entry
        e.id = id
        setLog(log() + [e])
        setOutbox(SyncCore.addToOutbox(outbox(), [SyncCore.breakEvent(entry, id: id, areas: areas, now: now)]))
    }

    // MARK: Activity, sounds

    public func activity() -> [String: DayActivity]? { read(Store.activityKey) }

    public func setActivity(_ a: [String: DayActivity]) { write(Store.activityKey, a) }

    /// Where each meme group left off, so breaks take turns.
    public func memeTurns() -> [String: Int] { read(Store.memeTurnsKey) ?? [:] }

    public func setMemeTurns(_ turns: [String: Int]) { write(Store.memeTurnsKey, turns) }
}
