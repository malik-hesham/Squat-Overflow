import SquatCore
import XCTest

/// extension/lib/xp.js
final class XPParityTests: XCTestCase {
    func testLevelFor() {
        checkParity("xp.levelFor") { try json(XP.levelFor(xp: $0[0].as_(Int.self))) }
    }

    func testDayKeyIsLocalDate() {
        checkParity("xp.dayKey") { .string(XP.dayKey(try $0[0].as_(Int.self))) }
    }

    func testISOWeek() {
        checkParity("xp.isoWeek") { .string(XP.isoWeek(try $0[0].as_(Int.self))) }
        checkParity("xp.isoWeekNumber") { .number(Double(XP.isoWeekNumber(try $0[0].as_(Int.self)))) }
    }

    func testBreakXp() {
        checkParity("xp.breakXp") { args in
            let r = args[0]
            return .number(Double(XP.breakXp(countedReps: try r["countedReps"]!.as_(), targetReps: try r["targetReps"]!.as_(),
                                             scores: try r["scores"]!.as_())))
        }
    }
}
