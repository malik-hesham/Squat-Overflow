import AppKit
import Combine
import Network
import SquatCore

/// The app: the engine (extension/service-worker.js, ported in SquatCore.Engine) and its timer,
/// sync with the server, break windows, the settings window, and the team board.
@MainActor
final class AppModel: ObservableObject, EngineHost {
    static let syncInterval: TimeInterval = 60 // the extension's SYNC alarm

    /// Unit tests run inside the app: they get an in-memory store and no first-run window.
    static let underTests = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil

    let auth = Auth()
    let store = Store(underTests ? MemoryStore() : FileStore(url: Config.storeURL))
    private(set) var engine: Engine!
    private(set) lazy var api = ServerAPI(auth: auth)
    private lazy var syncer = SyncClient(store: store, transport: api, clock: Self.nowMs)

    @Published private(set) var session: Session?
    @Published private(set) var board: [BoardRow] = []
    @Published private(set) var boardMessage: String?
    @Published private(set) var lastSync: Date?
    @Published private(set) var signingIn = false
    @Published var error: String?
    /// Ticks every second so the countdown stays current.
    @Published private(set) var now = Date()
    @Published private(set) var online = true

    private var alarm: Timer?
    private var ticker: AnyCancellable?
    private var sessionWatch: AnyCancellable?
    private var lastSyncTry: Date = .distantPast
    private var breaks: [Int: BreakController] = [:]
    private var nextWindowId = 1
    private var settingsWindow: SettingsController?
    private let pathMonitor = NWPathMonitor()

    nonisolated static func nowMs() -> Millis { LocalTime.millis(Date()) }

    init() {
        store.dropRetiredKeys() // the pose server's URL and catalog, from before the model ran here
        session = auth.session
        engine = Engine(store: store, host: self, clock: Self.nowMs)
        UILang.current = lang
        engine.start()
        sessionWatch = auth.$session.removeDuplicates().sink { [weak self] next in
            guard let self else { return }
            let wasSignedIn = self.session != nil
            self.session = next
            if next == nil { self.board = []; self.lastSync = nil } else if !wasSignedIn { self.requestSync() }
        }
        ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect().sink { [weak self] t in
            guard let self else { return }
            self.now = t
            if t.timeIntervalSince(self.lastSyncTry) >= Self.syncInterval { self.requestSync() }
        }
        pathMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in self?.online = path.status == .satisfied }
        }
        pathMonitor.start(queue: .main)
        // The extension opens its options page on install; until setup is done there are no breaks.
        if !store.settings().setupDone && !Self.underTests {
            DispatchQueue.main.async { self.openSettings() }
        }
    }

    var settings: SquatCore.Settings { store.settings() }
    var lang: String { I18n.resolveLang(store.settings().lang, browserLang: Locale.preferredLanguages.first) }

    /// Something the menu shows changed in the store.
    func changed() {
        UILang.current = lang
        objectWillChange.send()
    }

    // MARK: EngineHost

    func idleState(seconds: Int) -> IdleState { Presence.idleState(threshold: seconds) }

    func inMeeting() -> Bool { Presence.inMeeting() }

    func openBreakWindow(manual: Bool) -> Int {
        let id = nextWindowId
        nextWindowId += 1
        let controller = BreakController(id: id, manual: manual, model: self)
        breaks[id] = controller
        controller.show()
        return id
    }

    func focusWindow(_ id: Int) { breaks[id]?.focus() }

    func isBreakWindowOpen(_ id: Int) -> Bool { breaks[id] != nil }

    func setAlarm(at: Millis?) {
        alarm?.invalidate()
        alarm = nil
        changed()
        guard let at else { return }
        // A timer that was due while the Mac slept fires on wake; decideFire() treats it as late.
        let timer = Timer(fire: LocalTime.date(at), interval: 0, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.engine.alarmFired()
                self?.changed()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        alarm = timer
    }

    func requestSync() {
        lastSyncTry = Date()
        Task { await runSync() }
    }

    func breakWindowClosed(_ id: Int) {
        breaks[id] = nil
        engine.windowClosed(id)
        changed()
    }

    // MARK: Sync and the board

    func runSync() async {
        guard session != nil, Config.serverURL != nil else { return }
        let out = await syncer.syncNow()
        if out.ok {
            lastSync = Date()
            error = nil
            if out.scheduleChanged || out.lastBreakAt != nil { engine.afterSync(scheduleChanged: out.scheduleChanged, lastBreakAt: out.lastBreakAt) }
        } else if out.reason != "signed-out" {
            error = out.reason == "offline" ? "Can't reach \(Config.serverURL?.host ?? "the server")." : "Sync failed (\(out.reason ?? "?"))."
        }
        await loadBoard()
        changed()
    }

    /// renderBoard() in extension/popup.js: the week's board for a work email, else why there's none.
    func loadBoard() async {
        let t = { I18n.t(self.lang, $0) }
        guard let session else {
            board = []
            boardMessage = t("boardNeedsSignIn")
            return
        }
        guard Account.companyFromEmail(session.email) != nil else {
            board = []
            boardMessage = t("boardNeedsWorkEmail")
            return
        }
        if let rows = await api.board(period: "week") {
            board = Array(rows.prefix(5))
            boardMessage = rows.isEmpty ? t("boardUnavailable") : nil
        } else {
            board = []
            boardMessage = t("boardUnavailable")
        }
    }

    // MARK: Actions

    func breakNow() {
        engine.breakNow()
        changed()
    }

    func togglePause() {
        if store.schedule().pausedUntil > Self.nowMs() { engine.resume() } else { engine.pause() }
        changed()
    }

    func openSettings() {
        if settingsWindow == nil { settingsWindow = SettingsController(model: self) }
        settingsWindow?.show()
    }

    func settingsWindowClosed() { settingsWindow = nil }

    /// SquatCore.Settings were saved: start or move the timer (onSettingsSaved()), leave the board when
    /// switching back to Personal ("left-board").
    func settingsSaved(previous: SquatCore.Settings) {
        let next = store.settings()
        engine.settingsSaved(scheduleChanged: BreakSchedule.settingsChanged((previous.hours, previous.intervalMin), (next.hours, next.intervalMin)))
        if previous.mode == "competitive" && next.mode == "personal" { Task { await api.leaveBoard() } }
        changed()
    }

    func signIn() {
        guard !signingIn else { return }
        signingIn = true
        error = nil
        Task {
            defer { signingIn = false }
            do {
                try await auth.signIn()
                // The first sync uploads the local break history.
                requestSync()
            } catch AuthError.cancelled {
            } catch {
                self.error = I18n.t(lang, "signInFailed")
            }
        }
    }

    /// leaveAccount() in extension/options.js: off the board and back to Personal first.
    func signOut() {
        if store.settings().mode == "competitive" {
            Task { await api.leaveBoard() }
            store.saveSettings(["mode": .string("personal")], now: Self.nowMs())
        }
        auth.signOut()
        changed()
    }
}
