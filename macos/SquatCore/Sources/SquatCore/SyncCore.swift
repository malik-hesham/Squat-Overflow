import CryptoKit
import Foundation

/// A finished break in the local log (appendLog() in extension/lib/store.js). Breaks pulled from
/// other devices also carry their `device`.
public struct LogEntry: Codable, Equatable, Sendable {
    public var at: Millis
    public var reps = 0
    public var moves = 0
    public var score: Int?
    public var xp = 0
    public var scored = false
    public var completed = false
    public var id: String?
    public var device: String?
    public var areas: [String]?

    public init(at: Millis, reps: Int, moves: Int, score: Int?, xp: Int, scored: Bool, completed: Bool,
                id: String? = nil, device: String? = nil, areas: [String]? = nil) {
        self.at = at; self.reps = reps; self.moves = moves; self.score = score; self.xp = xp
        self.scored = scored; self.completed = completed; self.id = id; self.device = device; self.areas = areas
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        at = try c.decode(Millis.self, forKey: .at)
        reps = try c.decodeIfPresent(Int.self, forKey: .reps) ?? 0
        moves = try c.decodeIfPresent(Int.self, forKey: .moves) ?? 0
        score = try c.decodeIfPresent(Int.self, forKey: .score)
        xp = try c.decodeIfPresent(Int.self, forKey: .xp) ?? 0
        scored = try c.decodeIfPresent(Bool.self, forKey: .scored) ?? false
        completed = try c.decodeIfPresent(Bool.self, forKey: .completed) ?? false
        id = try c.decodeIfPresent(String.self, forKey: .id)
        device = try c.decodeIfPresent(String.self, forKey: .device)
        areas = try c.decodeIfPresent([String].self, forKey: .areas)
    }
}

/// A break as POST /sync/breaks takes it (server/src/sync/validate.ts).
public struct BreakEvent: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var at: Millis
    public var day: String
    public var week: String
    public var device: String
    public var reps: Int
    public var moves: Int
    public var score: Int?
    public var xp: Int
    public var scored: Bool
    public var completed: Bool
    public var areas: [String]

    public init(id: String, at: Millis, day: String, week: String, device: String, reps: Int, moves: Int, score: Int?,
                xp: Int, scored: Bool, completed: Bool, areas: [String]) {
        self.id = id; self.at = at; self.day = day; self.week = week; self.device = device; self.reps = reps
        self.moves = moves; self.score = score; self.xp = xp; self.scored = scored; self.completed = completed; self.areas = areas
    }

    /// Pulled events only need what mergeLog() reads; the rest default.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        at = try c.decode(Millis.self, forKey: .at)
        day = try c.decodeIfPresent(String.self, forKey: .day) ?? ""
        week = try c.decodeIfPresent(String.self, forKey: .week) ?? ""
        device = try c.decodeIfPresent(String.self, forKey: .device) ?? ""
        reps = try c.decodeIfPresent(Int.self, forKey: .reps) ?? 0
        moves = try c.decodeIfPresent(Int.self, forKey: .moves) ?? 0
        score = try c.decodeIfPresent(Int.self, forKey: .score)
        xp = try c.decodeIfPresent(Int.self, forKey: .xp) ?? 0
        scored = try c.decodeIfPresent(Bool.self, forKey: .scored) ?? false
        completed = try c.decodeIfPresent(Bool.self, forKey: .completed) ?? false
        areas = try c.decodeIfPresent([String].self, forKey: .areas) ?? []
    }
}

/// GET /me/profile (server/src/sync/profile.ts).
public struct ServerProfile: Codable, Equatable, Sendable {
    public var xp: Int
    public var streak: Int
    public var week: String?
    public var weekXp: Int
    public var lastBreakDay: String?
    public var badges: [String]?
    public var daily: Daily?
    public var weekly: Weekly?
    public var level: Int?
    public var levelName: String?
    public var day: String?
    public var todayBreaks: Int?
    public var breaks: Int?
    public var lastBreakAt: Millis?
}

/// PUT /me/progress body, without its `at`.
public struct Progress: Codable, Equatable, Sendable {
    public var badges: [String]
    public var daily: Daily?
    public var weekly: Weekly?
}

