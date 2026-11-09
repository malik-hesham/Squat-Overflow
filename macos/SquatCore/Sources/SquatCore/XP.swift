import Foundation

/// Epoch milliseconds, the time unit every rule and the server use.
public typealias Millis = Int

public let minuteMs: Millis = 60_000
public let hourMs: Millis = 3_600_000
public let dayMs: Millis = 86_400_000

/// JS `Math.round`: halves round up.
@inline(__always) func jsRound(_ x: Double) -> Int { Int((x + 0.5).rounded(.down)) }

/// Local time the way JS `Date` sees it: Gregorian, in the process's time zone.
public enum LocalTime {
    public static var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = NSTimeZone.default
        return c
    }

    public static func date(_ t: Millis) -> Date { Date(timeIntervalSince1970: Double(t) / 1000) }
    public static func millis(_ d: Date) -> Millis { Millis((d.timeIntervalSince1970 * 1000).rounded()) }

    /// `new Date(t).getDay()`: 0 = Sunday … 6 = Saturday.
    public static func weekday(_ t: Millis) -> Int { calendar.component(.weekday, from: date(t)) - 1 }

    /// `new Date(t).getHours()`.
    public static func hour(_ t: Millis) -> Int { calendar.component(.hour, from: date(t)) }

    /// Hours × 60 + minutes of the local wall clock.
    public static func minutesOfDay(_ t: Millis) -> Int {
        let c = calendar.dateComponents([.hour, .minute], from: date(t))
        return (c.hour ?? 0) * 60 + (c.minute ?? 0)
    }

    /// `d.setDate(d.getDate() + days)`: same wall-clock time, `days` calendar days later.
    public static func addingDays(_ days: Int, to t: Millis) -> Millis {
        let cal = calendar
        let d = date(t)
        var c = cal.dateComponents([.year, .month, .day, .hour, .minute, .second, .nanosecond], from: d)
        c.day = (c.day ?? 1) + days
        return cal.date(from: c).map(millis) ?? t + days * dayMs
    }

    /// `d.setHours(0, minutes, 0, 0)` on the day of `t`: local midnight plus `minutes` of wall-clock time.
    public static func atMinutes(_ t: Millis, _ minutes: Int) -> Millis {
        let cal = calendar
        var c = cal.dateComponents([.year, .month, .day], from: date(t))
        c.hour = 0
        c.minute = minutes
        c.second = 0
        c.nanosecond = 0
        return cal.date(from: c).map(millis) ?? t
    }
}

/// levelFor() in extension/lib/xp.js.
public struct Level: Codable, Equatable, Sendable {
    public var level: Int
    public var name: String
    public var floor: Int
    public var next: Int?
    public var progress: Double
}

/// Port of extension/lib/xp.js (levels, day and week keys, XP for a break).
public enum XP {
    public struct LevelDef: Sendable { public var level: Int; public var name: String; public var xp: Int }

    public static let levels: [LevelDef] = [
        .init(level: 1, name: "Desk Potato", xp: 0),
        .init(level: 2, name: "Chair Escapee", xp: 100),
        .init(level: 3, name: "Stretch Rookie", xp: 250),
        .init(level: 4, name: "Desk Mover", xp: 500),
        .init(level: 5, name: "Posture Pro", xp: 900),
        .init(level: 6, name: "Flow Stretcher", xp: 1400),
        .init(level: 7, name: "Mobility Ninja", xp: 2000),
        .init(level: 8, name: "Movement Master", xp: 3000),
    ]

    public static let base = 10
    public static let firstBreak = 5
    public static let streakPerDay = 1
    public static let streakMax = 10

    public static func levelFor(xp: Int) -> Level {
        var i = levels.count - 1
        while i > 0 && xp < levels[i].xp { i -= 1 }
        let cur = levels[i]
        let next = i + 1 < levels.count ? levels[i + 1] : nil
        return Level(level: cur.level, name: cur.name, floor: cur.xp, next: next?.xp,
                     progress: next.map { Double(xp - cur.xp) / Double($0.xp - cur.xp) } ?? 1)
    }

    /// The local date as "YYYY-MM-DD".
    public static func dayKey(_ t: Millis) -> String {
        let c = LocalTime.calendar.dateComponents([.year, .month, .day], from: LocalTime.date(t))
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    private static func isoParts(_ t: Millis) -> (year: Int, week: Int) {
        var iso = Calendar(identifier: .iso8601)
        iso.timeZone = NSTimeZone.default
        let c = iso.dateComponents([.yearForWeekOfYear, .weekOfYear], from: LocalTime.date(t))
        return (c.yearForWeekOfYear ?? 0, c.weekOfYear ?? 0)
    }

    public static func isoWeekNumber(_ t: Millis) -> Int { isoParts(t).week }

    /// The local date's ISO week as "YYYY-Www".
    public static func isoWeek(_ t: Millis) -> String {
        let p = isoParts(t)
        return String(format: "%04d-W%02d", p.year, p.week)
    }

    public static func breakXp(countedReps: Int, targetReps: Int, scores: [Double]?) -> Int {
        guard let scores, !scores.isEmpty, targetReps != 0 else { return 0 }
        let completion = min(1, Double(countedReps) / Double(targetReps))
        let form = scores.reduce(0, +) / Double(scores.count) / 100
        return jsRound(Double(base) * completion * form)
    }
}
