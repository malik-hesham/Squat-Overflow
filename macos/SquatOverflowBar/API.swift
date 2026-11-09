import Foundation
import SquatCore

/// The signed-in server API. A 401 refreshes the access token once and retries. Used by sync
/// (SquatCore.SyncClient) and for the team leaderboard.
@MainActor
final class ServerAPI: SyncTransport {
    let auth: Auth

    init(auth: Auth) { self.auth = auth }

    func userId() async -> String? { auth.session?.userId }

    func call(_ method: String, _ path: String, _ body: JSONValue?) async throws -> JSONValue? {
        guard let base = Config.serverURL else { throw AuthError.noServer }
        guard let url = URL(string: base.absoluteString + path) else { throw HTTPStatusError(status: 400) }
        let token = try await auth.accessToken()
        var (data, status) = try await send(method, url, body, token)
        if status == 401 {
            let fresh = try await auth.refreshed(after: token)
            (data, status) = try await send(method, url, body, fresh)
        }
        guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
        if status == 204 || data.isEmpty { return nil }
        return try JSONDecoder().decode(JSONValue.self, from: data)
    }

    private func send(_ method: String, _ url: URL, _ body: JSONValue?, _ token: String) async throws -> (Data, Int) {
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try JSONEncoder().encode(body)
        }
        req.timeoutInterval = 15
        let (data, res) = try await URLSession.shared.data(for: req)
        return (data, (res as? HTTPURLResponse)?.statusCode ?? 0)
    }

    /// My company's board, or nil when it can't be loaded (fetchBoard() in extension/lib/leaderboard.js).
    func board(period: String) async -> [BoardRow]? {
        guard let value = try? await call("GET", "/leaderboard?period=\(period)", nil) else { return nil }
        return try? value.decode([BoardRow].self)
    }

    /// Takes my row off the board, when leaving Competitive mode (submitScore(remove: true)).
    func leaveBoard() async {
        _ = try? await call("DELETE", "/leaderboard/me", nil)
    }
}
