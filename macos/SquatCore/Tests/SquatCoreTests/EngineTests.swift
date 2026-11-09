import SquatCore
import XCTest

/// extension/service-worker.js: the break timer and what each break action does.
@MainActor
final class EngineTests: XCTestCase {
    final class FakeHost: EngineHost {
        var idle = IdleState.active
        var meeting = false
        var openWindows: Set<Int> = []
        var opened: [(id: Int, manual: Bool)] = []
        var focused: [Int] = []
        var alarm: Millis?
        var nextId = 1
        var syncs = 0

        func idleState(seconds: Int) -> IdleState { idle }
        func inMeeting() -> Bool { meeting }
        func openBreakWindow(manual: Bool) -> Int {
            let id = nextId
            nextId += 1
            openWindows.insert(id)
            opened.append((id, manual))
            return id
        }
        func focusWindow(_ id: Int) { focused.append(id) }
        func isBreakWindowOpen(_ id: Int) -> Bool { openWindows.contains(id) }
        func setAlarm(at: Millis?) { alarm = at }
        func requestSync() { syncs += 1 }
    }

    var store: Store!
    var host: FakeHost!
    var now: Millis = 0
    var engine: Engine!

    /// Local wall-clock time in the fixtures' zone (Berlin); 9 Nov 2026 is a Monday.
    func at(_ day: Int, _ hour: Int, _ minute: Int = 0, month: Int = 11) -> Millis {
        _ = Parity.fixture
        let d = LocalTime.calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
        return LocalTime.millis(d)
    }

    override func setUp() async throws {
        store = Store(MemoryStore())
        host = FakeHost()
        now = at(9, 10, 5)
        engine = Engine(store: store, host: host, clock: { [unowned self] in self.now })
    }

    /// The user closes a break window.
    func close(_ id: Int) {
        host.openWindows.remove(id)
        engine.windowClosed(id)
    }

    func setUpDone(_ patch: [String: JSONValue] = [:]) {
        store.saveSettings(["setupDone": .bool(true), "areas": .array([.string("Neck tension"), .string("Knees")])].merging(patch) { $1 }, now: now)
    }

    let full = BreakResult(scored: true, countedReps: 18, targetReps: 18, scores: Array(repeating: 100, count: 18),
                           moves: [.init(key: "neck_tilt", area: "Neck tension", completed: true),
                                   .init(key: "heel_slide", area: "Knees", completed: true),
                                   .init(key: "chin_tuck", area: "Neck tension", completed: true)])

    // MARK: Timer

    func testNothingIsScheduledBeforeSetupIsDone() {
        engine.start()
        XCTAssertNil(store.schedule().nextAt)
        XCTAssertNil(host.alarm)
    }