/// A PATCH /me/settings body: the fields that changed at `at`.
public struct SettingsPatch: Codable, Equatable, Sendable {
    public var patch: [String: JSONValue]
    public var at: Millis
}

/// Port of extension/lib/sync-core.js, the pure half of cross-device sync: break events, the
/// outbox, and the per-field settings and profile merges.
public enum SyncCore {
    public static let outboxMax = 2000
    public static let pushBatch = 200
    public static let pullLimit = 500
    /// The server refuses breaks before this and more than `maxFutureMs` ahead.
    public static let minAt: Millis = 1_704_067_200_000 // Date.UTC(2024, 0, 1)
    static let maxFutureMs: Millis = 24 * hourMs
    /// Namespace for backfill ids: UUIDv5(`${playerId}:${at}`).
    public static let backfillNamespace = "240ab37e-ad3a-409a-a2f2-29f50c8e346d"
    /// This client, as server/src/sync/validate.ts lists it.
    public static let device = "mac"
    static let maxChallengeJSON = 4_096

    // MARK: Shared settings

    static func intIn(_ v: JSONValue?, _ lo: Int, _ hi: Int) -> Bool {
        guard let n = v?.number, n.rounded() == n else { return false }
        return n >= Double(lo) && n <= Double(hi)
    }

    static func strIn(_ v: JSONValue?, _ lo: Int, _ hi: Int) -> Bool {
        guard let s = v?.string else { return false }
        return (lo...hi).contains(s.utf16.count)
    }

    static func matches(_ s: String, _ pattern: String) -> Bool { s.range(of: pattern, options: .regularExpression) != nil }

