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

    /// The extension's fixed ID (from the manifest "key"), for its start and options pages.
    static let extensionID = string("SOExtensionID", "lpkaoaegdjhciohkfidnmabjigidofnd")

    /// extension/start.html: sends the popup's "break-now" message, then closes its tab.
    static var startURL: URL { URL(string: "chrome-extension://\(extensionID)/start.html")! }

    static var optionsURL: URL { URL(string: "chrome-extension://\(extensionID)/options.html")! }

    static let googleClientID = string(
        "SOGoogleClientID", "977942788346-udafursfj3ns2juas0o7c4knj3pvht3h.apps.googleusercontent.com")

    /// Google redirects here; server/static/mobile-callback.html relays to squatoverflow://auth.
    static var callbackURL: URL { serverURL.appendingPathComponent("auth/mobile-callback") }

    static let appScheme = "squatoverflow"
}
