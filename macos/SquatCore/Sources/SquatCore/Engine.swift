import Foundation

/// chrome.idle.queryState()'s answer.
public enum IdleState: String, Sendable { case active, idle, locked }

/// What the engine needs from the platform: idle and meeting checks, break windows, the timer.
@MainActor
public protocol EngineHost: AnyObject {
    func idleState(seconds: Int) -> IdleState
    func inMeeting() -> Bool
    /// Opens a break window and returns its id. `manual`: Break now (no reminder rules apply).
    func openBreakWindow(manual: Bool) -> Int
    func focusWindow(_ id: Int)
    func isBreakWindowOpen(_ id: Int) -> Bool
    /// The next-break timer; nil cancels it.
    func setAlarm(at: Millis?)
    /// Starts a sync in the background (lib/sync.js); it calls `afterSync` when done.
    func requestSync()
}

/// What Done answers the break window with.
public struct DoneResponse: Equatable, Sendable {
    public var breakdown: Breakdown
    public var levelUp: LevelUp?
    public var newBadges: [String]
    public var profile: Profile

    public init(breakdown: Breakdown, levelUp: LevelUp?, newBadges: [String], profile: Profile) {
        self.breakdown = breakdown; self.levelUp = levelUp; self.newBadges = newBadges; self.profile = profile
    }
}

/// The break timer and break actions, ported from extension/service-worker.js. Runs on the main
/// actor, which serialises it the way the service worker's serial() queue does: every handler
/// reads and writes the store without suspending.
@MainActor
public final class Engine {
    public let store: Store
    private unowned let host: EngineHost
    private let clock: () -> Millis

    public init(store: Store, host: EngineHost, clock: @escaping () -> Millis) {
        self.store = store
        self.host = host
        self.clock = clock
    }

    // MARK: Timer

    /// chrome.runtime.onStartup: windows from the last run are gone; make sure a break is scheduled.
    public func start() {
        var s = store.schedule()
        s.windowId = nil
        s.extraWindowId = nil
        store.setSchedule(s)
        ensureAlarm()
    }

    /// ensureAlarm(): the first break after setup, or the timer for the stored one.
    public func ensureAlarm() {
        let settings = store.settings()
        guard settings.setupDone else { return }
        let s = store.schedule()
        guard let nextAt = s.nextAt else {
            save(fresh(s, settings))
            return
        }
        host.setAlarm(at: max(nextAt, clock() + 1000))
    }

    private func fresh(_ s: ScheduleState, _ settings: Settings) -> ScheduleState {
        var next = BreakSchedule.initial(now: clock(), intervalMin: settings.intervalMin)
        next.lastKey = s.lastKey
        next.breakCount = s.breakCount
        return next
    }

    /// saveSchedule(): stores the schedule with the next break moved into active hours, and sets the timer.
    private func save(_ schedule: ScheduleState) {
        let settings = store.settings()
        var s = schedule
        if let nextAt = s.nextAt { s.nextAt = BreakSchedule.nextActiveSlot(nextAt, intervalMin: settings.intervalMin, hours: settings.hours) }
        store.setSchedule(s)
        host.setAlarm(at: s.nextAt)
    }

    private func openBreakWindowId(_ s: ScheduleState) -> Int? {
        if let id = s.windowId, host.isBreakWindowOpen(id) { return id }
        if let id = s.extraWindowId, host.isBreakWindowOpen(id) { return id }
        return nil
    }

    private func openReminder(manual: Bool) {
        var s = store.schedule()
        if let open = openBreakWindowId(s) {
            host.focusWindow(open)
            return
        }
        let id = host.openBreakWindow(manual: manual)
        if manual {
            s.windowId = nil
            s.extraWindowId = id
        } else {
            s.windowId = id
        }
        store.setSchedule(s)
    }

    /// onNextBreak(): the timer fired.
    public func alarmFired() {
        let settings = store.settings()
        guard settings.setupDone else { return }
        let s = store.schedule()
        let decision = BreakSchedule.decideFire(
            s, now: clock(), intervalMin: settings.intervalMin, idle: host.idleState(seconds: BreakSchedule.idleSec).rawValue,
            meeting: host.inMeeting(), hours: settings.hours, autoPause: settings.autoPause)
        save(decision.schedule)
        guard decision.kind == "open", openBreakWindowId(s) == nil else { return }
        openReminder(manual: false)
    }

