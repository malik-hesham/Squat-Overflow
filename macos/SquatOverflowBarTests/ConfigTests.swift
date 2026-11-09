import XCTest
@testable import SquatOverflowBar

/// The API server is optional, like the extension's API_URL (extension/config.js): with none, the
/// app is local only (countdown and Break now), offers no sign-in and makes no requests.
final class ConfigTests: XCTestCase {
    func testAServerURLLosesItsTrailingSlash() {
        XCTAssertEqual(Config.serverURL(from: "https://api.example.com/"), URL(string: "https://api.example.com"))
        XCTAssertEqual(Config.serverURL(from: "http://127.0.0.1:8765"), URL(string: "http://127.0.0.1:8765"))
    }

    func testNoServerURLMeansLocalOnly() {
        XCTAssertNil(Config.serverURL(from: ""))
        XCTAssertNil(Config.serverURL(from: "   "))
        XCTAssertNil(Config.serverURL(from: nil))
        XCTAssertNil(Config.serverURL(from: "$(SO_SERVER_URL)")) // the build setting wasn't defined
    }
}
