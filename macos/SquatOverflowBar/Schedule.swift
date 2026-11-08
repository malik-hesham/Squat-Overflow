import Foundation

/// The next-break countdown, ported from extension/lib/schedule.js. The Mac app keeps no timer of
/// its own: it derives the next break from the shared settings and the newest break on any device
/// (`lastBreakAt`), the same "one shared break timer" rule the other clients follow.
enum Schedule {
    /// A break this late still shows as due ("move"); later than that the next slot is shown.
    /// Same as LATE_MS in schedule.js.
    static let late: TimeInterval = 10 * 60

    /// "HH:MM" → minutes after midnight, or nil when malformed.
    static func minutes(_ hhmm: String) -> Int? {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]),
              (0...24).contains(h), (0...59).contains(m) else { return nil }
        return h * 60 + m
    }

    /// JS `Date.getDay()`: 0 = Sunday … 6 = Saturday.
    static func weekday(_ t: Date, _ cal: Calendar) -> Int { cal.component(.weekday, from: t) - 1 }

    static func at(_ day: Date, minutes: Int, _ cal: Calendar) -> Date {
        cal.startOfDay(for: day).addingTimeInterval(TimeInterval(minutes * 60))
    }

    /// isActive() in schedule.js: a workday, between activeStart (inclusive) and activeEnd.
    static func isActive(_ t: Date, _ s: ScheduleSettings, _ cal: Calendar = .current) -> Bool {
        let c = cal.dateComponents([.hour, .minute], from: t)
        let mins = (c.hour ?? 0) * 60 + (c.minute ?? 0)
        return s.workdays.contains(weekday(t, cal))
            && mins >= (minutes(s.activeStart) ?? 0) && mins < (minutes(s.activeEnd) ?? 0)
    }

    /// nextActiveSlot() in schedule.js: `t` itself when active, else one interval after the next opening.
    static func nextActiveSlot(_ t: Date, _ s: ScheduleSettings, _ cal: Calendar = .current) -> Date {
        let step = TimeInterval(s.intervalMin * 60)
        if isActive(t, s, cal) { return t }
        let start = minutes(s.activeStart) ?? 0
        for k in 0..<8 {
            guard let day = cal.date(byAdding: .day, value: k, to: t) else { continue }
            let opens = at(day, minutes: start, cal)
            if s.workdays.contains(weekday(day, cal)) && opens > t { return opens.addingTimeInterval(step) }
        }
        return t.addingTimeInterval(step)
    }

    /// When the next break is due. Counts one interval from the newest break (or from when today's
    /// window opened, whichever is later); a missed break steps forward one interval at a time,
    /// like onFire(), and anything outside active hours moves to the next active slot.
    static func nextBreak(now: Date, lastBreakAt: Date?, settings s: ScheduleSettings, calendar cal: Calendar = .current) -> Date {
        if !isActive(now, s, cal) { return nextActiveSlot(now, s, cal) }
        let step = TimeInterval(max(1, s.intervalMin) * 60)
        let opened = at(now, minutes: minutes(s.activeStart) ?? 0, cal)
        let anchor = max(lastBreakAt ?? opened, opened)
        var due = anchor.addingTimeInterval(step)
        if due > now { return nextActiveSlot(due, s, cal) }
        if now.timeIntervalSince(due) <= late { return due }
        while due <= now { due.addTimeInterval(step) }
        return nextActiveSlot(due, s, cal)
    }

    /// countdownText() in schedule.js.
    static func countdownText(_ left: TimeInterval) -> String {
        if left <= 0 { return "move" }
        if left < 60 { return "\(Int((left).rounded(.up)))s" }
        let minutes = Int((left / 60).rounded(.up))
        return minutes >= 100 ? "\(Int((Double(minutes) / 60).rounded()))h" : "\(minutes)m"
    }

    /// dayKey() in xp.js: the local date as "YYYY-MM-DD".
    static func dayKey(_ t: Date, _ cal: Calendar = .current) -> String {
        let c = cal.dateComponents([.year, .month, .day], from: t)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    /// isoWeek() in xp.js: the local date's ISO week as "YYYY-Www".
    static func isoWeek(_ t: Date, timeZone: TimeZone = .current) -> String {
        var iso = Calendar(identifier: .iso8601)
        iso.timeZone = timeZone
        let c = iso.dateComponents([.yearForWeekOfYear, .weekOfYear], from: t)
        return String(format: "%04d-W%02d", c.yearForWeekOfYear ?? 0, c.weekOfYear ?? 0)
    }
}
