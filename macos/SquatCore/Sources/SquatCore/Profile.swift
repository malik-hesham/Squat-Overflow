import Foundation

/// The player profile, as extension/lib/store.js keeps it (getProfile()).
public struct Profile: Codable, Equatable, Sendable {
    public var playerId: String
    public var secret: String
    public var xp: Int = 0
    public var streak: Int = 0
    /// dayKey() of the last day that counted for the streak.
    public var lastStreakDay: String?
    /// dayKey() of the last finished break.
    public var lastBreakDay: String?
    public var weekXp: Int = 0
    /// isoWeek() that weekXp belongs to.
    public var week: String?
    public var badges: [String] = []
    public var daily: Daily?
    public var weekly: Weekly?

    public init(playerId: String, secret: String) {
        self.playerId = playerId
        self.secret = secret
    }

    /// A new profile with fresh random ids, like getProfile() on first use.
    public static func fresh() -> Profile {
        Profile(playerId: UUID().uuidString.lowercased(), secret: UUID().uuidString.lowercased())
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        playerId = try c.decodeIfPresent(String.self, forKey: .playerId) ?? ""
        secret = try c.decodeIfPresent(String.self, forKey: .secret) ?? ""
        xp = try c.decodeIfPresent(Int.self, forKey: .xp) ?? 0
        streak = try c.decodeIfPresent(Int.self, forKey: .streak) ?? 0
        lastStreakDay = try c.decodeIfPresent(String.self, forKey: .lastStreakDay)
        lastBreakDay = try c.decodeIfPresent(String.self, forKey: .lastBreakDay)
        weekXp = try c.decodeIfPresent(Int.self, forKey: .weekXp) ?? 0
        week = try c.decodeIfPresent(String.self, forKey: .week)
        badges = try c.decodeIfPresent([String].self, forKey: .badges) ?? []
        daily = try c.decodeIfPresent(Daily.self, forKey: .daily)
        weekly = try c.decodeIfPresent(Weekly.self, forKey: .weekly)
    }
}

/// Today's challenges and progress towards them.
public struct Daily: Codable, Equatable, Sendable {
    public var day: String
    public var ids: [String]
    public var areas: [String]
    public var breaks: Int
    public var run: Int
    public var done: [String]

    public init(day: String, ids: [String], areas: [String], breaks: Int, run: Int, done: [String]) {
        self.day = day; self.ids = ids; self.areas = areas; self.breaks = breaks; self.run = run; self.done = done
    }

    /// Missing fields default, so a partial copy from the server still loads.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        day = try c.decodeIfPresent(String.self, forKey: .day) ?? ""
        ids = try c.decodeIfPresent([String].self, forKey: .ids) ?? []
        areas = try c.decodeIfPresent([String].self, forKey: .areas) ?? []
        breaks = try c.decodeIfPresent(Int.self, forKey: .breaks) ?? 0
        run = try c.decodeIfPresent(Int.self, forKey: .run) ?? 0
        done = try c.decodeIfPresent([String].self, forKey: .done) ?? []
    }
}

/// This week's featured-area challenge.
public struct Weekly: Codable, Equatable, Sendable {
    public var week: String
    public var area: String
    public var count: Int
    public var done: Bool

    public init(week: String, area: String, count: Int, done: Bool) {
        self.week = week; self.area = area; self.count = count; self.done = done
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        week = try c.decodeIfPresent(String.self, forKey: .week) ?? ""
        area = try c.decodeIfPresent(String.self, forKey: .area) ?? ""
        count = try c.decodeIfPresent(Int.self, forKey: .count) ?? 0
        done = try c.decodeIfPresent(Bool.self, forKey: .done) ?? false
    }
}

/// What a finished break sends to the service worker (currentResult() in extension/break.js).
public struct BreakResult: Codable, Equatable, Sendable {
    public struct MoveResult: Codable, Equatable, Sendable {
        public var key: String
        public var area: String
        public var completed: Bool
        public init(key: String, area: String, completed: Bool) { self.key = key; self.area = area; self.completed = completed }
    }

