import SquatCore
import XCTest
@testable import SquatOverflowBar

/// The app's own wiring. The rules it runs (schedule, XP, routine, sync, the break itself) are
/// tested in SquatCore against the extension's answers.
final class AppTests: XCTestCase {
    func testThePoseSocketIsTheServersWS() {
        XCTAssertEqual(Config.poseURL(for: URL(string: "http://127.0.0.1:8765")!), "ws://127.0.0.1:8765/ws")
        XCTAssertEqual(Config.poseURL(for: URL(string: "https://pose.example.com")!), "wss://pose.example.com/ws")
    }

    func testEveryMemeClipIsBundled() {
        for clip in Set(Memes.groups.values.joined()) {
            XCTAssertNotNil(Sounds.url(forClip: clip), "\(clip).m4a is missing from the app")
        }
    }

    func testNothingIsHandedToChrome() {
        let info = Bundle.main.infoDictionary ?? [:]
        XCTAssertNil(info["SOExtensionID"])
        XCTAssertNotNil(info["NSCameraUsageDescription"], "the break needs the camera")
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