    /// Settings every device shares, with the server's check for each (SHARED_SETTINGS in validate.ts).
    static let validators: [(key: String, valid: (JSONValue) -> Bool)] = [
        ("intervalMin", { intIn($0, 1, 240) }),
        ("areas", { v in v.array.map { $0.count <= 20 && $0.allSatisfy { strIn($0, 1, 40) } } ?? false }),
        ("activeStart", { v in v.string.map { matches($0, "^([01][0-9]|2[0-3]):[0-5][0-9]$") } ?? false }),
        ("activeEnd", { v in v.string.map { matches($0, "^([01][0-9]|2[0-3]):[0-5][0-9]$") } ?? false }),
        ("workdays", { v in
            guard let a = v.array, a.count <= 7, a.allSatisfy({ intIn($0, 0, 6) }) else { return false }
            return Set(a.compactMap(\.number)).count == a.count
        }),
        ("autoPause", { $0.bool != nil }),
        ("voice", { $0.bool != nil }),
        ("memes", { $0.bool != nil }),
        ("mode", { $0 == .string("personal") || $0 == .string("competitive") }),
        ("name", { v in v.string.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count <= 40 } ?? false }),
        ("avatar", { v in v.string.map { matches($0, "^[a-z]{2,20}$") } ?? false }),
        ("lang", { v in v.string.map { matches($0, "^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$") } ?? false }),
        ("weekStart", { intIn($0, 0, 6) }),
    ]

    public static let sharedKeys = validators.map(\.key)

    static func validShared(_ key: String, _ value: JSONValue?) -> Bool {
        guard let value, let check = validators.first(where: { $0.key == key }) else { return false }
        return check.valid(value)
    }

    static func same(_ a: JSONValue?, _ b: JSONValue?) -> Bool { (a ?? .null).canonical == (b ?? .null).canonical }

    /// Shared settings whose value differs between `prev` and the patch `next`.
    public static func changedSharedKeys(_ prev: [String: JSONValue], _ next: [String: JSONValue]) -> [String] {
        sharedKeys.filter { next[$0] != nil && !same(prev[$0], next[$0]) }
    }

    /// Records that `keys` changed on this device at `at`, for the next PATCH /me/settings.
    public static func markDirty(_ dirty: [String: Millis], keys: [String], at: Millis) -> [String: Millis] {
        var out = dirty
        for k in keys { out[k] = at }
        return out
    }

    /// The PATCH bodies for unsent setting changes, one per change time, oldest first. `invalid`
    /// are dirty keys the server would refuse.
    public static func dirtyPatches(_ settings: [String: JSONValue], dirty: [String: Millis]) -> (patches: [SettingsPatch], invalid: [String]) {
        var byAt: [Millis: [String: JSONValue]] = [:]
        var invalid: [String] = []
        for (key, at) in dirty {
            guard validShared(key, settings[key]), at >= minAt else {
                invalid.append(key)
                continue
            }
            byAt[at, default: [:]][key] = settings[key]
        }
        let patches = byAt.keys.sorted().map { SettingsPatch(patch: byAt[$0]!, at: $0) }
        return (patches, invalid)
    }

    /// Drops the dirty marks that were sent, unless the field changed again since.
    public static func clearDirty(_ dirty: [String: Millis]?, sent: [String: Millis]) -> [String: Millis] {
        (dirty ?? [:]).filter { k, at in sent[k].map { at > $0 } ?? true }
    }

    /// Shared settings the server has never seen, from this device's values.
    public static func seedPatch(_ settings: [String: JSONValue], doc: [String: JSONValue]) -> [String: JSONValue] {
        var out: [String: JSONValue] = [:]
        for k in sharedKeys where doc[k] == nil && validShared(k, settings[k]) { out[k] = settings[k] }
        return out
    }

    /// The server's settings to write locally: valid shared keys that differ and have no unsent local change.
    public static func remotePatch(_ settings: [String: JSONValue], doc: [String: JSONValue]?, dirty: [String: Millis]?) -> [String: JSONValue] {
        (doc ?? [:]).filter { k, v in validShared(k, v) && dirty?[k] == nil && !same(settings[k], v) }
    }

    // MARK: Breaks

    static func clamp(_ v: Int, _ lo: Int, _ hi: Int) -> Int { min(hi, max(lo, v)) }

    /// A log entry as the server takes it, or nil when `at` is outside what the server accepts.
    public static func breakEvent(_ entry: LogEntry, id: String, areas: [String], device: String = device, now: Millis) -> BreakEvent? {
        let at = max(0, entry.at)
        guard at >= minAt, at <= now + maxFutureMs else { return nil }
        return BreakEvent(
            id: id, at: at, day: XP.dayKey(at), week: XP.isoWeek(at), device: device,
            reps: clamp(entry.reps, 0, 10_000), moves: clamp(entry.moves, 0, 100),
            score: entry.score.map { clamp($0, 0, 100) }, xp: clamp(entry.xp, 0, 1_000),
            scored: entry.scored, completed: entry.completed,
            areas: Array(areas.filter { (1...40).contains($0.utf16.count) }.prefix(20)))
    }

    /// RFC 4122 name-based UUID (version 5, SHA-1).
    public static func uuidv5(_ name: String, namespace: String) -> String {
        let hexNS = namespace.replacingOccurrences(of: "-", with: "")
        var bytes: [UInt8] = stride(from: 0, to: hexNS.count, by: 2).map {
            let i = hexNS.index(hexNS.startIndex, offsetBy: $0)
            return UInt8(hexNS[i..<hexNS.index(i, offsetBy: 2)], radix: 16) ?? 0
        }
        bytes += Array(name.utf8)
        var b = Array(Insecure.SHA1.hash(data: bytes).prefix(16))
        b[6] = (b[6] & 0x0f) | 0x50
        b[8] = (b[8] & 0x3f) | 0x80
        let h = b.map { String(format: "%02x", $0) }.joined()
        func part(_ from: Int, _ to: Int) -> Substring { h[h.index(h.startIndex, offsetBy: from)..<h.index(h.startIndex, offsetBy: to)] }
        return "\(part(0, 8))-\(part(8, 12))-\(part(12, 16))-\(part(16, 20))-\(part(20, 32))"
    }

    /// The id of a break logged before sync: the same on every upload of the same log.
    public static func backfillId(playerId: String, at: Millis) -> String { uuidv5("\(playerId):\(at)", namespace: backfillNamespace) }

    /// The events to upload on the first sync after sign-in, and the log with every entry holding
    /// its event id. Entries pulled from other devices (they have a `device`) aren't re-uploaded.
    public static func backfillEvents(_ log: [LogEntry], playerId: String, now: Millis) -> (events: [BreakEvent], log: [LogEntry]) {
        var events: [BreakEvent] = []
        var out: [LogEntry] = []
        for entry in log {
            let id = entry.id ?? backfillId(playerId: playerId, at: entry.at)
            var withId = entry
            withId.id = id
            out.append(withId)
            if entry.device != nil { continue }
            if let ev = breakEvent(entry, id: id, areas: entry.areas ?? [], now: now) { events.append(ev) }
        }
        return (events, out)
    }

    /// Adds events to the outbox (an id already queued is kept once), oldest dropped past `outboxMax`.
    public static func addToOutbox<E: Identifiable>(_ outbox: [E], _ events: [E?]) -> [E] where E.ID == String {
        var ids = Set(outbox.map(\.id))
        let fresh = events.compactMap { $0 }.filter { ids.insert($0.id).inserted }
        return Array((outbox + fresh).suffix(outboxMax))
    }

    public static func removeFromOutbox<E: Identifiable>(_ outbox: [E], ids: [String]) -> [E] where E.ID == String {
        let sent = Set(ids)
        return outbox.filter { !sent.contains($0.id) }
    }

    // MARK: Profile and log

    static func validBadge(_ b: String) -> Bool {
        b.utf16.count >= 1 && b.utf16.count <= 60 && !b.hasPrefix(" ") && !b.hasSuffix(" ")
            && b.unicodeScalars.allSatisfy { CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:& -").contains($0) }
    }

    /// Badges and challenge state as PUT /me/progress takes them.
    public static func progressOf(_ profile: Profile) -> Progress {
        progressOf(badges: profile.badges, daily: profile.daily, weekly: profile.weekly)
    }

    public static func progressOf(badges: [String], daily: Daily?, weekly: Weekly?) -> Progress {
        func small<T: Encodable>(_ v: T?) -> T? {
            guard let v, let j = try? JSONValue(encoding: v) else { return nil }
            return j.canonical.utf16.count <= maxChallengeJSON ? v : nil
        }
        return Progress(badges: Array(badges.filter(validBadge).prefix(200)), daily: small(daily), weekly: small(weekly))
    }

    /// The local profile after a sync: totals from the server, badges unioned, challenges from the server.
    public static func mergeProfile(_ local: Profile, server: ServerProfile) -> Profile {
        var p = local
        p.xp = server.xp
        p.streak = server.streak
        p.week = server.week
        p.weekXp = server.weekXp
        if let last = server.lastBreakDay, !last.isEmpty {
            if local.lastBreakDay.map({ $0.isEmpty || last > $0 }) ?? true { p.lastBreakDay = last }
            if server.streak > 0, local.lastStreakDay.map({ $0.isEmpty || last > $0 }) ?? true { p.lastStreakDay = last }
        }
        var badges: [String] = []
        for b in local.badges + (server.badges ?? []) where !badges.contains(b) { badges.append(b) }
        p.badges = badges
        if let d = server.daily { p.daily = d }
        if let w = server.weekly { p.weekly = w }
        return p
    }

    /// The latest break time in a log, or 0.
    public static func lastBreakAt(_ log: [LogEntry]) -> Millis { log.reduce(0) { max($0, $1.at) } }

    /// Pulled events merged into the log: known ids skipped, the rest added with their device,
    /// sorted by time (stable) and capped at `max`.
    public static func mergeLog(_ log: [LogEntry], events: [BreakEvent], max: Int) -> (log: [LogEntry], added: [LogEntry]) {
        var ids = Set(log.compactMap(\.id))
        var added: [LogEntry] = []
        for e in events where ids.insert(e.id).inserted {
            added.append(LogEntry(at: e.at, reps: e.reps, moves: e.moves, score: e.score, xp: e.xp, scored: e.scored,
                                  completed: e.completed, id: e.id, device: e.device, areas: e.areas))
        }
        if added.isEmpty { return (log, added) }
        let merged = (log + added).enumerated().sorted { ($0.element.at, $0.offset) < ($1.element.at, $1.offset) }.map(\.element)
        return (Array(merged.suffix(max)), added)
    }
}
