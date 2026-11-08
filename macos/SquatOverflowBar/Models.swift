import Foundation

/// GET /me/profile (server/src/sync/profile.ts). Only the fields the menu shows.
struct Profile: Decodable, Equatable {
    var xp: Int
    var level: Int
    var levelName: String
    var streak: Int
    var week: String
    var weekXp: Int
    var day: String
    var todayBreaks: Int
    var breaks: Int
    /// Epoch milliseconds of the newest break on any device.
    var lastBreakAt: Double?
}

/// The shared settings the countdown needs, from GET /me/settings `doc`. Missing or odd values
/// fall back to SETTINGS_DEFAULTS in extension/lib/store.js.
struct ScheduleSettings: Equatable {
    var intervalMin: Int = 60
    var activeStart: String = "09:00"
    var activeEnd: String = "17:00"
    /// 0 = Sunday … 6 = Saturday, as JS `Date.getDay()`.
    var workdays: [Int] = [1, 2, 3, 4, 5]
    var name: String = ""
}

struct SettingsResponse: Decodable {
    var settings: ScheduleSettings
    var version: Int

    private enum Keys: String, CodingKey { case doc, version }
    private enum DocKeys: String, CodingKey { case intervalMin, activeStart, activeEnd, workdays, name }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        version = (try? c.decode(Int.self, forKey: .version)) ?? 0
        var s = ScheduleSettings()
        if let doc = try? c.nestedContainer(keyedBy: DocKeys.self, forKey: .doc) {
            if let v = try? doc.decode(Int.self, forKey: .intervalMin), v > 0 { s.intervalMin = v }
            if let v = try? doc.decode(String.self, forKey: .activeStart), Schedule.minutes(v) != nil { s.activeStart = v }
            if let v = try? doc.decode(String.self, forKey: .activeEnd), Schedule.minutes(v) != nil { s.activeEnd = v }
            if let v = try? doc.decode([Int].self, forKey: .workdays) { s.workdays = v.filter { (0...6).contains($0) } }
            if let v = try? doc.decode(String.self, forKey: .name) { s.name = v }
        }
        settings = s
    }
}

/// One row of GET /leaderboard (server/src/leaderboard/leaderboard.store.ts).
struct BoardRow: Decodable, Identifiable, Equatable {
    var rank: Int
    var name: String
    var level: Int
    var xp: Int
    var streak: Int
    var isMe: Bool
    var avatar: String

    var id: Int { rank }

    private enum CodingKeys: String, CodingKey {
        case rank, name, level, xp, streak, avatar
        case isMe = "is_me"
    }
}

/// LEVELS from extension/lib/xp.js (and server/src/sync/profile.ts), for the XP bar.
enum Levels {
    static let thresholds: [(level: Int, name: String, xp: Int)] = [
        (1, "Desk Potato", 0),
        (2, "Chair Escapee", 100),
        (3, "Stretch Rookie", 250),
        (4, "Desk Mover", 500),
        (5, "Posture Pro", 900),
        (6, "Flow Stretcher", 1400),
        (7, "Mobility Ninja", 2000),
        (8, "Movement Master", 3000),
    ]

    /// Like levelFor() in xp.js: progress to the next level in 0…1, and the next threshold.
    static func progress(xp: Int) -> (fraction: Double, next: Int?) {
        var i = thresholds.count - 1
        while i > 0 && xp < thresholds[i].xp { i -= 1 }
        guard i + 1 < thresholds.count else { return (1, nil) }
        let floor = thresholds[i].xp, next = thresholds[i + 1].xp
        return (Double(xp - floor) / Double(next - floor), next)
    }
}
