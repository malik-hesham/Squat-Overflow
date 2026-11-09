import Combine
import Foundation

/// A pending timer; calling it cancels.
public struct Cancel {
    let run: () -> Void
    public init(_ run: @escaping () -> Void) { self.run = run }
    public func callAsFunction() { run() }
}

/// What a break window needs from the app: the camera and pose server, sound, and the engine.
@MainActor
public protocol BreakSessionHost: AnyObject {
    /// Starts the camera and the pose socket; false when the camera can't be used.
    func startPose() async -> Bool
    func stopPose()
    func setExercise(_ key: String)
    func setPrivacy(_ on: Bool)
    func speak(_ text: String)
    func stopSpeaking()
    func playMeme(_ kind: String)
    /// Engine.done(); nil if it failed (the window then just closes).
    func done(result: BreakResult, lastKey: String?) -> DoneResponse?
    /// Snooze, skip or pause.
    func leave(_ action: String)
    func close()
    func saveSettings(_ patch: [String: JSONValue])
    func after(_ seconds: Double, _ fire: @escaping () -> Void) -> Cancel
}

public struct MoveProgress: Equatable, Sendable {
    public var reps = 0
    public var scores: [Double] = []
    /// Reps when this move was last shown: the server counts each exercise from 0 again.
    public var base = 0
}

/// One break window, ported from extension/break.js: the three exercises, reps and form scores
/// from the pose server, cues, the skip warning, the coach-offline fallback, Done / Snooze / Skip
/// and the XP summary. The window draws this; the app's host does the camera, sound and engine.
@MainActor
public final class BreakSession: ObservableObject {
    public enum Phase: Equatable { case loading, warning, routine, summary }

    public static let positionTimeout = 15.0
    public static let cameraSlowAfter = 6.0
    static let youtubeID = "^[A-Za-z0-9_-]{11}$"

    /// Fallback title and text for each status that ends the coached break.
    static let fallbacks: [PoseStatus: (title: String, text: String)] = [
        .offline: ("coachOffline", "offlineText"),
        .busy: ("coachBusy", "busyText"),
        .cameraDenied: ("cameraUnavailable", "deniedText"),
    ]

    @Published public private(set) var phase = Phase.loading
    @Published public private(set) var moves: [Move] = []
    @Published public private(set) var progress: [MoveProgress] = []
    @Published public private(set) var index = 0
    @Published public private(set) var positioning = false
    @Published public private(set) var starting = false
    @Published public private(set) var cameraSlow = false
    @Published public private(set) var fallback: (title: String, text: String)?
    @Published public private(set) var cue: (text: String, good: Bool)?
    @Published public private(set) var lastScore: Double?
    @Published public private(set) var summary: DoneResponse?
    @Published public private(set) var finished = false
    @Published public private(set) var voice: Bool
    @Published public private(set) var memes: Bool
    @Published public private(set) var privacy: Bool
    @Published public private(set) var title = ""
    @Published public private(set) var manualHowTo: String?
    public private(set) var warningTitle = ""
    public let canSnooze: Bool
    public let lang: String
    public let skipsInRow: Int

    private let settings: Settings
    private let schedule: ScheduleState
    private let catalog: [Exercise]
    private let manual: Bool
    private let online: Bool
    private unowned let host: BreakSessionHost
    private var poseActive = false
    private var repMarks: [Int] = []
    private var repMemes = 0
    private var positionTimer: Cancel?
    private var slowTimer: Cancel?

    public init(settings: Settings, schedule: ScheduleState, catalog: [Exercise], manual: Bool, lang: String, online: Bool,
                host: BreakSessionHost) {
        self.settings = settings
        self.schedule = schedule
        self.manual = manual
        self.lang = lang
        self.online = online
        self.host = host
        voice = settings.voice
        memes = settings.memes
        privacy = settings.privacy
        canSnooze = BreakSchedule.canSnooze(schedule)
        skipsInRow = schedule.skipsInRow
        self.catalog = catalog.map { e in
            var e = e
            e.label = I18n.exerciseText(lang, key: e.key, field: "label", fallback: e.label)
            e.howTo = I18n.exerciseText(lang, key: e.key, field: "how_to", fallback: e.howTo)
            return e
        }
        moves = Routine.build(catalog: self.catalog, areas: settings.areas.isEmpty ? Array(Routine.areas.prefix(2)) : settings.areas,
                              lastKey: schedule.lastKey, n: schedule.breakCount)
        progress = moves.map { _ in MoveProgress() }
        repMarks = Memes.repMarks(totalReps: moves.reduce(0) { $0 + $1.target })
        title = I18n.t(lang, "loading")
    }

