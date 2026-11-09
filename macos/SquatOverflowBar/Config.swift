import Foundation

/// Build settings from project.yml, passed through Info.plist (`SO_SERVER_URL` and friends).
enum Config {
    private static func string(_ key: String, _ fallback: String) -> String {
        let value = Bundle.main.object(forInfoDictionaryKey: key) as? String ?? ""
        return value.isEmpty || value.hasPrefix("$(") ? fallback : value
    }

    /// The optional API server (server/): Google sign-in, the team board and sync. nil when
    /// `SO_SERVER_URL` is empty: the app is then local only, like a build of the extension with no
    /// API_URL (extension/config.js), and offers no sign-in.
    static let serverURL: URL? = serverURL(from: Bundle.main.object(forInfoDictionaryKey: "SOServerURL") as? String)

    /// A trailing slash is dropped so paths can be appended. Empty or an undefined build setting: nil.
    static func serverURL(from raw: String?) -> URL? {
        var value = (raw ?? "").trimmingCharacters(in: .whitespaces)
        if value.isEmpty || value.hasPrefix("$(") { return nil }
        while value.hasSuffix("/") { value.removeLast() }
        return URL(string: value)
    }

    /// The URL for `path` on the API server.
    static func api(_ path: String) throws -> URL {
        guard let base = serverURL else { throw AuthError.noServer }
        return base.appendingPathComponent(path)
    }

    /// The pose WebSocket on a server: http → ws, https → wss, path /ws. The extension's
    /// POSE_SERVER_URL has the same shape; it's the default for the `serverUrl` setting.
    static func poseURL(for server: URL) -> String {
        var c = URLComponents(url: server, resolvingAgainstBaseURL: false) ?? URLComponents()
        c.scheme = c.scheme == "https" ? "wss" : "ws"
        c.path = "/ws"
        return c.string ?? "ws://127.0.0.1:8765/ws"
    }

    static var poseURL: String { serverURL.map { poseURL(for: $0) } ?? "ws://127.0.0.1:8765/ws" }

    static let googleClientID = string(
        "SOGoogleClientID", "977942788346-udafursfj3ns2juas0o7c4knj3pvht3h.apps.googleusercontent.com")

    /// Google redirects here; server/static/mobile-callback.html relays to squatoverflow://auth.
    static var callbackURL: URL? { serverURL?.appendingPathComponent("auth/mobile-callback") }

    static let appScheme = "squatoverflow"

    /// Where the app keeps what the extension keeps in chrome.storage.local.
    static var storeURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("SquatOverflowBar", isDirectory: true).appendingPathComponent("store.json")
    }
}
