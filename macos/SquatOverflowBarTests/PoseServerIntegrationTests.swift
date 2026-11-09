import CoreImage
import QuartzCore
import SquatCore
import XCTest
@testable import SquatOverflowBar

/// The break's pose conversation against a real pose server (cd server && npm run start:dev).
/// Skipped when none is running on the build's server URL.
@MainActor
final class PoseServerIntegrationTests: XCTestCase {
    private var url: URL { URL(string: Config.poseURL)! }

    private func requireServer() async throws {
        let server = try XCTUnwrap(Config.serverURL, "no server URL in this build")
        let health = server.appendingPathComponent("health")
        let ok = (try? await URLSession.shared.data(from: health)).map { ($0.1 as? HTTPURLResponse)?.statusCode == 200 } ?? false
        try XCTSkipUnless(ok, "no pose server at \(server)")
    }

    func testTheCatalogHasEveryPainArea() async throws {
        try await requireServer()
        let catalog = await PoseSocket.fetchCatalog(url)
        XCTAssertEqual(Set(catalog.map(\.category)), Set(Routine.areas))
        XCTAssertEqual(Routine.build(catalog: catalog, areas: ["Neck tension", "Knees"], lastKey: nil, n: 0).count, 3)
    }

    func testAFrameComesBackScoredForTheChosenExercise() async throws {
        try await requireServer()
        let socket = PoseSocket()
        var frames: [PoseFrame] = []
        var statuses: [PoseStatus] = []
        let gotFrame = expectation(description: "a frame result")
        let link = PoseLink(privacy: true, send: { socket.send($0) }, now: { CACurrentMediaTime() },
                            onFrame: { frames.append($0); if frames.count == 1 { gotFrame.fulfill() } },
                            onStatus: { statuses.append($0) }, onCatalog: { _ in })
        link.setExercise("neck_tilt")
        socket.onOpen = {
            link.opened()
            // An empty grey picture: no one in it, so the server says "not visible".
            let image = CIImage(color: CIColor(red: 0.5, green: 0.5, blue: 0.5)).cropped(to: CGRect(x: 0, y: 0, width: 640, height: 480))
            if let jpeg = Camera().jpeg(image) { link.sendFrame(jpeg) }
        }
        socket.onText = { link.received($0) }
        socket.onClose = { link.closed(code: $0) }
        link.start()
        socket.connect(url)
        await fulfillment(of: [gotFrame], timeout: 20)
        socket.close()
        XCTAssertEqual(statuses.prefix(2), [.connecting, .open])
        XCTAssertEqual(frames.first?.exercise, "neck_tilt")
        XCTAssertEqual(frames.first?.reps, 0)
        XCTAssertEqual(frames.first?.feedbackCodes, ["not_visible"])
        XCTAssertTrue(link.wantsFrame, "the reply frees the slot for the next frame")
    }
}
