import Foundation
import SquatCore

/// The pose server's WebSocket (/ws). Text messages go to SquatCore.PoseLink, which decides what
/// to send; this only moves bytes. A native client sends no Origin header, which the server's
/// origin check accepts (originAllowed() in server/src/config.ts).
@MainActor
final class PoseSocket: NSObject, URLSessionWebSocketDelegate {
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var closed = false
    var onOpen: () -> Void = {}
    var onText: (String) -> Void = { _ in }
    var onClose: (Int) -> Void = { _ in }

    func connect(_ url: URL) {
        let session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: .main)
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = 8 * 1024 * 1024 // frames with a person mask
        self.session = session
        self.task = task
        task.resume()
        receive()
    }

    private func receive() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                guard let self, !self.closed else { return }
                switch result {
                case .success(.string(let text)):
                    self.onText(text)
                    self.receive()
                case .success:
                    self.receive()
                case .failure:
                    self.finish(1006)
                }
            }
        }
    }

    func send(_ message: PoseOutgoing) {
        switch message {
        case .text(let t): task?.send(.string(t)) { _ in }
        case .frame(let d): task?.send(.data(d)) { _ in }
        }
    }

    func close() {
        closed = true
        task?.cancel(with: .normalClosure, reason: nil)
        session?.invalidateAndCancel()
        task = nil
        session = nil
    }

    private func finish(_ code: Int) {
        guard !closed else { return }
        closed = true
        onClose(code)
        session?.invalidateAndCancel()
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        Task { @MainActor in if !self.closed { self.onOpen() } }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                                didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        // Foundation has no case for 1013 "Try Again Later" and reports it as .invalid; the
        // server's reason text tells it apart (CLOSE_BUSY in server/src/pose/pose.gateway.ts).
        let busy = reason.map { String(decoding: $0, as: UTF8.self) } == "server busy"
        let code = busy ? PoseStatus.closeBusy : closeCode.rawValue
        Task { @MainActor in self.finish(code) }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        Task { @MainActor in self.finish(1006) }
    }

    /// fetchCatalog() in extension/lib/pose-client.js: the exercise list from the server's
    /// "ready" message, or [] after 3 s, an error, or a close (a busy server closes at once).
    static func fetchCatalog(_ url: URL, timeout: TimeInterval = 3) async -> [Exercise] {
        await withCheckedContinuation { cont in
            let socket = PoseSocket()
            var done = false
            @MainActor func finish(_ list: [Exercise]) {
                guard !done else { return }
                done = true
                socket.close()
                cont.resume(returning: list)
            }
            socket.onText = { text in
                guard let msg = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)), msg["type"]?.string == "ready" else { return }
                finish((try? msg["exercises"]?.decode([Exercise].self)) ?? [])
            }
            socket.onClose = { _ in finish([]) }
            socket.connect(url)
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { MainActor.assumeIsolated { finish([]) } }
        }
    }
}