    // MARK: Break actions

    /// The popup's Break now.
    public func breakNow() { openReminder(manual: true) }

    /// onDone(): XP, the log, the activity heatmap, and the next break counted from now.
    public func done(result: BreakResult, lastKey: String?) -> DoneResponse {
        let now = clock()
        let settings = store.settings()
        let s = store.schedule()
        let award = XP.award(store.profile(), result: result, now: now, workdays: settings.workdays)
        store.setProfile(award.profile)
        let log = store.log()
        let activity = store.activity() ?? Activity.backfill(log.map { ($0.at, $0.xp) })
        store.setActivity(Activity.record(activity, now: now, xp: award.breakdown.total))
        let scores = result.scores
        store.appendLog(LogEntry(
            at: now, reps: result.countedReps, moves: result.moves.filter(\.completed).count,
            score: scores.isEmpty ? nil : jsRound(scores.reduce(0, +) / Double(scores.count)),
            xp: award.breakdown.total, scored: result.scored,
            completed: !result.moves.isEmpty && result.moves.allSatisfy(\.completed)), areas: settings.areas, now: now)
        var next = BreakSchedule.apply("done", to: s, now: now, intervalMin: settings.intervalMin)
        next.lastKey = lastKey ?? s.lastKey
        next.breakCount = s.breakCount + 1
        next.extraWindowId = s.windowId ?? s.extraWindowId
        save(next)
        host.requestSync()
        return DoneResponse(breakdown: award.breakdown, levelUp: award.levelUp, newBadges: award.newBadges, profile: award.profile)
    }

    /// Snooze, Skip, or Pause from the skip warning (onBreakAction()).
    public func breakAction(_ action: String) {
        let now = clock()
        let settings = store.settings()
        store.setProfile(Challenges.noteAction(store.profile(), action: action, now: now))
        save(BreakSchedule.apply(action, to: store.schedule(), now: now, intervalMin: settings.intervalMin))
    }

    /// The popup's Pause: an hour, keeping the reminder window's id.
    public func pause() {
        let s = store.schedule()
        var next = BreakSchedule.apply("pause", to: s, now: clock(), intervalMin: store.settings().intervalMin)
        next.windowId = s.windowId
        save(next)
    }

    public func resume() {
        var next = BreakSchedule.rescheduleForInterval(store.schedule(), now: clock(), intervalMin: store.settings().intervalMin)
        next.pausedUntil = 0
        save(next)
    }

    /// A break window closed. Closing the reminder without answering counts as a skip.
    public func windowClosed(_ id: Int) {
        let s = store.schedule()
        guard s.windowId == id else { return }
        let now = clock()
        store.setProfile(Challenges.noteAction(store.profile(), action: "close", now: now))
        save(BreakSchedule.apply("close", to: s, now: now, intervalMin: store.settings().intervalMin))
    }

    // MARK: Settings and sync

    /// onSettingsSaved(): the first save starts the timer; a new interval, hours or workdays reschedule.
    public func settingsSaved(scheduleChanged: Bool) {
        let settings = store.settings()
        let s = store.schedule()
        if s.nextAt == nil { save(fresh(s, settings)) }
        else if scheduleChanged { save(BreakSchedule.rescheduleForInterval(s, now: clock(), intervalMin: settings.intervalMin)) }
        else { save(s) }
        host.requestSync()
    }

    /// afterSync(): shared schedule settings that changed elsewhere reschedule like a local save, and
    /// a break finished on another device after the last one here counts the next break from it.
    public func afterSync(scheduleChanged: Bool, lastBreakAt: Millis?) {
        let settings = store.settings()
        let s = store.schedule()
        guard settings.setupDone, let nextAt = s.nextAt else { return }
        let now = clock()
        var next = scheduleChanged ? BreakSchedule.rescheduleForInterval(s, now: now, intervalMin: settings.intervalMin) : s
        let from = lastBreakAt.map { $0 + settings.intervalMin * minuteMs } ?? 0
        if from > (next.nextAt ?? nextAt) && !(s.pausedUntil > now) {
            next = BreakSchedule.apply("done", to: next, now: now, intervalMin: settings.intervalMin)
            next.windowId = s.windowId
            next.nextAt = from
        }
        if next != s { save(next) }
    }
}
