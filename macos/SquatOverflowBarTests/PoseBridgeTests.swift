import AppKit
import SquatCore
import XCTest
@testable import SquatOverflowBar

/// PoseBridge runs the extension's lib/pose gateway and MediaPipe model in a web view on this Mac.
/// These start the real model on a blank camera frame, like extension/tests/e2e/break-offline.mjs.
@MainActor
final class PoseBridgeTests: XCTestCase {
    /// A uniform gray JPEG, as Camera.jpeg() would make from an empty room.
    private func blankJPEG(width: Int = 480, height: Int = 360) -> Data {
        let ctx = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        ctx.setFillColor(gray: 0.25, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: width, height: height))
        return NSBitmapImageRep(cgImage: ctx.makeImage()!).representation(using: .jpeg, properties: [.compressionFactor: 0.7])!
    }

    private func json(_ text: String) -> JSONValue? { try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

    func testTheExtensionsPoseModelAnswersOnThisMac() async throws {
        let bridge = PoseBridge()
        var replies: [JSONValue] = []
        let ready = expectation(description: "ready")
        let frame = expectation(description: "frame")
        bridge.onText = { text in
            guard let msg = self.json(text) else { return XCTFail("not JSON: \(text.prefix(80))") }
            replies.append(msg)
            if msg["type"]?.string == "ready" { ready.fulfill() }
            if msg["type"]?.string == "frame" { frame.fulfill() }
        }
        bridge.onClose = { code in XCTFail("closed with \(code)") }
        bridge.connect()
        await fulfillment(of: [ready], timeout: 60)
        XCTAssertEqual(replies.first?["exercises"]?.array?.count, Exercise.catalog.count, "ready lists lib/pose's catalog")

        bridge.send(.text(#"{"type":"privacy","enabled":true}"#))
        bridge.send(.frame(blankJPEG()))
        await fulfillment(of: [frame], timeout: 60)
        let f = try XCTUnwrap(replies.first { $0["type"]?.string == "frame" })
        XCTAssertEqual(f["landmarks"], .null, "nobody in a blank frame")
        XCTAssertEqual(f["feedback"]?.array?.first?["code"]?.string, "not_visible")
        XCTAssertEqual(f["mask"], .null, "privacy on, nobody found: the whole frame gets blurred")
        bridge.close()
    }
}
