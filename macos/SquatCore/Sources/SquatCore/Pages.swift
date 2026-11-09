import Foundation

/// extension/lib/auth.js
public enum Account {
    public static let personalDomains = [
        "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
        "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
        "gmx.com", "yandex.com", "mail.com", "zoho.com",
    ]

    /// The company domain of a work email; nil for personal mail providers and anything invalid.
    /// It decides who shares a team leaderboard.
    public static func companyFromEmail(_ email: String?) -> String? {
        let text = email ?? ""
        guard let at = text.lastIndex(of: "@"), at > text.startIndex else { return nil }
        let domain = text[text.index(after: at)...].lowercased()
        if domain.isEmpty || personalDomains.contains(domain) { return nil }
        return domain
    }
}

/// The settings form's rules, from extension/options.js.
public enum SettingsForm {
    /// The interval choices; anything else is "custom".
    public static let presets = [30, 45, 60, 90, 120]

    /// problem(): the first thing wrong with the form, translated, or nil when it can be saved.
    public static func problem(_ s: Settings, email: String?, lang: String) -> String? {
        let t = { I18n.t(lang, $0) }
        if s.intervalMin < 1 || s.intervalMin > 240 { return t("errInterval") }
        if s.areas.isEmpty { return t("errAreas") }
        if s.workdays.isEmpty { return t("errWorkdays") }
        if s.activeStart.isEmpty || s.activeEnd.isEmpty || s.activeStart >= s.activeEnd { return t("errHours") }
        if s.mode == "competitive" {
            if s.name.isEmpty || s.name.utf16.count > 40 { return t("errName") }
            if Account.companyFromEmail(email) == nil { return t("errCompany") }
        }
        return nil
    }
}

/// What the extension's popup shows, for the Mac menu.
public enum Popup {
    /// The next-break line: paused until, outside active hours, a countdown, or not scheduled yet.
    public static func nextText(schedule s: ScheduleState, settings: Settings, now: Millis, lang: String,
                                time: (Millis) -> String, weekday: (Millis) -> String) -> String {
        if s.pausedUntil > now { return I18n.t(lang, "pausedUntil", ["time": time(s.pausedUntil)]) }
        guard let nextAt = s.nextAt else { return I18n.t(lang, "notScheduled") }
        if !BreakSchedule.isActive(now, hours: settings.hours) {
            return I18n.t(lang, "outsideHours", ["day": weekday(nextAt), "time": time(nextAt)])
        }
        let left = max(0, nextAt - now)
        return left < minuteMs
            ? I18n.t(lang, "nextAtSecs", ["time": time(nextAt), "n": (left + 999) / 1000])
            : I18n.t(lang, "nextAt", ["time": time(nextAt), "n": (left + minuteMs - 1) / minuteMs])
    }

    /// After a snooze: how far the breaks moved and the next three times.
    public static func shiftedText(schedule s: ScheduleState, settings: Settings, now: Millis, lang: String,
                                   time: (Millis) -> String) -> String? {
        guard s.shiftedBy > 0, s.nextAt != nil, !(s.pausedUntil > now) else { return nil }
        let times = BreakSchedule.upcoming(s, intervalMin: settings.intervalMin, count: 3).map(time).joined(separator: " · ")
        return I18n.t(lang, "shifted", ["n": s.shiftedBy, "times": times])
    }

    public static func todayBreaks(_ log: [LogEntry], now: Millis) -> Int {
        let today = XP.dayKey(now)
        return log.filter { XP.dayKey($0.at) == today }.count
    }
}