    func testFirstBreakIsOneIntervalAfterSetup() {
        setUpDone()
        engine.start()
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 5))
        XCTAssertEqual(host.alarm, at(9, 11, 5))
    }

    func testFirstBreakMovesIntoActiveHours() {
        now = at(9, 16, 30)
        setUpDone()
        engine.start()
        XCTAssertEqual(store.schedule().nextAt, at(10, 10)) // Tuesday 09:00 opens, +60 min
    }

    func testStartupForgetsWindowsFromLastRun() {
        setUpDone()
        var s = BreakSchedule.initial(now: now, intervalMin: 60)
        s.windowId = 4
        s.extraWindowId = 5
        store.setSchedule(s)
        engine.start()
        XCTAssertNil(store.schedule().windowId)
        XCTAssertNil(store.schedule().extraWindowId)
    }

    func testAlarmOpensTheReminderAndKeepsTheGrid() {
        setUpDone()
        engine.start()
        now = at(9, 11, 5)
        engine.alarmFired()
        XCTAssertEqual(host.opened.map(\.manual), [false])
        XCTAssertEqual(store.schedule().windowId, host.opened.first?.id)
        XCTAssertEqual(store.schedule().nextAt, at(9, 12, 5))
    }

    func testIdleUserGetsNoWindowButTheGridMoves() {
        setUpDone()
        engine.start()
        now = at(9, 11, 5)
        host.idle = .idle
        engine.alarmFired()
        XCTAssertTrue(host.opened.isEmpty)
        XCTAssertEqual(store.schedule().nextAt, at(9, 12, 5))
    }

    func testMeetingDefersFiveMinutes() {
        setUpDone()
        engine.start()
        now = at(9, 11, 5)
        host.meeting = true
        engine.alarmFired()
        XCTAssertTrue(host.opened.isEmpty)
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 10))
        XCTAssertEqual(store.schedule().deferredFrom, at(9, 11, 5))
    }

    func testMeetingIsIgnoredWithAutoPauseOff() {
        setUpDone(["autoPause": .bool(false)])
        engine.start()
        now = at(9, 11, 5)
        host.meeting = true
        engine.alarmFired()
        XCTAssertEqual(host.opened.count, 1)
    }

    func testAnOpenReminderIsntOpenedTwice() {
        setUpDone()
        engine.start()
        now = at(9, 11, 5)
        engine.alarmFired()
        now = at(9, 12, 5)
        engine.alarmFired()
        XCTAssertEqual(host.opened.count, 1)
    }

    // MARK: Break now

    func testBreakNowOpensAManualBreakOrFocusesTheOpenOne() {
        setUpDone()
        engine.start()
        engine.breakNow()
        XCTAssertEqual(host.opened.map(\.manual), [true])
        XCTAssertEqual(store.schedule().extraWindowId, host.opened[0].id)
        XCTAssertNil(store.schedule().windowId)
        engine.breakNow()
        XCTAssertEqual(host.opened.count, 1)
        XCTAssertEqual(host.focused, [host.opened[0].id])
    }

    // MARK: Done

    func testDoneAwardsXPLogsTheBreakAndQueuesItForSync() {
        setUpDone()
        engine.start()
        let res = engine.done(result: full, lastKey: "chin_tuck")
        XCTAssertEqual(res.breakdown.breakXp, 10)
        XCTAssertEqual(res.breakdown.firstBreak, 5)
        XCTAssertEqual(store.profile().xp, res.profile.xp)
        XCTAssertEqual(store.profile().xp, res.breakdown.total)
        let log = store.log()
        XCTAssertEqual(log.count, 1)
        XCTAssertEqual(log[0].reps, 18)
        XCTAssertEqual(log[0].moves, 3)
        XCTAssertEqual(log[0].score, 100)
        XCTAssertEqual(log[0].xp, res.breakdown.total)
        XCTAssertTrue(log[0].completed)
        XCTAssertEqual(store.outbox().first?.areas, ["Neck tension", "Knees"])
        XCTAssertEqual(store.activity()?["2026-11-09"], DayActivity(breaks: 1, xp: res.breakdown.total))
        XCTAssertEqual(store.schedule().lastKey, "chin_tuck")
        XCTAssertEqual(store.schedule().breakCount, 1)
        XCTAssertEqual(host.syncs, 1)
    }

    func testDoneResetsSkipsAndTheReminderBecomesAnExtraWindow() {
        setUpDone()
        engine.start()
        now = at(9, 11, 5)
        engine.alarmFired()
        let id = host.opened[0].id
        var s = store.schedule()
        s.skipsInRow = 2
        store.setSchedule(s)
        _ = engine.done(result: full, lastKey: nil)
        XCTAssertEqual(store.schedule().skipsInRow, 0)
        XCTAssertNil(store.schedule().windowId)
        XCTAssertEqual(store.schedule().extraWindowId, id)
        close(id) // closing the summary isn't a skip
        XCTAssertEqual(store.schedule().skipsInRow, 0)
    }

    func testUnscoredDoneLogsABreakWithNoXP() {
        setUpDone()
        engine.start()
        let res = engine.done(result: BreakResult(scored: false, countedReps: 0, targetReps: 18, scores: [], moves: []), lastKey: nil)
        XCTAssertEqual(res.breakdown.total, 0)
        XCTAssertEqual(store.log().first?.score, nil)
        XCTAssertEqual(store.log().first?.completed, false)
    }

    // MARK: Snooze, skip, close, pause

    func testSnoozeIsTwentyMinutesAndCappedAtTwoInARow() {
        setUpDone()
        engine.start()
        engine.breakAction("snooze")
        XCTAssertEqual(store.schedule().nextAt, at(9, 10, 25))
        engine.breakAction("snooze")
        now = at(9, 10, 30)
        engine.breakAction("snooze")
        XCTAssertEqual(store.schedule().snoozesInRow, 2)
        XCTAssertEqual(store.schedule().nextAt, at(9, 10, 25))
    }

    func testSkipCountsAndEndsTheNoExcusesRun() {
        setUpDone()
        engine.start()
        _ = engine.done(result: full, lastKey: nil)
        XCTAssertEqual(store.profile().daily?.run, 1)
        engine.breakAction("skip")
        XCTAssertEqual(store.schedule().skipsInRow, 1)
        XCTAssertEqual(store.profile().daily?.run, 0)
    }

    func testClosingTheReminderCountsAsASkipButClosingBreakNowDoesnt() {
        setUpDone()
        engine.start()
        engine.breakNow()
        close(host.opened[0].id)
        XCTAssertEqual(store.schedule().skipsInRow, 0)
        now = at(9, 11, 5)
        engine.alarmFired()
        XCTAssertEqual(host.opened.count, 2)
        close(host.opened[1].id)
        XCTAssertEqual(store.schedule().skipsInRow, 1)
    }

    func testPauseIsAnHourAndResumeStartsAFreshInterval() {
        setUpDone()
        engine.start()
        engine.pause()
        XCTAssertEqual(store.schedule().pausedUntil, at(9, 11, 5))
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 5))
        now = at(9, 10, 20)
        engine.resume()
        XCTAssertEqual(store.schedule().pausedUntil, 0)
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 20))
    }

    // MARK: Settings and sync

    func testSavingSettingsFirstTimeStartsTheTimer() {
        engine.start()
        setUpDone()
        engine.settingsSaved(scheduleChanged: false)
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 5))
        XCTAssertEqual(host.syncs, 1)
    }

    func testANewIntervalReschedulesFromNow() {
        setUpDone()
        engine.start()
        now = at(9, 10, 30)
        store.saveSettings(["intervalMin": .number(30)], now: now)
        engine.settingsSaved(scheduleChanged: true)
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 0))
    }

    func testABreakOnAnotherDeviceMovesTheNextBreak() {
        setUpDone()
        engine.start()
        now = at(9, 10, 40)
        engine.afterSync(scheduleChanged: false, lastBreakAt: at(9, 10, 30))
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 30))
        // an older break elsewhere never pulls it earlier
        engine.afterSync(scheduleChanged: false, lastBreakAt: at(9, 9, 0))
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 30))
    }

    func testABreakElsewhereDoesntEndAPause() {
        setUpDone()
        engine.start()
        engine.pause()
        engine.afterSync(scheduleChanged: false, lastBreakAt: at(9, 10, 30))
        XCTAssertEqual(store.schedule().nextAt, at(9, 11, 5))
    }
}
