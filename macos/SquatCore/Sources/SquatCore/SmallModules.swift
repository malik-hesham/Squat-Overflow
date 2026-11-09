import Foundation

// Ports of the extension's small pure modules: activity.js, memes.js, server-status.js,
// badges.js and i18n.js.

public struct DayActivity: Codable, Equatable, Sendable {
    public var breaks: Int
    public var xp: Int
    public init(breaks: Int, xp: Int) { self.breaks = breaks; self.xp = xp }
}

/// extension/lib/activity.js: breaks and XP per local day, kept for a year.
public enum Activity {
    static let keepDays = 371

    public static func record(_ activity: [String: DayActivity]?, now: Millis, xp: Int?) -> [String: DayActivity] {
        let key = XP.dayKey(now)
        let cutoff = XP.dayKey(now - keepDays * dayMs)
        var next = (activity ?? [:]).filter { $0.key >= cutoff }
        let prev = next[key] ?? DayActivity(breaks: 0, xp: 0)
        next[key] = DayActivity(breaks: prev.breaks + 1, xp: prev.xp + (xp ?? 0))
        return next
    }

    public static func backfill(_ log: [(at: Millis, xp: Int?)]) -> [String: DayActivity] {
        var out: [String: DayActivity] = [:]
        for entry in log {
            let key = XP.dayKey(entry.at)
            let prev = out[key] ?? DayActivity(breaks: 0, xp: 0)
            out[key] = DayActivity(breaks: prev.breaks + 1, xp: prev.xp + (entry.xp ?? 0))
        }
        return out
    }
}

/// extension/lib/memes.js: which clip plays when. The clips themselves are the extension's
/// sounds/memes, converted to AAC for macOS (see the app's Sounds folder).
public enum Memes {
    static func clips(_ prefix: String, _ ns: [Int]) -> [String] { ns.map { String(format: "%@-%02d", prefix, $0) } }

    public static let groups: [String: [String]] = [
        // "Break now": a new one each break
        "start": clips("meme", [4, 1, 2, 3, 11, 13, 15, 17, 19, 20, 21, 22, 23]) + clips("sfx", Array(1...25)),
        "done": clips("meme", [5, 9]), // Done, with form scores
        "unscored": clips("meme", [7, 8, 10, 12, 14, 18, 24]), // Done, nothing scored
        "reps": clips("meme", [6, 16]), // spread over the break, see repMarks()
    ]

    /// The clip whose turn it is in `group`, and the turn after it (wrapping round).
    public static func takeTurn(_ group: [String], turn: Int?) -> (clip: String, next: Int) {
        let i = turn.map { $0 >= 0 ? $0 % group.count : 0 } ?? 0
        return (group[i], (i + 1) % group.count)
    }

    /// The total-rep counts where the rep clips play: the break's reps split evenly between them.
    public static func repMarks(totalReps: Int, clips: Int = 2) -> [Int] {
        (0..<clips).map { k in ((k + 1) * totalReps + clips - 1) / clips }
    }
}

/// The pose socket's states as the break page shows them (onStatus in extension/break.js).
public enum PoseStatus: String, Sendable {
    case connecting, open, offline, unavailable
    case cameraDenied = "camera-denied"

    /// CLOSE_MODEL_FAILED in extension/lib/pose/local-socket.js: the pose model couldn't start.
    public static let closeModelFailed = 1011

    /// The close handler in extension/lib/pose-client.js.
    public static func closeStatus(_ code: Int) -> PoseStatus { code == closeModelFailed ? .unavailable : .offline }
}

/// extension/lib/badges.js
public enum Badges {
    static let dailyIcons = ["variety": "🌈", "high_five": "✋", "clean_form": "💎", "early_mover": "🌅", "no_excuses": "🔥"]

    public static func label(_ id: String, lang: String = "en") -> String {
        let parts = id.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        let kind = parts[0]
        let rest = parts.count > 1 ? parts[1] : ""
        if kind == "weekly" { return "🏅 \(I18n.t(lang, "areaWeek", ["area": I18n.areaName(lang, rest)]))" }
        let name = Challenges.dailyPool.first { $0.id == rest }?.name ?? rest
        return "\(dailyIcons[rest] ?? "⭐") \(I18n.nameText(lang, "challenge.\(rest)", fallback: name))"
    }

    public static func challengeIcon(_ id: String) -> String { id == "weekly" ? "🏅" : dailyIcons[id] ?? "⭐" }
}

/// extension/lib/i18n.js, over the extension's own strings (Resources/i18n.json, exported by
/// macos/scripts/parity-fixtures.mjs).
public enum I18n {
    public static let langs = ["auto", "en", "ar"]

    static let strings: [String: [String: String]] = {
        guard let url = Bundle.module.url(forResource: "i18n", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let table = try? JSONDecoder().decode([String: [String: String]].self, from: data) else { return [:] }
        return table
    }()

    public static func keys(_ lang: String) -> [String] { Array(strings[lang]?.keys ?? [:].keys) }

    /// "en" or "ar": the setting when it names one, else from the system language.
    public static func resolveLang(_ setting: String, browserLang: String?) -> String {
        if setting == "en" || setting == "ar" { return setting }
        return (browserLang ?? "").lowercased().hasPrefix("ar") ? "ar" : "en"
    }

    /// The string for `key`, falling back to English and then the key, with {name} placeholders filled.
    public static func t(_ lang: String, _ key: String, _ vars: [String: Any] = [:]) -> String {
        let text = strings[lang]?[key] ?? strings["en"]?[key] ?? key
        return fill(text, vars)
    }

    static func fill(_ text: String, _ vars: [String: Any]) -> String {
        guard text.contains("{") else { return text }
        var out = ""
        var rest = Substring(text)
        while let open = rest.firstIndex(of: "{") {
            out += rest[..<open]
            let after = rest[rest.index(after: open)...]
            if let close = after.firstIndex(of: "}"), case let name = after[..<close],
               !name.isEmpty, name.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "_" }) {
                if let v = vars[String(name)] { out += jsString(v) } else { out += "{\(name)}" }
                rest = after[after.index(after: close)...]
            } else {
                out += "{"
                rest = after
            }
        }
        return out + rest
    }

    /// JS String(v): whole numbers without a decimal point.
    static func jsString(_ v: Any) -> String {
        if let d = v as? Double { return d.rounded() == d && abs(d) < 1e15 ? String(Int(d)) : String(d) }
        return "\(v)"
    }

    /// The Arabic name when there is one, else `fallback` (names come from the server in English).
    public static func nameText(_ lang: String, _ key: String, fallback: String) -> String {
        if lang == "ar", let ar = strings["ar"]?[key], !ar.isEmpty { return ar }
        return fallback
    }

    public static func exerciseText(_ lang: String, key: String, field: String, fallback: String) -> String {
        nameText(lang, "ex.\(key).\(field)", fallback: fallback)
    }

    public static func areaName(_ lang: String, _ area: String) -> String { nameText(lang, "area.\(area)", fallback: area) }

    public static func levelName(_ lang: String, _ level: Int, fallback: String) -> String {
        nameText(lang, "level.\(level)", fallback: fallback)
    }

    public static func issueText(_ lang: String, code: String, fallback: String) -> String {
        nameText(lang, "issue.\(code)", fallback: fallback)
    }

    /// Locale for dates and times; Arabic keeps Latin digits like the extension (ar-u-nu-latn).
    public static func locale(_ lang: String) -> Locale {
        lang == "ar" ? Locale(identifier: "ar@numbers=latn") : Locale.current
    }
}
