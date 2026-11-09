import Foundation

/// Build settings from project.yml, passed through Info.plist (`SO_SERVER_URL` and friends).
enum Config {
    private static func string(_ key: String, _ fallback: String) -> String {
        let value = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
        return value.isEmpty || value.hasPrefix("$(") ? fallback : value
    }

    /// The NestJS server. A trailing slash is dropped so paths can be appended.
    static let serverURL: URL = {
        var raw = string("SOServerURL", "http://127.0.0.1:8765")
        while raw.hasSuffix("/") { raw.removeLast() }
        return URL(string: raw) ?? URL(string: "http://127.0.0.1:8765")!
    }()

    /// The pose WebSocket on a server: http → ws, https → wss, path /ws. The extension's
    /// POSE_SERVER_URL has the same shape; it's the default for the `serverUrl` setting.
    static func poseURL(for server: URL) -> String {
        var c = URLComponents(url: server, resolvingAgainstBaseURL: false) ?? URLComponents()
        c.scheme = c.scheme == "https" ? "wss" : "ws"
        c.path = "/ws"
        return c.string ?? "ws://127.0.0.1:8765/ws"
    }

    static var poseURL: String { poseURL(for: serverURL) }

    static let googleClientID = string(
        "SOGoogleClientID", "977942788346-udafursfj3ns2juas0o7c4knj3pvht3h.apps.googleusercontent.com")

    /// Google redirects here; server/static/mobile-callback.html relays to squatoverflow://auth.
    static var callbackURL: URL { serverURL.appendingPathComponent("auth/mobile-callback") }

    static let appScheme = "squatoverflow"

    /// Where the app keeps what the extension keeps in chrome.storage.local.
    static var storeURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("SquatOverflowBar", isDirectory: true).appendingPathComponent("store.json")
    }
}
