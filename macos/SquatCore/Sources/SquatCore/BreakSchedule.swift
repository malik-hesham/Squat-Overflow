import Foundation

/// When breaks may happen: "HH:MM" bounds and workdays (0 = Sunday … 6 = Saturday, as JS getDay()).
public struct Hours: Codable, Equatable, Sendable {
    public var activeStart: String
    public var activeEnd: String
    public var workdays: [Int]
    public init(activeStart: String, activeEnd: String, workdays: [Int]) {
        self.activeStart = activeStart; self.activeEnd = activeEnd; self.workdays = workdays
    }
}

/// The break timer's state, as the extension keeps it under "schedule".
public struct ScheduleState: Codable, Equatable, Sendable {
    public var nextAt: Millis?
    public var skipsInRow = 0
    public var snoozesInRow = 0
    public var pausedUntil: Millis = 0
    /// The reminder window the timer opened; closing it counts as a skip.
    public var windowId: Int?
    /// A window opened with Break now.
    public var extraWindowId: Int?
    public var lastKey: String?
    public var breakCount = 0
    public var shiftedBy = 0
    public var deferredFrom: Millis?
    public init() {}

    /// Missing fields take their defaults, like getSchedule() in extension/lib/store.js.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        nextAt = try c.decodeIfPresent(Millis.self, forKey: .nextAt)
        skipsInRow = try c.decodeIfPresent(Int.self, forKey: .skipsInRow) ?? 0
        snoozesInRow = try c.decodeIfPresent(Int.self, forKey: .snoozesInRow) ?? 0
        pausedUntil = try c.decodeIfPresent(Millis.self, forKey: .pausedUntil) ?? 0
        windowId = try c.decodeIfPresent(Int.self, forKey: .windowId)
        extraWindowId = try c.decodeIfPresent(Int.self, forKey: .extraWindowId)
        lastKey = try c.decodeIfPresent(String.self, forKey: .lastKey)
        breakCount = try c.decodeIfPresent(Int.self, forKey: .breakCount) ?? 0
        shiftedBy = try c.decodeIfPresent(Int.self, forKey: .shiftedBy) ?? 0
        deferredFrom = try c.decodeIfPresent(Millis.self, forKey: .deferredFrom)
    }
}

public struct FireDecision: Codable, Equatable, Sendable {
    public var kind: String
    public var schedule: ScheduleState
}

/// Port of extension/lib/schedule.js: the break grid, snooze, skip, pause, active hours and what
/// happens when the timer fires.
public enum BreakSchedule {
    public static let snoozeMin = 20
    public static let snoozeCap = 2
    public static let warnSkips = 3
    public static let pauseMin = 60
    public static let lateMs: Millis = 10 * minuteMs
    public static let deferMin = 5
    public static let idleSec = 300

    public static func initial(now: Millis, intervalMin: Int) -> ScheduleState {
        var s = ScheduleState()
        s.nextAt = now + intervalMin * minuteMs
        return s
    }

    /// The next slot on the grid after `now`.
    public static func onFire(_ s: ScheduleState, now: Millis, intervalMin: Int) -> ScheduleState {
        let step = intervalMin * minuteMs
        var nextAt = (s.nextAt ?? 0) + step
        if step > 0 { while nextAt <= now { nextAt += step } }
        var out = s
        out.nextAt = nextAt
        return out
    }

    public static func canSnooze(_ s: ScheduleState) -> Bool { s.snoozesInRow < snoozeCap }

    public static func showWarning(_ s: ScheduleState) -> Bool { s.skipsInRow >= warnSkips }

    /// How long without moving, in half hours, for the warning title.
    public static func warningHours(skips: Int, intervalMin: Int) -> Double {
        Double(jsRound(Double(skips * intervalMin) / 30)) / 2
    }

    public static func apply(_ action: String, to s: ScheduleState, now: Millis, intervalMin: Int) -> ScheduleState {
        var out = s
        switch action {
        case "done":
            out.skipsInRow = 0; out.snoozesInRow = 0; out.shiftedBy = 0; out.windowId = nil
        case "skip":
            out.skipsInRow = s.skipsInRow + 1; out.snoozesInRow = 0; out.shiftedBy = 0; out.windowId = nil
        case "close":
            return s.windowId == nil ? s : apply("skip", to: s, now: now, intervalMin: intervalMin)
        case "snooze":
            if !canSnooze(s) { return s }
            out.nextAt = now + snoozeMin * minuteMs
            out.snoozesInRow = s.snoozesInRow + 1
            out.shiftedBy = snoozeMin
            out.windowId = nil
        case "pause":
            out.nextAt = now + pauseMin * minuteMs
            out.pausedUntil = now + pauseMin * minuteMs
            out.windowId = nil
        default:
            return s
        }
        return out
    }

