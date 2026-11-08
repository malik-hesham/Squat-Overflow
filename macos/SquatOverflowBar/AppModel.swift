import AppKit
import Combine
import Foundation

/// Everything the menu shows, polled from the server every 60 s and whenever the menu opens.
@MainActor
final class AppModel: ObservableObject {
    static let pollInterval: TimeInterval = 60

    let auth = Auth()
    private lazy var api = API(auth: auth)

    @Published private(set) var session: Session?
    @Published private(set) var profile: Profile?
    @Published private(set) var settings: ScheduleSettings?
    @Published private(set) var board: [BoardRow] = []
    @Published private(set) var boardLoaded = false
    @Published private(set) var lastSync: Date?
    @Published private(set) var error: String?
    @Published private(set) var signingIn = false
    /// Ticks every second so the countdown in the menu bar stays current.
    @Published private(set) var now = Date()

    private var ticker: AnyCancellable?
    private var sessionWatch: AnyCancellable?
    private var lastPoll: Date = .distantPast
    private var polling = false

    init() {
        session = auth.session
        sessionWatch = auth.$session.removeDuplicates().sink { [weak self] next in
            guard let self else { return }
            let wasSignedIn = self.session != nil
            self.session = next
            if next == nil { self.clear() } else if !wasSignedIn { Task { await self.refresh() } }
        }
        ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect().sink { [weak self] t in
            guard let self else { return }
            self.now = t
            if t.timeIntervalSince(self.lastPoll) >= Self.pollInterval { Task { await self.refresh() } }
        }
    }

    // MARK: Derived

    var nextBreak: Date? {
        guard session != nil, let settings else { return nil }
        let last = profile?.lastBreakAt.map { Date(timeIntervalSince1970: $0 / 1000) }
        return Schedule.nextBreak(now: now, lastBreakAt: last, settings: settings)
    }

    /// The menu bar title: the next-break countdown, or nothing when there's no data yet.
    var countdown: String? {
        guard let next = nextBreak else { return nil }
        return Schedule.countdownText(next.timeIntervalSince(now))
    }

    // MARK: Actions

    func refresh() async {
        guard session != nil, !polling else { return }
        polling = true
        lastPoll = Date()
        defer { polling = false }

        let day = Schedule.dayKey(now), week = Schedule.isoWeek(now)
        async let p: Profile = api.get("me/profile", query: [.init(name: "day", value: day), .init(name: "week", value: week)])
        async let s: SettingsResponse = api.get("me/settings")
        async let b: [BoardRow] = api.get("leaderboard", query: [.init(name: "period", value: "week")])

        var failure: String?
        do { profile = try await p } catch { failure = describe(error) }
        do { settings = try await s.settings } catch { failure = failure ?? describe(error) }
        do {
            board = Array(try await b.filter { $0.rank <= 5 }.prefix(5))
            boardLoaded = true
        } catch { failure = failure ?? describe(error) }

        guard session != nil else { return clear() }
        error = failure
        if failure == nil { lastSync = Date() }
    }

    func signIn() {
        guard !signingIn else { return }
        signingIn = true
        error = nil
        Task {
            defer { signingIn = false }
            do {
                try await auth.signIn()
            } catch AuthError.cancelled {
                // Closing the sheet isn't an error worth showing.
            } catch {
                self.error = describe(error)
            }
        }
    }

    func signOut() {
        auth.signOut()
    }

    /// Starts a break in the Chrome extension through the start page from PR #10.
    func breakNow() { openInChrome(Config.startURL) }

    /// Settings are edited in the extension; open its options page.
    func openSettings() { openInChrome(Config.optionsURL) }

    private func openInChrome(_ url: URL) {
        let ws = NSWorkspace.shared
        if let chrome = ws.urlForApplication(withBundleIdentifier: "com.google.Chrome") {
            ws.open([url], withApplicationAt: chrome, configuration: NSWorkspace.OpenConfiguration())
        } else {
            ws.open(url)
        }
    }

    private func clear() {
        profile = nil
        settings = nil
        board = []
        boardLoaded = false
        lastSync = nil
    }

    private func describe(_ error: Error) -> String {
        if case AuthError.signedOut = error { return "Signed out." }
        if (error as? URLError) != nil { return "Can't reach \(Config.serverURL.host ?? "the server")." }
        return error.localizedDescription
    }
}
