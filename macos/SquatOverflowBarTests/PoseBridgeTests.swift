import AppKit
import SquatCore
import WebKit
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

    /// Records every fetch() the page makes and how it ended, and every request its
    /// Content-Security-Policy refused. Runs before the page's own scripts.
    private static let recorder = """
    (() => {
      const seen = (window.__poseRequests = []);
      const real = window.fetch;
      window.fetch = (input, init) => {
        const entry = { url: String(input?.url ?? input), outcome: "pending" };
        seen.push(entry);
        const reply = real(input, init);
        reply.then((res) => { entry.outcome = "answered " + res.status; }, () => { entry.outcome = "failed"; });
        return reply;
      };
      document.addEventListener("securitypolicyviolation", (ev) => seen.push({ refused: ev.blockedURI, by: ev.effectiveDirective }));
    })();
    """

    private func recorded(_ view: WKWebView) async throws -> [[String: String]] {
        let text = try await view.evaluateJavaScript("JSON.stringify(window.__poseRequests ?? null)") as? String
        return try JSONDecoder().decode([[String: String]].self, from: Data(try XCTUnwrap(text).utf8))
    }

    private static func isOwn(_ url: String) -> Bool { url.hasPrefix("\(PoseBridge.scheme)://app/") }

    /// MediaPipe's runtime posts usage statistics to https://odml.pa.googleapis.com/v1/log, every
    /// minute and when the model closes. The extension's manifest policy refuses that request, and
    /// PoseWeb/bridge.html carries the same policy: the page reaches the app's own files and nothing else.
    func testThePosePageReachesNoOtherHost() async throws {
        let bridge = PoseBridge()
        let ready = expectation(description: "ready")
        let frame = expectation(description: "frame")
        bridge.onText = { text in
            let type = self.json(text)?["type"]?.string
            if type == "ready" { ready.fulfill() }
            if type == "frame" { frame.fulfill() }
        }
        bridge.connect()
        // Kept past bridge.close(), to read what the page did on its way out.
        let view = try XCTUnwrap(bridge.webView)
        view.configuration.userContentController.addUserScript(
            WKUserScript(source: Self.recorder, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        await fulfillment(of: [ready], timeout: 60)
        bridge.send(.frame(blankJPEG()))
        await fulfillment(of: [frame], timeout: 60)

        bridge.close() // closes the model, which is when MediaPipe sends what it has logged
        // A host of our own choosing too, so the policy stays pinned if MediaPipe stops logging.
        // ".invalid" never resolves, so this request goes nowhere even when the policy is missing.
        let probe = "https://other-host.invalid/"
        _ = try await view.evaluateJavaScript("fetch('\(probe)').catch(() => {}); 0")
        var seen: [[String: String]] = []
        for _ in 0..<150 { // MediaPipe gives its request 10 s
            seen = try await recorded(view)
            if !seen.contains(where: { $0["outcome"] == "pending" }) { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }

        let fetched = seen.compactMap { $0["url"] }
        XCTAssertTrue(fetched.contains { $0.hasSuffix("pose_landmarker_lite.task") }, "the recorder missed the model loading: \(seen)")
        XCTAssertTrue(fetched.contains(probe))
        let refused = Set(seen.compactMap { $0["refused"].flatMap { URL(string: $0)?.host } })
        for entry in seen {
            guard let url = entry["url"], !Self.isOwn(url) else { continue }
            XCTAssertEqual(entry["outcome"], "failed", "\(url) was sent")
            XCTAssertTrue(refused.contains(URL(string: url)?.host ?? ""), "\(url) wasn't refused by the page's policy")
        }
    }
}