    public static func upcoming(_ s: ScheduleState, intervalMin: Int, count: Int = 3) -> [Millis] {
        (0..<count).map { (s.nextAt ?? 0) + $0 * intervalMin * minuteMs }
    }

    public static func rescheduleForInterval(_ s: ScheduleState, now: Millis, intervalMin: Int) -> ScheduleState {
        var out = s
        out.nextAt = now + intervalMin * minuteMs
        return out
    }

    /// "HH:MM" → minutes after midnight.
    static func minutesOf(_ hhmm: String) -> Int {
        let parts = hhmm.split(separator: ":", omittingEmptySubsequences: false).map { Int($0) ?? 0 }
        return (parts.first ?? 0) * 60 + (parts.count > 1 ? parts[1] : 0)
    }

    /// A workday, from activeStart (inclusive) to activeEnd (exclusive).
    public static func isActive(_ t: Millis, hours: Hours) -> Bool {
        let mins = LocalTime.minutesOfDay(t)
        return hours.workdays.contains(LocalTime.weekday(t)) && mins >= minutesOf(hours.activeStart) && mins < minutesOf(hours.activeEnd)
    }

    /// `t` itself when it's active, else one interval after the next opening of active hours.
    public static func nextActiveSlot(_ t: Millis, intervalMin: Int, hours: Hours) -> Millis {
        if isActive(t, hours: hours) { return t }
        let start = minutesOf(hours.activeStart)
        for k in 0..<8 {
            let day = LocalTime.addingDays(k, to: t)
            let opens = LocalTime.atMinutes(day, start)
            if hours.workdays.contains(LocalTime.weekday(day)) && opens > t { return opens + intervalMin * minuteMs }
        }
        return t + intervalMin * minuteMs
    }

    /// What to do when the timer fires: "outside" active hours, "late" (missed by over 10 min,
    /// e.g. the Mac was asleep), "defer" for a meeting, "away" when the user is idle, or "open".
    public static func decideFire(_ s: ScheduleState, now: Millis, intervalMin: Int, idle: String, meeting: Bool,
                                  hours: Hours, autoPause: Bool) -> FireDecision {
        func slot(_ t: Millis) -> Millis { nextActiveSlot(t, intervalMin: intervalMin, hours: hours) }
        var out = s
        if !isActive(now, hours: hours) {
            out.nextAt = slot(now)
            out.deferredFrom = nil
            return FireDecision(kind: "outside", schedule: out)
        }
        let deferred = s.deferredFrom != nil
        if !deferred && now - (s.nextAt ?? 0) > lateMs {
            out.nextAt = slot(now + intervalMin * minuteMs)
            return FireDecision(kind: "late", schedule: out)
        }
        if autoPause && meeting {
            out.nextAt = now + deferMin * minuteMs
            out.deferredFrom = deferred ? s.deferredFrom : s.nextAt
            return FireDecision(kind: "defer", schedule: out)
        }
        var base = s
        if deferred { base.nextAt = s.deferredFrom }
        var fired = onFire(base, now: now, intervalMin: intervalMin)
        fired.nextAt = slot(fired.nextAt ?? now)
        fired.deferredFrom = nil
        return FireDecision(kind: idle == "active" ? "open" : "away", schedule: fired)
    }

    /// Whether the interval, active hours or workdays changed (privacy, mode and the rest don't move breaks).
    public static func settingsChanged(_ prev: (Hours, Int), _ next: (Hours, Int)) -> Bool {
        func days(_ w: [Int]) -> String { w.map(String.init).sorted().joined(separator: ",") }
        return prev.1 != next.1 || prev.0.activeStart != next.0.activeStart || prev.0.activeEnd != next.0.activeEnd
            || days(prev.0.workdays) != days(next.0.workdays)
    }

    /// The seven days of the week starting from `weekStart`.
    public static func weekOrder(_ weekStart: Int) -> [Int] { (0..<7).map { (weekStart + $0) % 7 } }

    /// "move", seconds in the last minute, minutes below 100, hours above.
    public static func countdownText(_ msLeft: Millis) -> String {
        if msLeft <= 0 { return "move" }
        if msLeft < minuteMs { return "\((msLeft + 999) / 1000)s" }
        let minutes = (msLeft + minuteMs - 1) / minuteMs
        return minutes >= 100 ? "\(jsRound(Double(minutes) / 60))h" : "\(minutes)m"
    }
}
