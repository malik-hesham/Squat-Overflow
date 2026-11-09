import XCTest
@testable import SquatOverflowBar

final class ScheduleTests: XCTestCase {
    private var cal: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Berlin")!
        return c
    }()

    /// A local time in the test calendar. 2026-11-09 is a Monday.
    private func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        cal.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    private let s = ScheduleSettings(intervalMin: 60, activeStart: "09:00", activeEnd: "17:00", workdays: [1, 2, 3, 4, 5])

    func testCountdownText() {
        XCTAssertEqual(Schedule.countdownText(0), "move")
        XCTAssertEqual(Schedule.countdownText(-5), "move")
        XCTAssertEqual(Schedule.countdownText(30.2), "31s")
        XCTAssertEqual(Schedule.countdownText(60), "1m")
        XCTAssertEqual(Schedule.countdownText(61), "2m")
        XCTAssertEqual(Schedule.countdownText(99 * 60), "99m")
        XCTAssertEqual(Schedule.countdownText(150 * 60), "3h")
    }

    func testOneIntervalAfterTheLastBreak() {
        let next = Schedule.nextBreak(now: at(9, 10, 15), lastBreakAt: at(9, 10), settings: s, calendar: cal)
        XCTAssertEqual(next, at(9, 11))
    }

    func testNoBreakYetCountsFromTheWindowOpening() {
        let next = Schedule.nextBreak(now: at(9, 9, 20), lastBreakAt: nil, settings: s, calendar: cal)
        XCTAssertEqual(next, at(9, 10))
        // Yesterday's break doesn't count against today's window.
        let y = Schedule.nextBreak(now: at(10, 9, 20), lastBreakAt: at(9, 16), settings: s, calendar: cal)
        XCTAssertEqual(y, at(10, 10))
    }

    func testJustMissedShowsDueThenStepsForward() {
        let due = Schedule.nextBreak(now: at(9, 11, 5), lastBreakAt: at(9, 10), settings: s, calendar: cal)
        XCTAssertEqual(due, at(9, 11))
        let stepped = Schedule.nextBreak(now: at(9, 11, 30), lastBreakAt: at(9, 10), settings: s, calendar: cal)
        XCTAssertEqual(stepped, at(9, 12))
    }

    func testAfterHoursMovesToTheNextWorkday() {
        // Friday evening → Monday 09:00 + one interval.
        let fri = Schedule.nextBreak(now: at(13, 18), lastBreakAt: at(13, 16, 30), settings: s, calendar: cal)
        XCTAssertEqual(fri, at(16, 10))
        // A break due after closing time moves to tomorrow's first slot.
        let late = Schedule.nextBreak(now: at(9, 16, 30), lastBreakAt: at(9, 16, 20), settings: s, calendar: cal)
        XCTAssertEqual(late, at(10, 10))
    }

    func testDayAndWeekKeys() {
        let tz = cal.timeZone
        var c = cal
        c.timeZone = tz
        XCTAssertEqual(Schedule.dayKey(at(9, 0, 30), c), "2026-11-09")
        XCTAssertEqual(Schedule.isoWeek(at(9, 12), timeZone: tz), "2026-W46")
        // 2027-01-01 is a Friday: still ISO week 53 of 2026.
        let newYear = cal.date(from: DateComponents(year: 2027, month: 1, day: 1, hour: 12))!
        XCTAssertEqual(Schedule.isoWeek(newYear, timeZone: tz), "2026-W53")
    }

    func testLevelProgress() {
        XCTAssertEqual(Levels.progress(xp: 0).next, 100)
        XCTAssertEqual(Levels.progress(xp: 175).fraction, 0.5, accuracy: 0.0001)
        XCTAssertNil(Levels.progress(xp: 5000).next)
    }

    func testSettingsFallBackToDefaults() throws {
        let json = #"{"doc":{"intervalMin":45,"activeStart":"bogus","workdays":[1,2,9]},"version":3}"#
        let r = try JSONDecoder().decode(SettingsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(r.version, 3)
        XCTAssertEqual(r.settings.intervalMin, 45)
        XCTAssertEqual(r.settings.activeStart, "09:00")
        XCTAssertEqual(r.settings.activeEnd, "17:00")
        XCTAssertEqual(r.settings.workdays, [1, 2])
    }

    func testSignedOutCountsDownOnTheExtensionDefaults() {
        // SETTINGS_DEFAULTS in extension/lib/store.js.
        let s = AppModel.countdownSettings(signedIn: false, synced: nil)
        XCTAssertEqual(s, ScheduleSettings(intervalMin: 60, activeStart: "09:00", activeEnd: "17:00", workdays: [1, 2, 3, 4, 5]))
        // Signed in, it waits for the synced settings instead of showing the defaults first.
        XCTAssertNil(AppModel.countdownSettings(signedIn: true, synced: nil))
        var synced = ScheduleSettings()
        synced.intervalMin = 30
        XCTAssertEqual(AppModel.countdownSettings(signedIn: true, synced: synced)?.intervalMin, 30)
    }

    func testBreakNowOpensTheExtensionsStartPage() {
        // extension/start.html sends the popup's "break-now" message; no server or hosted page involved.
        XCTAssertEqual(Config.startURL.absoluteString, "chrome-extension://lpkaoaegdjhciohkfidnmabjigidofnd/start.html")
        XCTAssertEqual(Config.optionsURL.absoluteString, "chrome-extension://lpkaoaegdjhciohkfidnmabjigidofnd/options.html")
    }

    func testIdTokenFromRedirect() {
        XCTAssertEqual(Auth.idToken(from: URL(string: "squatoverflow://auth?id_token=abc.def&authuser=0")!), "abc.def")
        XCTAssertNil(Auth.idToken(from: URL(string: "squatoverflow://auth?error=access_denied")!))
        XCTAssertNil(Auth.idToken(from: URL(string: "squatoverflow://auth")!))
    }

    func testSignInURLSendsTheHashedNonce() {
        let nonce = "00112233445566778899aabbccddeeff"
        let hashed = Auth.sha256Hex(nonce)
        XCTAssertEqual(hashed.count, 64)
        let items = URLComponents(url: Auth.signInURL(hashedNonce: hashed), resolvingAgainstBaseURL: false)!.queryItems!
        let q = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        XCTAssertEqual(q["nonce"], hashed)
        XCTAssertEqual(q["response_type"], "id_token")
        XCTAssertEqual(q["client_id"], Config.googleClientID)
        XCTAssertTrue(q["redirect_uri"]!.hasSuffix("/auth/mobile-callback"))
    }
}
