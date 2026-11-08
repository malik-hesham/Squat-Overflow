import AppKit
import AuthenticationServices
import CryptoKit
import Foundation

/// A session from POST /auth/google or /auth/refresh, as the extension's toSession() keeps it.
struct Session: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var expiresAt: Date
    var userId: String
    var email: String
    var name: String
}

/// The server's SessionResponse (server/src/auth/auth.service.ts).
private struct SessionResponse: Decodable {
    struct User: Decodable {
        struct Meta: Decodable { var full_name: String? }
        var id: String
        var email: String
        var user_metadata: Meta?
    }
    var access_token: String
    var refresh_token: String
    var expires_in: Double
    var user: User

    func session(now: Date = Date()) -> Session {
        Session(accessToken: access_token, refreshToken: refresh_token,
                expiresAt: now.addingTimeInterval(expires_in), userId: user.id,
                email: user.email, name: user.user_metadata?.full_name ?? "")
    }
}

enum AuthError: LocalizedError {
    case cancelled
    case googleFailed
    case server(Int)
    case signedOut

    var errorDescription: String? {
        switch self {
        case .cancelled: "Sign-in was cancelled."
        case .googleFailed: "Google sign-in failed."
        case .server(let code): "The server refused sign-in (\(code))."
        case .signedOut: "Signed out."
        }
    }
}

/// Google sign-in, copied from mobile/src/core/session.ts: Google's implicit flow for the
/// extension's web client, relayed by server/static/mobile-callback.html to squatoverflow://auth.
/// Google only ever sees the nonce's hash; the raw nonce goes to the server with the ID token,
/// so another app that catches the redirect can't redeem it.
@MainActor
final class Auth: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    @Published private(set) var session: Session?

    /// Refresh tokens are single-use, so callers that arrive together share one refresh.
    private var refreshing: Task<Session?, Never>?
    /// Bumped by signOut(), so a refresh that finishes after sign-out doesn't sign the user back in.
    private var generation = 0
    private var webSession: ASWebAuthenticationSession?

    override init() {
        super.init()
        if let data = Keychain.read() { session = try? Self.decoder.decode(Session.self, from: data) }
    }

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder(); d.dateDecodingStrategy = .millisecondsSince1970; return d
    }()
    private static let encoder: JSONEncoder = {
        let e = JSONEncoder(); e.dateEncodingStrategy = .millisecondsSince1970; return e
    }()

    // MARK: Sign-in

    nonisolated static func newNonce() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return hex(bytes)
    }

    nonisolated static func sha256Hex(_ s: String) -> String { hex(Array(SHA256.hash(data: Data(s.utf8)))) }

    nonisolated private static func hex(_ bytes: [UInt8]) -> String { bytes.map { String(format: "%02x", $0) }.joined() }

    /// Google's sign-in page for the web client (signInUrl() in session.ts).
    nonisolated static func signInURL(hashedNonce: String) -> URL {
        var c = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        c.queryItems = [
            URLQueryItem(name: "client_id", value: Config.googleClientID),
            URLQueryItem(name: "response_type", value: "id_token"),
            URLQueryItem(name: "redirect_uri", value: Config.callbackURL.absoluteString),
            URLQueryItem(name: "scope", value: "openid email profile"),
            URLQueryItem(name: "nonce", value: hashedNonce),
            URLQueryItem(name: "prompt", value: "select_account"),
        ]
        return c.url!
    }

    /// The ID token from squatoverflow://auth?id_token=…, or nil when Google sent an error or nothing.
    nonisolated static func idToken(from redirect: URL) -> String? {
        let items = URLComponents(url: redirect, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if items.contains(where: { $0.name == "error" }) { return nil }
        guard let token = items.first(where: { $0.name == "id_token" })?.value, !token.isEmpty else { return nil }
        return token
    }

    func signIn() async throws {
        let nonce = Self.newNonce()
        let redirect = try await authenticate(Self.signInURL(hashedNonce: Self.sha256Hex(nonce)))
        guard let idToken = Self.idToken(from: redirect) else { throw AuthError.googleFailed }
        let next = try await Self.requestSession("/auth/google", ["id_token": idToken, "nonce": nonce])
        generation += 1
        store(next)
    }

    private func authenticate(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { cont in
            let web = ASWebAuthenticationSession(url: url, callbackURLScheme: Config.appScheme) { callback, error in
                if let callback {
                    cont.resume(returning: callback)
                } else if let e = error as? ASWebAuthenticationSessionError, e.code == .canceledLogin {
                    cont.resume(throwing: AuthError.cancelled)
                } else {
                    cont.resume(throwing: error ?? AuthError.googleFailed)
                }
            }
            web.presentationContextProvider = self
            webSession = web
            // A menu bar app is never active on its own; bring the sign-in sheet to the front.
            NSApp.activate(ignoringOtherApps: true)
            if !web.start() { cont.resume(throwing: AuthError.googleFailed) }
        }
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated { NSApp.keyWindow ?? NSApp.windows.first ?? ASPresentationAnchor() }
    }

    // MARK: Tokens

    /// An access token with time left, refreshing it first when it's about to expire.
    func accessToken() async throws -> String {
        guard let current = session else { throw AuthError.signedOut }
        if current.expiresAt.timeIntervalSinceNow > 60 { return current.accessToken }
        return try await refreshed(after: current.accessToken)
    }

    /// A new access token after `stale` was rejected with 401. Shares an in-flight refresh, and
    /// skips refreshing when another caller already replaced `stale`.
    func refreshed(after stale: String) async throws -> String {
        guard let current = session else { throw AuthError.signedOut }
        if current.accessToken != stale { return current.accessToken }
        if refreshing == nil {
            let gen = generation
            refreshing = Task { [weak self] in
                defer { self?.refreshing = nil }
                return await self?.refresh(current, generation: gen)
            }
        }
        guard let next = await refreshing?.value else { throw AuthError.signedOut }
        return next.accessToken
    }

    private func refresh(_ stored: Session, generation gen: Int) async -> Session? {
        do {
            let next = try await Self.requestSession("/auth/refresh", ["refresh_token": stored.refreshToken])
            guard gen == generation else { return nil }
            store(next)
            return next
        } catch AuthError.server(401) {
            // The refresh token is spent or expired: the user has to sign in again.
            if gen == generation { signOut() }
            return nil
        } catch {
            // Offline or server down: keep the session for the next try.
            return nil
        }
    }

    func signOut() {
        generation += 1
        refreshing?.cancel()
        refreshing = nil
        Keychain.delete()
        session = nil
    }

    private func store(_ next: Session) {
        if let data = try? Self.encoder.encode(next) { Keychain.write(data) }
        session = next
    }

    private static func requestSession(_ path: String, _ body: [String: String]) async throws -> Session {
        var req = URLRequest(url: Config.serverURL.appendingPathComponent(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, res) = try await URLSession.shared.data(for: req)
        let status = (res as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw AuthError.server(status) }
        return try JSONDecoder().decode(SessionResponse.self, from: data).session()
    }
}
