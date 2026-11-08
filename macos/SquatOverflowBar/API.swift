import Foundation

enum APIError: LocalizedError {
    case http(Int)

    var errorDescription: String? {
        switch self {
        case .http(let code): "The server answered \(code)."
        }
    }
}

/// Authenticated GETs against the server. A 401 refreshes the access token once and retries.
@MainActor
struct API {
    let auth: Auth

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        var c = URLComponents(url: Config.serverURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty { c.queryItems = query }
        let url = c.url!

        let token = try await auth.accessToken()
        let (data, status) = try await send(url, token)
        if status == 401 {
            let fresh = try await auth.refreshed(after: token)
            let (retryData, retryStatus) = try await send(url, fresh)
            return try decode(retryData, retryStatus)
        }
        return try decode(data, status)
    }

    private func send(_ url: URL, _ token: String) async throws -> (Data, Int) {
        var req = URLRequest(url: url)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 20
        let (data, res) = try await URLSession.shared.data(for: req)
        return (data, (res as? HTTPURLResponse)?.statusCode ?? 0)
    }

    private func decode<T: Decodable>(_ data: Data, _ status: Int) throws -> T {
        guard (200..<300).contains(status) else { throw APIError.http(status) }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