    func t(_ key: String, _ vars: [String: Any] = [:]) -> String { I18n.t(lang, key, vars) }

    // MARK: Sound

    private func speak(_ text: String) {
        guard voice, !text.isEmpty else { return }
        host.speak(text)
    }

    private func meme(_ kind: String) {
        if memes { host.playMeme(kind) }
    }

    private func announce(_ i: Int) {
        guard moves.indices.contains(i) else { return }
        speak(t(i > 0 ? "sayNext" : "sayMove", ["label": moves[i].label, "n": moves[i].target]))
    }

    // MARK: Start

    /// The skip warning for a reminder after three skips in a row; otherwise straight into the routine.
    public func begin() async {
        if !manual && BreakSchedule.showWarning(schedule) {
            warningTitle = t("warnTitle", ["n": BreakSchedule.warningHours(skips: schedule.skipsInRow, intervalMin: settings.intervalMin)])
            title = t("timeToMove")
            phase = .warning
            return
        }
        await startRoutine(withMeme: manual)
    }

    /// "Start a break now" on the warning: the user asked for it, so it gets the start clip.
    public func startFromWarning() async { await startRoutine(withMeme: true) }

    private func startRoutine(withMeme: Bool) async {
        if withMeme { meme("start") }
        phase = .routine
        guard !moves.isEmpty else {
            poseStatus(.offline)
            title = t("timeToMove")
            manualHowTo = t("manualHowto")
            return
        }
        showMove(0)
        setStarting(true)
        let started = await host.startPose()
        setStarting(false)
        if started && !finished {
            poseActive = true
            if fallback == nil { showMove(index) }
        }
        announce(index)
    }

    private func setStarting(_ on: Bool) {
        slowTimer?()
        starting = on
        cameraSlow = false
        if on { slowTimer = host.after(Self.cameraSlowAfter) { [weak self] in self?.cameraSlow = true } }
    }

    // MARK: Moves

    private func showMove(_ i: Int) {
        index = i
        let move = moves[i]
        progress[i].base = progress[i].reps
        title = move.label
        lastScore = nil
        cue = nil
        host.setExercise(move.key)
        positionTimer?()
        positioning = Routine.needsPositioning(move) && fallback == nil && poseActive
        if positioning { positionTimer = host.after(Self.positionTimeout) { [weak self] in self?.endPositioning() } }
    }

    private func endPositioning() {
        positionTimer?()
        positioning = false
    }

    /// A tab above the routine.
    public func select(_ k: Int) {
        guard !finished, k != index, moves.indices.contains(k) else { return }
        showMove(k)
        announce(k)
    }

    public var canSwap: Bool { moves.indices.contains(index) && Routine.swapMove(catalog: catalog, moves: moves, index: index) != nil }

    /// "↻ Swap": another exercise from the same area, starting over.
    public func swap() {
        guard !finished, let m = Routine.swapMove(catalog: catalog, moves: moves, index: index) else { return }
        moves[index] = m
        progress[index] = MoveProgress()
        showMove(index)
        announce(index)
    }

    public var totalTarget: Int { moves.reduce(0) { $0 + $1.target } }
    public var totalReps: Int { progress.reduce(0) { $0 + $1.reps } }

    // MARK: Pose server

    /// One reply from the pose server for the current exercise (onFrame()).
    public func frame(_ f: PoseFrame) {
        guard !finished, moves.indices.contains(index) else { return }
        if positioning && !f.feedbackCodes.contains("not_visible") { endPositioning() }
        let move = moves[index]
        let was = progress[index].reps
        progress[index].reps = min(progress[index].base + f.reps, move.target)
        // Rep clips are spread over the whole break.
        if repMemes < repMarks.count && totalReps >= repMarks[repMemes] {
            repMemes += 1
            meme("reps")
        }
        if let ev = f.repEvent {
            progress[index].scores.append(ev.score)
            lastScore = ev.score
            let issue = ev.issueText.first.map { I18n.issueText(lang, code: ev.issues.first ?? "", fallback: $0) }
            let text = issue ?? (ev.score >= 85 ? t("greatForm") : "")
            cue = text.isEmpty ? nil : (text, issue == nil)
            speak(ev.partial ? t("goDeeper") : (issue ?? String(progress[index].reps)))
        }
        if was < move.target && progress[index].reps >= move.target {
            let next = Routine.nextOpenMove(moves: moves, reps: progress.map(\.reps), from: index)
            if next == -1 {
                finish()
            } else {
                showMove(next)
                announce(next)
            }
        }
    }

