import AppKit
import QuartzCore
import SquatCore
import SwiftUI

/// One break window (extension/break.html as a native window). It owns the camera, the pose
/// socket and the sounds, and runs a SquatCore.BreakSession, which holds the break's rules.
@MainActor
final class BreakController: NSObject, NSWindowDelegate, BreakSessionHost {
    static let size = NSSize(width: 980, height: 760) // BREAK_WINDOW in extension/service-worker.js

    let id: Int
    let manual: Bool
    private unowned let model: AppModel
    private let holder = BreakHolder()
    private var window: NSWindow?
    private var session: BreakSession?
    private let camera = Camera()
    private lazy var renderer = PreviewRenderer(context: camera.context)
    private var socket: PoseSocket?
    private var link: PoseLink?
    private var sounds: Sounds?
    private var ticker: Timer?
    private var watchdog: Timer?
    private var encoding = false
    private var privacy = true

    init(id: Int, manual: Bool, model: AppModel) {
        self.id = id
        self.manual = manual
        self.model = model
    }

    func show() {
        let w = NSWindow(contentRect: NSRect(origin: .zero, size: Self.size), styleMask: [.titled, .closable, .miniaturizable, .resizable],
                         backing: .buffered, defer: false)
        w.title = "Squat Overflow"
        w.isReleasedWhenClosed = false
        w.delegate = self
        holder.close = { [weak self] in self?.close() }
        w.contentView = NSHostingView(rootView: BreakView(holder: holder))
        w.center()
        window = w
        focus()
        Task { await load() }
    }

    func focus() {
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    /// init() in extension/break.js: settings, the catalog from the server (or the cached one), then the routine.
    private func load() async {
        let store = model.store
        let settings = store.settings()
        let lang = I18n.resolveLang(settings.lang, browserLang: Locale.preferredLanguages.first)
        privacy = settings.privacy
        sounds = Sounds(store: store, lang: lang)
        var catalog: [Exercise] = []
        if let url = URL(string: settings.serverUrl) { catalog = await PoseSocket.fetchCatalog(url) }
        if catalog.isEmpty { catalog = store.catalog() } else { store.cacheCatalog(catalog) }
        guard window != nil else { return } // closed while loading
        let s = BreakSession(settings: settings, schedule: store.schedule(), catalog: catalog, manual: manual, lang: lang,
                             online: model.online, host: self)
        session = s
        holder.session = s
        await s.begin()
    }

    // MARK: BreakSessionHost

    func startPose() async -> Bool {
        guard await Camera.requestAccess(), camera.start() else { return false }
        guard let url = URL(string: model.store.settings().serverUrl) else { return false }
        let socket = PoseSocket()
        let link = PoseLink(
            privacy: privacy,
            send: { [weak socket] in socket?.send($0) },
            now: { CACurrentMediaTime() },
            onFrame: { [weak self] in self?.session?.frame($0) },
            onStatus: { [weak self] in self?.session?.poseStatus($0) },
            onCatalog: { [weak self] in self?.model.store.cacheCatalog($0) })
        socket.onOpen = { [weak link] in link?.opened() }
        socket.onText = { [weak link] in link?.received($0) }
        socket.onClose = { [weak link] in link?.closed(code: $0) }
        self.socket = socket
        self.link = link
        link.start()
        socket.connect(url)
        ticker = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        watchdog = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.link?.tick() }
        }
        return true
    }

    /// 30 times a second: draw the preview, and hand the server a frame when its slot is free.
    private func tick() {
        guard let frame = camera.latest else { return }
        if let link, link.wantsFrame, !encoding {
            encoding = true
            let camera = camera
            DispatchQueue.global(qos: .userInitiated).async {
                let jpeg = camera.jpeg(frame)
                DispatchQueue.main.async {
                    MainActor.assumeIsolated {
                        self.encoding = false
                        if let jpeg { self.link?.sendFrame(jpeg) }
                    }
                }
            }
        }
        let latest = link?.latest
        let fresh = latest.map { CACurrentMediaTime() - $0.at < 1 } ?? false
        holder.preview = renderer.render(frame, privacy: privacy, mask: link?.freshMask,
                                         landmarks: fresh ? latest?.frame.landmarks : nil,
                                         issues: fresh && !(latest?.frame.feedbackCodes.isEmpty ?? true),
                                         connections: link?.connections ?? PoseLink.defaultConnections)
    }

    func stopPose() {
        ticker?.invalidate()
        watchdog?.invalidate()
        ticker = nil
        watchdog = nil
        link?.stop()
        socket?.close()
        socket = nil
        camera.stop()
    }

    func setExercise(_ key: String) { link?.setExercise(key) }

    func setPrivacy(_ on: Bool) {
        privacy = on
        link?.setPrivacy(on)
    }

    func speak(_ text: String) { sounds?.speak(text) }
    func stopSpeaking() { sounds?.stopSpeaking() }
    func playMeme(_ kind: String) { sounds?.playMeme(kind) }

    func done(result: BreakResult, lastKey: String?) -> DoneResponse? {
        let res = model.engine.done(result: result, lastKey: lastKey)
        model.changed()
        return res
    }

    func leave(_ action: String) {
        model.engine.breakAction(action)
        model.changed()
    }

    func close() { window?.close() }

    func saveSettings(_ patch: [String: JSONValue]) { model.store.saveSettings(patch, now: AppModel.nowMs()) }

    func after(_ seconds: Double, _ fire: @escaping () -> Void) -> Cancel {
        let timer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: false) { _ in MainActor.assumeIsolated { fire() } }
        return Cancel { timer.invalidate() }
    }

    // MARK: Window

    func windowWillClose(_ notification: Notification) {
        stopPose()
        sounds?.stopAll()
        window = nil
        model.breakWindowClosed(id)
    }
}

/// What the break view observes: the session once loaded, and the newest preview picture.
@MainActor
final class BreakHolder: ObservableObject {
    @Published var session: BreakSession?
    @Published var preview: CGImage?
    var close: () -> Void = {}
}
