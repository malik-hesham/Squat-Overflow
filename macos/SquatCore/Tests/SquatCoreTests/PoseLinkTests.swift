import SquatCore
import XCTest

/// The protocol half of extension/lib/pose-client.js: what goes over the pose server's /ws and
/// when (server/src/pose/protocol.ts).
@MainActor
final class PoseLinkTests: XCTestCase {
    var sentText: [JSONValue] = []
    var sentFrames = 0
    var frames: [PoseFrame] = []
    var statuses: [PoseStatus] = []
    var catalogs: [[Exercise]] = []
    var clock = 0.0
    var link: PoseLink!

    override func setUp() async throws {
        link = makeLink(privacy: true)
    }

    func makeLink(privacy: Bool) -> PoseLink {
        PoseLink(
            privacy: privacy,
            send: { [unowned self] message in
                switch message {
                case .text(let t): self.sentText.append(try! JSONDecoder().decode(JSONValue.self, from: Data(t.utf8)))
                case .frame: self.sentFrames += 1
                }
            },
            now: { [unowned self] in self.clock },
            onFrame: { [unowned self] in self.frames.append($0) },
            onStatus: { [unowned self] in self.statuses.append($0) },
            onCatalog: { [unowned self] in self.catalogs.append($0) })
    }

    func frameReply(_ exercise: String, reps: Int = 0, extra: [String: JSONValue] = [:]) -> String {
        var o: [String: JSONValue] = ["type": .string("frame"), "exercise": .string(exercise), "feedback": .array([]),
                                      "summary": .object(["reps": .number(Double(reps))]), "rep_event": .null]
        o.merge(extra) { $1 }
        return JSONValue.object(o).canonical
    }

    func testOpeningSendsTheExerciseAndAsksForAMaskWhenBlurring() {
        link.start()
        link.setExercise("neck_tilt")
        link.opened()
        XCTAssertEqual(statuses, [.connecting, .open])
        XCTAssertEqual(sentText, [
            .object(["type": .string("config"), "exercise": .string("neck_tilt")]),
            .object(["type": .string("privacy"), "enabled": .bool(true)]),
        ])
    }

    func testNoMaskWithoutPrivacy() {
        link = makeLink(privacy: false)
        link.start()
        link.opened()
        XCTAssertEqual(sentText.last, .object(["type": .string("privacy"), "enabled": .bool(false)]))
    }

    func testOneFrameInFlightAtATime() {
        link.start()
        link.setExercise("neck_tilt")
        link.opened()
        XCTAssertTrue(link.wantsFrame)
        link.sendFrame(Data([1, 2, 3]))
        XCTAssertFalse(link.wantsFrame)
        link.sendFrame(Data([4]))
        XCTAssertEqual(sentFrames, 1)
        link.received(frameReply("neck_tilt"))
        XCTAssertTrue(link.wantsFrame)
    }

    func testAnErrorReplyFreesTheSlot() {
        link.start()
        link.opened()
        link.sendFrame(Data([1]))
        link.received(#"{"type":"error","message":"could not decode frame"}"#)
        XCTAssertTrue(link.wantsFrame)
    }

    func testAFrameStuckForThreeSecondsIsGivenUp() {
        link.start()
        link.opened()
        link.sendFrame(Data([1]))
        clock = 2.9
        link.tick()
        XCTAssertFalse(link.wantsFrame)
        clock = 3.1
        link.tick()
        XCTAssertTrue(link.wantsFrame)
    }

    func testNoFramesBeforeTheSocketOpens() {
        link.start()
        XCTAssertFalse(link.wantsFrame)
    }

    func testRepliesForAnotherExerciseAreIgnored() {
        link.start()
        link.setExercise("neck_tilt")
        link.opened()
        link.sendFrame(Data([1]))
        link.setExercise("chin_tuck")
        link.received(frameReply("neck_tilt", reps: 3))
        XCTAssertTrue(frames.isEmpty)
        XCTAssertTrue(link.wantsFrame) // the slot is free either way
        XCTAssertEqual(sentText.last, .object(["type": .string("config"), "exercise": .string("chin_tuck")]))
    }

    func testFramesCarryRepsFeedbackAndRepEvents() throws {
        link.start()
        link.setExercise("neck_tilt")
        link.opened()
        link.received(frameReply("neck_tilt", reps: 2, extra: [
            "feedback": .array([.object(["code": .string("not_visible"), "text": .string("Step into frame")])]),
            "rep_event": .object(["score": .number(91), "partial": .bool(false), "issues": .array([.string("too_fast")]),
                                  "issue_text": .array([.string("Slow down")])]),
            "landmarks": .array([.array([.number(0.5), .number(0.4), .number(0.9)])]),
        ]))
        let f = try XCTUnwrap(frames.first)
        XCTAssertEqual(f.reps, 2)
        XCTAssertEqual(f.feedbackCodes, ["not_visible"])
        XCTAssertEqual(f.repEvent?.score, 91)
        XCTAssertEqual(f.repEvent?.partial, false)
        XCTAssertEqual(f.repEvent?.issues, ["too_fast"])
        XCTAssertEqual(f.repEvent?.issueText, ["Slow down"])
        XCTAssertEqual(f.landmarks?.first, [0.5, 0.4, 0.9])
    }

    func testReadyHandsOverTheCatalog() {
        link.start()
        link.received(#"{"type":"ready","exercises":[{"key":"neck_tilt","label":"Neck tilt","category":"Neck tension","camera":"front","how_to":"Tilt","stance":"seated","demo":null}],"connections":[[11,12]]}"#)
        XCTAssertEqual(catalogs.first?.map(\.key), ["neck_tilt"])
        XCTAssertEqual(link.connections, [[11, 12]])
    }

    func testClose1013MeansTheServerIsBusy() {
        link.start()
        link.closed(code: 1013)
        XCTAssertEqual(statuses.last, .busy)
    }

    func testAnyOtherCloseMeansOffline() {
        link.start()
        link.opened()
        link.closed(code: 1006)
        XCTAssertEqual(statuses.last, .offline)
    }

    func testNoStatusAfterStop() {
        link.start()
        link.stop()
        link.closed(code: 1006)
        XCTAssertEqual(statuses, [.connecting])
    }

    func testMasksGoStaleAfterHalfASecond() {
        link.start()
        link.setExercise("neck_tilt")
        link.opened()
        link.received(frameReply("neck_tilt", extra: ["mask": .string("data:image/png;base64,AAAA")]))
        XCTAssertEqual(link.freshMask, "data:image/png;base64,AAAA")
        clock = 0.6
        XCTAssertNil(link.freshMask)
        link.received(frameReply("neck_tilt", extra: ["mask": .null]))
        XCTAssertNil(link.freshMask)
    }

    func testChangingTheLookTellsTheServerAndDropsTheMask() {
        link.start()
        link.opened()
        link.received(frameReply("", extra: ["mask": .string("data:x")]))
        link.setPrivacy(false)
        XCTAssertNil(link.freshMask)
        XCTAssertEqual(sentText.last, .object(["type": .string("privacy"), "enabled": .bool(false)]))
    }
}
