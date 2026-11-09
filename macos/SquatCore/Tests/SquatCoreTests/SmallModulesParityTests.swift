import SquatCore
import XCTest

/// extension/lib/activity.js, memes.js, server-status.js, badges.js and i18n.js
final class SmallModulesParityTests: XCTestCase {
    func testRecordActivityKeepsAYear() {
        checkParity("activity.recordActivity") { args in
            let activity = args[0].isNull ? nil : try args[0].as_([String: DayActivity].self)
            return try json(Activity.record(activity, now: try args[1].as_(), xp: args[2].int))
        }
    }

    func testBackfillActivityGroupsTheLogByDay() {
        checkParity("activity.backfillActivity") { args in
            let log = try args[0].as_([JSONValue].self).map { (at: try $0["at"]!.as_(Int.self), xp: $0["xp"]?.int) }
            return try json(Activity.backfill(log))
        }
    }

    func testMemeGroupsTakeTurns() {
        checkParity("memes.MEMES") { _ in try json(Memes.groups) }
        checkParity("memes.takeTurn") { args in
            let turn = Memes.takeTurn(Memes.groups[try args[0].as_(String.self)]!, turn: args[1].int)
            return .object(["clip": .string(turn.clip), "next": .number(Double(turn.next))])
        }
        checkParity("memes.repMarks") { try json(Memes.repMarks(totalReps: try $0[0].as_(), clips: try $0[1].as_())) }
    }

    func testCloseCode1013MeansBusy() {
        checkParity("serverStatus.closeStatus") { .string(PoseStatus.closeStatus(try $0[0].as_()).rawValue) }
    }

    func testBadgeLabels() {
        checkParity("badges.badgeLabel") { .string(Badges.label(try $0[0].as_(), lang: try $0[1].as_())) }
    }

    func testTranslations() {
        checkParity("i18n.t") { args in
            let vars = try args[2].as_([String: JSONValue].self).mapValues { v -> Any in v.number ?? v.string ?? "" }
            return .string(I18n.t(try args[0].as_(), try args[1].as_(), vars))
        }
        checkParity("i18n.resolveLang") { .string(I18n.resolveLang(try $0[0].as_(), browserLang: $0[1].string)) }
        checkParity("i18n.areaName") { .string(I18n.areaName(try $0[0].as_(), try $0[1].as_())) }
        checkParity("i18n.levelName") { .string(I18n.levelName(try $0[0].as_(), try $0[1].as_(), fallback: try $0[2].as_())) }
        checkParity("i18n.exerciseText") {
            .string(I18n.exerciseText(try $0[0].as_(), key: try $0[1].as_(), field: try $0[2].as_(), fallback: try $0[3].as_()))
        }
        checkParity("i18n.issueText") { .string(I18n.issueText(try $0[0].as_(), code: try $0[1].as_(), fallback: try $0[2].as_())) }
    }

    func testEveryEnglishStringHasAnArabicTranslation() {
        XCTAssertEqual(Set(I18n.keys("ar")).isSuperset(of: I18n.keys("en")), true)
        XCTAssertGreaterThan(I18n.keys("en").count, 150)
    }
}
