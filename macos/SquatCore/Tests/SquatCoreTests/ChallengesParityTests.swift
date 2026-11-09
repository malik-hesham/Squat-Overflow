import SquatCore
import XCTest

/// extension/lib/challenges.js and award() in extension/lib/xp.js
final class ChallengesParityTests: XCTestCase {
    func testDailyForPicksTwoToFiveChallengesPerDay() {
        checkParity("challenges.dailyFor") { try json(Challenges.dailyFor(try $0[0].as_(Int.self))) }
    }

    func testWithPeriodsStartsNewDayAndWeek() {
        checkParity("challenges.withPeriods") { try json(Challenges.withPeriods(try $0[0].as_(Profile.self), now: try $0[1].as_())) }
    }

    func testNoteActionResetsTheNoExcusesRun() {
        checkParity("challenges.noteAction") {
            try json(Challenges.noteAction(try $0[0].as_(Profile.self), action: try $0[1].as_(), now: try $0[2].as_()))
        }
    }

    func testAward() {
        checkParity("xp.award") { args in
            try json(XP.award(try args[0].as_(Profile.self), result: try args[1].as_(BreakResult.self), now: try args[2].as_(), workdays: try args[3].as_()))
        }
    }
}