    public var scored: Bool
    public var countedReps: Int
    public var targetReps: Int
    public var scores: [Double]
    public var moves: [MoveResult]

    public init(scored: Bool, countedReps: Int, targetReps: Int, scores: [Double], moves: [MoveResult]) {
        self.scored = scored; self.countedReps = countedReps; self.targetReps = targetReps; self.scores = scores; self.moves = moves
    }
}

/// A challenge finished by a break, with its bonus.
public struct CompletedChallenge: Codable, Equatable, Sendable {
    public var id: String
    public var name: String
    public var bonus: Int
    public init(id: String, name: String, bonus: Int) { self.id = id; self.name = name; self.bonus = bonus }
}

public struct Breakdown: Codable, Equatable, Sendable {
    public var breakXp = 0
    public var firstBreak = 0
    public var streak = 0
    public var challenges: [CompletedChallenge] = []
    public var total = 0
    public init() {}
}

public struct LevelUp: Codable, Equatable, Sendable {
    public var from: Int
    public var to: Int
    public var name: String
    public init(from: Int, to: Int, name: String) { self.from = from; self.to = to; self.name = name }
}

/// award()'s result.
public struct Award: Codable, Equatable, Sendable {
    public var profile: Profile
    public var breakdown: Breakdown
    public var levelUp: LevelUp?
    public var newBadges: [String]
}

/// Port of extension/lib/challenges.js: the daily challenges, the weekly featured-area
/// challenge, and the badges they give.
public enum Challenges {
    public struct Def: Sendable { public var id: String; public var name: String; public var bonus: Int }

    public static let dailyPool: [Def] = [
        .init(id: "variety", name: "Variety pack", bonus: 25),
        .init(id: "high_five", name: "High five", bonus: 30),
        .init(id: "clean_form", name: "Clean form", bonus: 20),
        .init(id: "early_mover", name: "Early mover", bonus: 15),
        .init(id: "no_excuses", name: "No excuses", bonus: 25),
    ]

    public static let weeklyTarget = 10
    public static let weeklyBonus = 100

    static let dailyMin = 2
    static let dailyMax = 5
    static let earlyHour = 10

    static func hash(_ text: String) -> UInt32 {
        var h: UInt32 = 7
        for ch in text.unicodeScalars { h = h &* 31 &+ UInt32(ch.value & 0xFFFF) }
        return h
    }

    /// Today's 2–5 challenges, the same on every device for the same local date.
    public static func dailyFor(_ now: Millis) -> [String] {
        let day = XP.dayKey(now)
        let offset = Int(hash(day) % UInt32(dailyPool.count))
        let count = dailyMin + Int(hash("\(day):count") % UInt32(dailyMax - dailyMin + 1))
        return (0..<count).map { dailyPool[(offset + $0) % dailyPool.count].id }
    }

    /// The profile with today's and this week's challenge state, starting fresh ones when the day
    /// or week changed (and moving a weekly challenge off an area an update renamed).
    public static func withPeriods(_ profile: Profile, now: Millis) -> Profile {
        var p = profile
        let day = XP.dayKey(now)
        let week = XP.isoWeek(now)
        if p.daily?.day != day { p.daily = Daily(day: day, ids: dailyFor(now), areas: [], breaks: 0, run: 0, done: []) }
        if p.weekly?.week != week {
            p.weekly = Weekly(week: week, area: Routine.featuredArea(now), count: 0, done: false)
        } else if let w = p.weekly, !Routine.areas.contains(w.area) {
            p.weekly?.area = Routine.featuredArea(now)
        }
        return p
    }

    public struct Update: Sendable {
        public var profile: Profile
        public var completed: [CompletedChallenge]
        public var newBadges: [String]
    }