    /// Offline, busy or no camera: the break goes on by hand, with no XP (onStatus()).
    public func poseStatus(_ status: PoseStatus) {
        guard let f = Self.fallbacks[status], !finished else { return }
        endPositioning()
        setStarting(false)
        fallback = (t(f.title), t(f.text))
    }

    /// The demo clip, embedded through the pose server's /embed page, when online and coached.
    public var demoURL: URL? {
        guard online, fallback == nil, moves.indices.contains(index), let id = moves[index].youtubeID,
              id.range(of: Self.youtubeID, options: .regularExpression) != nil,
              var c = URLComponents(string: settings.serverUrl) else { return nil }
        c.scheme = c.scheme == "wss" ? "https" : (c.scheme == "ws" ? "http" : c.scheme)
        c.path = "/embed/\(id)"
        c.query = nil
        return c.url
    }

    // MARK: Result

    /// currentResult(): what Done reports.
    public var result: BreakResult {
        let scores = progress.flatMap(\.scores)
        return BreakResult(scored: !scores.isEmpty, countedReps: totalReps, targetReps: totalTarget, scores: scores,
                           moves: moves.enumerated().map { k, m in .init(key: m.key, area: m.area, completed: progress[k].reps >= m.target) })
    }

    public var xpSoFar: Int {
        let r = result
        return XP.breakXp(countedReps: r.countedReps, targetReps: r.targetReps, scores: r.scores)
    }

    /// Done: XP and the summary.
    public func finish() {
        guard !finished else { return }
        finished = true
        endPositioning()
        setStarting(false)
        host.stopPose()
        let r = result
        meme(r.scored ? "done" : "unscored")
        speak(t("sayDone"))
        guard let res = host.done(result: r, lastKey: moves.last?.key) else {
            host.close()
            return
        }
        summary = res
        title = t("niceWork")
        phase = .summary
    }

    /// Snooze, Skip, or Pause (from the warning).
    public func leave(_ action: String) {
        guard !finished else { return }
        finished = true
        host.stopPose()
        host.leave(action)
        host.close()
    }

    /// The summary's lines: each bonus, then new badges (no XP).
    public var summaryLines: [(label: String, xp: Int?)] {
        guard let s = summary else { return [] }
        let b = s.breakdown
        var lines: [(label: String, xp: Int?)] = [(t("break"), b.breakXp), (t("firstBreak"), b.firstBreak), (t("streakBonus"), b.streak)]
        lines += b.challenges.map { c in
            let name = c.id == "weekly"
                ? t("areaWeek", ["area": I18n.areaName(lang, s.profile.weekly?.area ?? "")])
                : I18n.nameText(lang, "challenge.\(c.id)", fallback: c.name)
            return (t("challengeLine", ["name": name]), c.bonus)
        }
        lines = lines.filter { ($0.xp ?? 0) > 0 }
        if lines.isEmpty { lines.append((t("noReps"), 0)) }
        lines += s.newBadges.map { (t("newBadge", ["name": Badges.label($0, lang: lang)]), nil) }
        return lines
    }

    public var levelUpText: String? {
        summary?.levelUp.map { t("levelUp", ["name": I18n.levelName(lang, $0.to, fallback: $0.name)]) }
    }

    /// "Level 2 · Chair Escapee" and "113 / 250 XP" after the break, with the bar before and after.
    public var levelLines: (name: String, xp: String, before: Double, after: Double)? {
        guard let s = summary else { return nil }
        let xp = s.profile.xp
        let lv = XP.levelFor(xp: xp)
        let before = XP.levelFor(xp: xp - s.breakdown.total)
        return (t("level", ["n": lv.level, "name": I18n.levelName(lang, lv.level, fallback: lv.name)]),
                lv.next.map { t("xpOf", ["xp": xp, "next": $0]) } ?? t("xpMaxLevel", ["xp": xp]),
                s.levelUp == nil ? before.progress : 0, lv.progress)
    }

    // MARK: Toggles

    public func setVoice(_ on: Bool) {
        voice = on
        if on { announce(index) } else { host.stopSpeaking() }
        host.saveSettings(["voice": .bool(on)])
    }

    public func setMemes(_ on: Bool) {
        memes = on
        host.saveSettings(["memes": .bool(on)])
    }

    /// The camera look: blurred (privacy) or plain.
    public func setPrivacy(_ on: Bool) {
        privacy = on
        host.setPrivacy(on)
        host.saveSettings(on ? ["privacy": .bool(true), "privacyStyle": .string("blur")] : ["privacy": .bool(false)])
    }
}
