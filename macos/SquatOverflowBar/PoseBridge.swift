import Foundation
import SquatCore
import UniformTypeIdentifiers
import WebKit

/// The pose model on this Mac: the extension's own lib/pose gateway and MediaPipe model, running in
/// a web view that is never shown (PoseWeb/bridge.html). It takes the place of the pose server's
/// WebSocket with the same messages, so SquatCore.PoseLink drives it unchanged: JSON text and JPEG
/// frames go in, the server's JSON replies come out. Nothing leaves the Mac.
///
/// The pages load from the app bundle through the `squatpose://` scheme, because ES modules and
/// WebAssembly don't load from file:// URLs.
@MainActor
final class PoseBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let scheme = "squatpose"

    var onOpen: () -> Void = {}
    var onText: (String) -> Void = { _ in }
    var onClose: (Int) -> Void = { _ in }

    private var webView: WKWebView?
    private var loaded = false
    private var pending: [String] = [] // calls made before bridge.js ran
    private var closed = false

    /// Starts the web view; "open" follows once the model has loaded.
    func connect() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemeHandler(), forURLScheme: Self.scheme)
        config.userContentController.add(WeakHandler(self), name: "pose")
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 16, height: 16), configuration: config)
        view.navigationDelegate = self
        webView = view
        view.load(URLRequest(url: URL(string: "\(Self.scheme)://app/bridge.html")!))
    }

    func send(_ message: PoseOutgoing) {
        switch message {
        case .text(let json): call("poseBridge.text(\(Self.literal(json)))")
        case .frame(let jpeg): call("poseBridge.frame(\"\(jpeg.base64EncodedString())\")")
        }
    }

    func close() {
        guard !closed else { return }
        closed = true
        webView?.evaluateJavaScript("poseBridge.close()")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "pose")
        webView = nil
    }

    private func call(_ js: String) {
        guard !closed else { return }
        if loaded { webView?.evaluateJavaScript(js) } else { pending.append(js) }
    }

    /// A Swift string as a JavaScript string literal (JSON's string syntax is valid JavaScript).
    private static func literal(_ s: String) -> String {
        String(decoding: (try? JSONEncoder().encode(s)) ?? Data("\"\"".utf8), as: UTF8.self)
    }

    private func finish(_ code: Int) {
        guard !closed else { return }
        close()
        onClose(code)
    }

    // MARK: WKScriptMessageHandler

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard !closed, let body = message.body as? [String: Any], let kind = body["kind"] as? String else { return }
        switch kind {
        case "loaded":
            loaded = true
            for js in pending { webView?.evaluateJavaScript(js) }
            pending = []
        case "open": onOpen()
        case "text": if let text = body["text"] as? String { onText(text) }
        case "close":
            if let reason = body["reason"] as? String, !reason.isEmpty { NSLog("PoseBridge: closed: %@", reason) }
            finish((body["code"] as? Int) ?? PoseStatus.closeModelFailed)
        case "log": NSLog("PoseBridge: %@", (body["text"] as? String) ?? "")
        default: break
        }
    }

    // MARK: WKNavigationDelegate: a page that can't load or a crashed web process means no model.

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        finish(PoseStatus.closeModelFailed)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        finish(PoseStatus.closeModelFailed)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        finish(PoseStatus.closeModelFailed)
    }

    // MARK: Bundle files

    /// The bundle file for a `squatpose://app/<path>` URL path, or nil outside the three folders:
    /// PoseWeb/ (the bridge page), pose/ (extension/lib/pose) and mediapipe/ (lib/vendor/mediapipe).
    nonisolated static func resource(_ path: String) -> URL? {
        let clean = path.hasPrefix("/") ? String(path.dropFirst()) : path
        guard !clean.split(separator: "/").contains(where: { $0 == ".." || $0 == "." }) else { return nil }
        let mapped: String
        if clean.hasPrefix("lib/pose/") { mapped = "pose/" + clean.dropFirst("lib/pose/".count) }
        else if clean.hasPrefix("lib/vendor/mediapipe/") { mapped = "mediapipe/" + clean.dropFirst("lib/vendor/mediapipe/".count) }
        else if clean.hasPrefix("PoseWeb/") || clean.hasPrefix("pose/") || clean.hasPrefix("mediapipe/") { mapped = clean }
        else { mapped = "PoseWeb/" + clean }
        guard let base = Bundle.main.resourceURL else { return nil }
        let url = base.appendingPathComponent(mapped)
        return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }

    nonisolated static func mimeType(_ url: URL) -> String {
        switch url.pathExtension {
        case "html": "text/html"
        case "js", "mjs": "text/javascript"
        case "wasm": "application/wasm"
        case "json": "application/json"
        default: "application/octet-stream" // the .task model
        }
    }

    private final class SchemeHandler: NSObject, WKURLSchemeHandler {
        func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
            guard let url = task.request.url, let file = PoseBridge.resource(url.path), let data = try? Data(contentsOf: file) else {
                task.didFailWithError(URLError(.fileDoesNotExist))
                return
            }
            let res = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                      headerFields: ["Content-Type": PoseBridge.mimeType(file), "Content-Length": "\(data.count)"])!
            task.didReceive(res)
            task.didReceive(data)
            task.didFinish()
        }

        func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    }

    /// WKUserContentController keeps its handlers strongly; this keeps the bridge collectable.
    private final class WeakHandler: NSObject, WKScriptMessageHandler {
        weak var target: PoseBridge?
        init(_ target: PoseBridge) { self.target = target }
        func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
            target?.userContentController(c, didReceive: message)
        }
    }
}