    public static func updateChallenges(_ profile: Profile, result: BreakResult, avgForm: Double, now: Millis) -> Update {
        var p = withPeriods(profile, now: now)
        var d = p.daily!
        var w = p.weekly!
        let completedMoves = result.moves.filter(\.completed)
        var areas = d.areas
        for a in completedMoves.map(\.area) where !areas.contains(a) { areas.append(a) }
        d.areas = areas
        d.breaks += 1
        d.run += 1
        let meets: [String: Bool] = [
            "variety": d.areas.count >= 3,
            "high_five": d.breaks >= 5,
            "clean_form": avgForm >= 90,
            "early_mover": LocalTime.hour(now) < earlyHour,
            "no_excuses": d.run >= 3,
        ]
        var completed: [CompletedChallenge] = []
        var newBadges: [String] = []
        func badge(_ id: String) {
            if p.badges.contains(id) { return }
            p.badges.append(id)
            newBadges.append(id)
        }
        for id in d.ids {
            if d.done.contains(id) || meets[id] != true { continue }
            d.done.append(id)
            let c = dailyPool.first { $0.id == id }!
            completed.append(CompletedChallenge(id: id, name: c.name, bonus: c.bonus))
            badge("daily:\(id)")
        }
        w.count = min(weeklyTarget, w.count + completedMoves.filter { $0.area == w.area }.count)
        if !w.done && w.count >= weeklyTarget {
            w.done = true
            completed.append(CompletedChallenge(id: "weekly", name: "\(w.area) week", bonus: weeklyBonus))
            badge("weekly:\(w.area)")
        }
        p.daily = d
        p.weekly = w
        return Update(profile: p, completed: completed, newBadges: newBadges)
    }

    /// Snoozing, skipping or closing a break ends the "No excuses" run.
    public static func noteAction(_ profile: Profile, action: String, now: Millis) -> Profile {
        var p = withPeriods(profile, now: now)
        if ["snooze", "skip", "close"].contains(action) { p.daily?.run = 0 }
        return p
    }
}

extension XP {
    /// The last workday before `now`'s date, or nil when there are no workdays.
    static func previousWorkday(_ now: Millis, _ workdays: [Int]) -> String? {
        for i in 1...7 {
            let t = LocalTime.addingDays(-i, to: now)
            if workdays.contains(LocalTime.weekday(t)) { return dayKey(t) }
        }
        return nil
    }

    /// award(): XP, streak, first-break bonus, challenges and level-up for a finished break.
    /// An unscored break (no camera, coach offline, no reps) only records the day.
    public static func award(_ profile: Profile, result: BreakResult, now: Millis, workdays: [Int]) -> Award {
        var p = profile
        let today = dayKey(now)
        let week = isoWeek(now)
        let before = levelFor(xp: p.xp).level
        if p.week != week {
            p.week = week
            p.weekXp = 0
        }
        var breakdown = Breakdown()
        p.lastBreakDay = today
        if !result.scored { return Award(profile: p, breakdown: breakdown, levelUp: nil, newBadges: []) }

        breakdown.breakXp = breakXp(countedReps: result.countedReps, targetReps: result.targetReps, scores: result.scores)
        if breakdown.breakXp > 0 && p.lastStreakDay != today {
            let continues: Bool = {
                guard let last = p.lastStreakDay, !last.isEmpty, let prev = previousWorkday(now, workdays) else { return false }
                return last >= prev
            }()
            p.streak = continues ? p.streak + 1 : 1
            p.lastStreakDay = today
            breakdown.firstBreak = firstBreak
            breakdown.streak = min(p.streak * streakPerDay, streakMax)
        }
        let avgForm = result.scores.isEmpty ? 0 : result.scores.reduce(0, +) / Double(result.scores.count)
        let ch = Challenges.updateChallenges(p, result: result, avgForm: avgForm, now: now)
        var out = ch.profile
        breakdown.challenges = ch.completed
        let bonus = ch.completed.reduce(0) { $0 + $1.bonus }
        breakdown.total = breakdown.breakXp + breakdown.firstBreak + breakdown.streak + bonus
        out.xp += breakdown.total
        out.weekXp += breakdown.total
        let after = levelFor(xp: out.xp)
        let levelUp = after.level > before ? LevelUp(from: before, to: after.level, name: after.name) : nil
        return Award(profile: out, breakdown: breakdown, levelUp: levelUp, newBadges: ch.newBadges)
    }
}
