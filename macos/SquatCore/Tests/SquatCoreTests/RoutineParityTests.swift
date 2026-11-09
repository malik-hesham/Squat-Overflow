import SquatCore
import XCTest

/// extension/lib/routine.js
final class RoutineParityTests: XCTestCase {
    func testConstants() {
        checkParity("routine.constants") { _ in .object(["AREAS": try json(Routine.areas), "BREAK_REPS": .number(Double(Routine.breakReps))]) }
    }

    func testCurrentAreasMapsLegacyNames() {
        checkParity("routine.currentAreas") { try json(Routine.currentAreas(try $0[0].as_([String].self))) }
    }

    func testFeaturedAreaRotatesWeekly() {
        checkParity("routine.featuredArea") { .string(Routine.featuredArea(try $0[0].as_(Int.self))) }
    }

    func testBuildRoutine() {
        checkParity("routine.buildRoutine") { args in
            let opts = args[1]
            return try json(Routine.build(catalog: Parity.catalogs[try args[0].as_(Int.self)], areas: try opts["areas"]!.as_(),
                                          lastKey: try opts["lastKey"]?.as_(String?.self) ?? nil, n: try opts["n"]!.as_()))
        }
    }

    func testSwapMove() {
        checkParity("routine.swapMove") { args in
            try json(Routine.swapMove(catalog: Parity.catalogs[try args[0].as_(Int.self)], moves: try args[1].as_(), index: try args[2].as_()))
        }
    }

    func testNeedsPositioning() {
        checkParity("routine.needsPositioning") { .bool(Routine.needsPositioning(try $0[0].as_(Move.self))) }
    }

    func testNextOpenMove() {
        checkParity("routine.nextOpenMove") { args in
            let reps = try args[1].as_([JSONValue].self).map { try $0["reps"]!.as_(Int.self) }
            return .number(Double(Routine.nextOpenMove(moves: try args[0].as_(), reps: reps, from: try args[2].as_())))
        }
    }
}
