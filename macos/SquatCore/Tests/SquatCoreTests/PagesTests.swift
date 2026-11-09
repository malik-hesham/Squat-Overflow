import SquatCore
import XCTest

/// Rules of the extension's popup and options pages that the Mac menu and settings window follow.
final class PagesTests: XCTestCase {
    let now: Millis = 1_794_218_400_000 // Mon 9 Nov 2026, 11:00 in Berlin

    override func setUp() { _ = Parity.fixture }

    // MARK: auth.js

    func testCompanyFromEmail() {
        checkParity("auth.companyFromEmail") { args in
            Account.companyFromEmail(args[0].string).map(JSONValue.string) ?? .null
        }
    }

    // MARK: options.js problem()

    func valid() -> Settings {
        var s = Settings()
        s.areas = ["Knees"]
        return s
    }

    func problem(_ change: (inout Settings) -> Void, email: String? = nil) -> String? {
        var s = valid()
        change(&s)
        return SettingsForm.problem(s, email: email, lang: "en")
    }

    func testAValidFormHasNoProblem() {
        XCTAssertNil(problem { _ in })
    }

    func testIntervalMustBe1To240Minutes() {
        XCTAssertEqual(problem { $0.intervalMin = 0 }, I18n.t("en", "errInterval"))
        XCTAssertEqual(problem { $0.intervalMin = 241 }, I18n.t("en", "errInterval"))
        XCTAssertNil(problem { $0.intervalMin = 240 })
    }

    func testAtLeastOneAreaAndOneWorkday() {
        XCTAssertEqual(problem { $0.areas = [] }, I18n.t("en", "errAreas"))
        XCTAssertEqual(problem { $0.workdays = [] }, I18n.t("en", "errWorkdays"))
    }

    func testActiveHoursMustStartBeforeTheyEnd() {
        XCTAssertEqual(problem { $0.activeStart = "17:00" }, I18n.t("en", "errHours"))
        XCTAssertEqual(problem { $0.activeEnd = "" }, I18n.t("en", "errHours"))
    }

    func testCompetitiveNeedsANameAndAWorkEmail() {
        XCTAssertEqual(problem({ $0.mode = "competitive" }, email: "sam@acme.io"), I18n.t("en", "errName"))
        XCTAssertEqual(problem({ $0.mode = "competitive"; $0.name = "Sam" }, email: "sam@gmail.com"), I18n.t("en", "errCompany"))
        XCTAssertEqual(problem({ $0.mode = "competitive"; $0.name = "Sam" }, email: nil), I18n.t("en", "errCompany"))
        XCTAssertNil(problem({ $0.mode = "competitive"; $0.name = "Sam" }, email: "sam@acme.io"))
    }

    func testIntervalPresets() {
        XCTAssertEqual(SettingsForm.presets, [30, 45, 60, 90, 120])
    }

    // MARK: popup.js next-break line

    func line(_ s: ScheduleState, _ settings: Settings = Settings(), now: Millis? = nil) -> String {
        Popup.nextText(schedule: s, settings: settings, now: now ?? self.now, lang: "en", time: { "T\(XP.dayKey($0))@\(LocalTime.minutesOfDay($0))" },
                       weekday: { "D\(LocalTime.weekday($0))" })
    }

    func testCountsDownInMinutesThenSeconds() {
        var s = ScheduleState()
        s.nextAt = now + 25 * minuteMs + 1
        XCTAssertEqual(line(s), I18n.t("en", "nextAt", ["time": "T2026-11-09@685", "n": 26]))
        s.nextAt = now + 42_000
        XCTAssertEqual(line(s), I18n.t("en", "nextAtSecs", ["time": "T2026-11-09@660", "n": 42]))
    }

    func testPausedShowsWhenItEnds() {
        var s = ScheduleState()
        s.nextAt = now + hourMs
        s.pausedUntil = now + hourMs
        XCTAssertEqual(line(s), I18n.t("en", "pausedUntil", ["time": "T2026-11-09@720"]))
    }

    func testOutsideActiveHoursShowsTheDay() {
        var s = ScheduleState()
        s.nextAt = now + dayMs
        XCTAssertEqual(line(s, now: now + 8 * hourMs), I18n.t("en", "outsideHours", ["day": "D2", "time": "T2026-11-10@660"]))
    }

    func testNotScheduledBeforeSetup() {
        XCTAssertEqual(line(ScheduleState()), I18n.t("en", "notScheduled"))
    }

    func testASnoozeListsTheShiftedTimes() {
        var s = ScheduleState()
        s.nextAt = now + 20 * minuteMs
        s.shiftedBy = 20
        let times = (0..<3).map { "T2026-11-09@\(680 + 60 * $0)" }.joined(separator: " · ")
        XCTAssertEqual(Popup.shiftedText(schedule: s, settings: Settings(), now: now, lang: "en",
                                         time: { "T\(XP.dayKey($0))@\(LocalTime.minutesOfDay($0))" }),
                       I18n.t("en", "shifted", ["n": 20, "times": times]))
        s.shiftedBy = 0
        XCTAssertNil(Popup.shiftedText(schedule: s, settings: Settings(), now: now, lang: "en", time: { _ in "" }))
    }

    func testTodaysBreaksCountTheLogsLocalDay() {
        let log = [now - dayMs, now - hourMs, now].map { LogEntry(at: $0, reps: 1, moves: 1, score: nil, xp: 0, scored: false, completed: false) }
        XCTAssertEqual(Popup.todayBreaks(log, now: now), 2)
    }
}
