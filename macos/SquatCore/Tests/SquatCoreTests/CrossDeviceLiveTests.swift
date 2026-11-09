// The Mac's part of the cross-device check (scripts/cross-device/run.mjs, plan item 12): the real
// Engine and SyncClient against a live API server. Skipped unless run.mjs sets XD_DIR; it drives the
// phases through files in $XD_DIR/sig. "Offline" = every request fails, as with no network.
import Foundation
import SquatCore
import XCTest

@MainActor
final class CrossDeviceLiveTests: XCTestCase {
    /// HTTP like the app's ServerAPI (macos/SquatOverflowBar/API.swift), with an offline switch.
    final class LiveTransport: SyncTransport {
        let base: String, token: String, user: String
        var offline = false
        init(base: String, token: String, user: String) { self.base = base; self.token = token; self.user = user }
        func userId() async -> String? { user }
        func call(_ method: String, _ path: String, _ body: JSONValue?) async throws -> JSONValue? {
            if offline { throw URLError(.notConnectedToInternet) }
            var req = URLRequest(url: URL(string: base + path)!)
            req.httpMethod = method
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            if let body {
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONEncoder().encode(body)
            }
            let (data, res) = try await URLSession.shared.data(for: req)
            let status = (res as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(status) else { throw HTTPStatusError(status: status) }
            return status == 204 || data.isEmpty ? nil : try JSONDecoder().decode(JSONValue.self, from: data)
        }
    }

    final class Host: EngineHost {
        func idleState(seconds: Int) -> IdleState { .active }
        func inMeeting() -> Bool { false }
        func openBreakWindow(manual: Bool) -> Int { 1 }
        func focusWindow(_ id: Int) {}
        func isBreakWindowOpen(_ id: Int) -> Bool { false }
        func setAlarm(at: Millis?) {}
        func requestSync() {}
    }

    func testMacOfflineBreakUploadsOnceAndOthersArrive() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let xd = env["XD_DIR"] else { throw XCTSkip("part of scripts/cross-device/run.mjs") }
        let sig = { (name: String) in URL(fileURLWithPath: "\(xd)/sig/\(name)") }
        func report(_ name: String, _ data: [String: Any]) {
            try? JSONSerialization.data(withJSONObject: data).write(to: sig(name))
        }
        func waitFor(_ name: String) async throws {
            for _ in 0..<1500 {
                if FileManager.default.fileExists(atPath: sig(name).path) { return }
                try await Task.sleep(nanoseconds: 200_000_000)
            }
            throw NSError(domain: "cross-device", code: 1, userInfo: [NSLocalizedDescriptionKey: "timed out waiting for \(name)"])
        }
        // The session the API server gave this "Mac" (run.mjs signs every client in with a test key).
        let body = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "\(xd)/session-mac.json"))) as! [String: Any]
        let user = (body["user"] as! [String: Any])["id"] as! String
        let transport = LiveTransport(base: env["XD_API"] ?? "http://127.0.0.1:18765", token: body["access_token"] as! String, user: user)
        let store = Store(MemoryStore())
        let clock = { Millis(Date().timeIntervalSince1970 * 1000) }
        let host = Host() // Engine keeps its host unowned
        let engine = Engine(store: store, host: host, clock: clock)
        defer { withExtendedLifetime(host) {} }
        let syncer = SyncClient(store: store, transport: transport, clock: clock)
        func local() -> [String: Any] {
            let today = Calendar.current.startOfDay(for: Date())
            let log = store.log()
            return [
                "xp": store.profile().xp, "streak": store.profile().streak, "breaks": log.count,
                "today": log.filter { Date(timeIntervalSince1970: Double($0.at) / 1000) >= today }.count,
                "devices": log.map { $0.device ?? "mac" }, "outbox": store.outbox().count,
            ]
        }
        func outcome(_ o: SyncOutcome) -> [String: Any] { ["ok": o.ok, "reason": o.reason ?? ""] }

        do {
            store.saveSettings(["setupDone": .bool(true), "areas": .array([.string("Neck tension")])], now: clock())
            report("mac-ready", ["result": outcome(await syncer.syncNow()), "local": local()])

            try await waitFor("go-offline")
            transport.offline = true
            let before = local()
            _ = engine.done(result: BreakResult(scored: true, countedReps: 12, targetReps: 12, scores: [88, 92],
                                                moves: [.init(key: "neck_tilt", area: "Neck tension", completed: true)]),
                            lastKey: "neck_tilt")
            let tried = await syncer.syncNow()
            report("mac-offline-done", ["before": before, "after": local(), "syncWhileOffline": outcome(tried)])

            try await waitFor("mac-sync")
            transport.offline = false
            report("mac-synced", ["result": outcome(await syncer.syncNow()), "after": local()])

            try await waitFor("mac-final")
            report("mac-final-done", ["result": outcome(await syncer.syncNow()), "after": local()])
        } catch {
            report("mac-error", ["error": "\(error)"])
            throw error
        }
    }
}
