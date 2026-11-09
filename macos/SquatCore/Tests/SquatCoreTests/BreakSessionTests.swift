import SquatCore
import XCTest

/// extension/break.js: what happens inside a break window.
@MainActor
final class BreakSessionTests: XCTestCase {
    final class FakeHost: BreakSessionHost {
        var cameraWorks = true
        var said: [String] = []
        var memes: [String] = []
        var exercises: [String] = []
        var doneWith: (result: BreakResult, lastKey: String?)?
        var doneResponse: DoneResponse?
        var left: [String] = []
        var closed = 0
        var stopped = 0
        var timers: [(seconds: Double, fire: () -> Void)] = []
        var saved: [String: JSONValue] = [:]
        var privacy: [Bool] = []

        func startPose() async -> Bool { cameraWorks }
        func stopPose() { stopped += 1 }
        func setExercise(_ key: String) { exercises.append(key) }
        func setPrivacy(_ on: Bool) { privacy.append(on) }
        func speak(_ text: String) { said.append(text) }
        func stopSpeaking() {}
        func playMeme(_ kind: String) { memes.append(kind) }
        func done(result: BreakResult, lastKey: String?) -> DoneResponse? {
            doneWith = (result, lastKey)
            return doneResponse
        }
        func leave(_ action: String) { left.append(action) }
        func close() { closed += 1 }
        func saveSettings(_ patch: [String: JSONValue]) { saved.merge(patch) { $1 } }
        func after(_ seconds: Double, _ fire: @escaping () -> Void) -> Cancel {
            timers.append((seconds, fire))
            let i = timers.count - 1
            return Cancel { [weak self] in self?.timers[i].fire = {} }
        }
        func fire(after seconds: Double) { for t in timers where t.seconds == seconds { t.fire() } }
    }

    var host: FakeHost!
    var settings = Settings()
    var schedule = ScheduleState()
    let catalog = Parity.catalogs[0]

    override func setUp() async throws {
        host = FakeHost()
        settings = Settings()
        settings.areas = ["Neck tension", "Knees"]
        schedule = ScheduleState()
    }

    func session(manual: Bool = true, lang: String = "en", catalog: [Exercise]? = nil, online: Bool = true) -> BreakSession {
        BreakSession(settings: settings, schedule: schedule, catalog: catalog ?? self.catalog, manual: manual, lang: lang,
                     online: online, host: host)
    }

    func frame(_ s: BreakSession, reps: Int, score: Double? = nil, issue: (code: String, text: String)? = nil,
               partial: Bool = false, feedback: [String] = []) -> PoseFrame {
        PoseFrame(exercise: s.moves[s.index].key, reps: reps, feedbackCodes: feedback,
                  repEvent: score.map { .init(score: $0, partial: partial, issues: issue.map { [$0.code] } ?? [],
                                               issueText: issue.map { [$0.text] } ?? []) },
                  landmarks: nil)
    }

    func response(_ total: Int = 18, levelUp: LevelUp? = nil, badges: [String] = []) -> DoneResponse {
        var b = Breakdown()
        b.breakXp = 10; b.firstBreak = 5; b.streak = 3; b.total = total
        var p = Profile(playerId: "p", secret: "s")
        p.xp = 113
        return DoneResponse(breakdown: b, levelUp: levelUp, newBadges: badges, profile: p)
    }

    // MARK: Routine

    func testThreeMovesFromTheChosenAreasStartingAtTheBreakCount() {
        schedule.breakCount = 1
        schedule.lastKey = "heel_slide"
        let s = session()
        XCTAssertEqual(s.moves.map(\.key), Routine.build(catalog: catalog, areas: ["Neck tension", "Knees"], lastKey: "heel_slide", n: 1).map(\.key))
        XCTAssertEqual(s.moves.count, 3)
        XCTAssertTrue(s.moves.allSatisfy { $0.target == 6 })
    }

    func testNoAreasChosenUsesTheFirstTwo() {
        settings.areas = []
        let s = session()
        XCTAssertEqual(Set(s.moves.map(\.area)), ["Neck tension", "Rounded shoulders"])
    }

    func testExerciseNamesAreTranslated() {
        let s = session(lang: "ar", catalog: [Exercise(key: "neck_tilt", label: "Neck tilt", category: "Neck tension", camera: "front", howTo: "Tilt")])
        XCTAssertEqual(s.moves.first?.label, I18n.exerciseText("ar", key: "neck_tilt", field: "label", fallback: "Neck tilt"))
        XCTAssertNotEqual(s.moves.first?.label, "Neck tilt")
    }

    func testBreakNowPlaysTheStartClipAndAnnouncesTheFirstMove() async {
        let s = session(manual: true)
        await s.begin()
        XCTAssertEqual(s.phase, .routine)
        XCTAssertEqual(host.memes, ["start"])
        XCTAssertEqual(host.said, [I18n.t("en", "sayMove", ["label": s.moves[0].label, "n": 6])])
        XCTAssertEqual(host.exercises.last, s.moves[0].key)
    }

    func testAReminderAfterThreeSkipsWarnsFirst() async {
        schedule.skipsInRow = 3
        settings.intervalMin = 60
        let s = session(manual: false)
        await s.begin()
        XCTAssertEqual(s.phase, .warning)
        XCTAssertEqual(s.warningTitle, I18n.t("en", "warnTitle", ["n": 3.0]))
        XCTAssertTrue(host.memes.isEmpty)
        await s.startFromWarning()
        XCTAssertEqual(s.phase, .routine)
        XCTAssertEqual(host.memes, ["start"])
    }

    func testAScheduledReminderHasNoStartClip() async {
        let s = session(manual: false)
        await s.begin()
        XCTAssertEqual(s.phase, .routine)
        XCTAssertTrue(host.memes.isEmpty)
    }

    func testSnoozeIsOffAfterTwoInARow() {
        schedule.snoozesInRow = 2
        XCTAssertFalse(session().canSnooze)
        schedule.snoozesInRow = 1
        XCTAssertTrue(session().canSnooze)
    }

    // MARK: Reps and form

    func testRepsComeFromTheServerCappedAtTheTarget() async {
        let s = session()
        await s.begin()
        s.frame(frame(s, reps: 2))
        XCTAssertEqual(s.progress[0].reps, 2)
        s.frame(frame(s, reps: 9))
        XCTAssertEqual(s.progress[1].reps, 0)
        XCTAssertEqual(s.progress[0].reps, 6)
        XCTAssertEqual(s.index, 1) // moved on
    }

    func testGoingBackToAMoveKeepsItsReps() async {
        let s = session()
        await s.begin()
        s.frame(frame(s, reps: 2))
        s.select(1)
        s.frame(frame(s, reps: 1)) // the server counts from 0 again for this exercise
        s.select(0)
        s.frame(frame(s, reps: 3)) // and again
        XCTAssertEqual(s.progress[0].reps, 5)
        XCTAssertEqual(s.progress[1].reps, 1)
    }

    func testARepEventRecordsTheScoreAndSaysTheCount() async {
        let s = session()
        await s.begin()
        host.said = []
        s.frame(frame(s, reps: 1, score: 92))
        XCTAssertEqual(s.progress[0].scores, [92])
        XCTAssertEqual(s.lastScore, 92)
        XCTAssertEqual(s.cue?.text, I18n.t("en", "greatForm"))
        XCTAssertEqual(s.cue?.good, true)
        XCTAssertEqual(host.said, ["1"])
    }

    func testAFormIssueIsShownAndSpokenInTheUsersLanguage() async {
        let s = session(lang: "ar")
        await s.begin()
        host.said = []
        s.frame(frame(s, reps: 1, score: 70, issue: ("too_fast", "Slow down")))
        let ar = I18n.issueText("ar", code: "too_fast", fallback: "Slow down")
        XCTAssertEqual(s.cue?.text, ar)
        XCTAssertEqual(s.cue?.good, false)
        XCTAssertEqual(host.said, [ar])
    }

    func testAMediocreRepWithoutIssuesShowsNoCue() async {
        let s = session()
        await s.begin()
        s.frame(frame(s, reps: 1, score: 80))
        XCTAssertNil(s.cue)
    }

    func testAPartialRepSaysGoDeeper() async {
        let s = session()
        await s.begin()
        host.said = []
        s.frame(frame(s, reps: 0, score: 40, partial: true))
        XCTAssertEqual(host.said, [I18n.t("en", "goDeeper")])
    }

    func testTheXPTickerFollowsTheBreak() async {
        let s = session()
        await s.begin()
        XCTAssertEqual(s.xpSoFar, 0)
        s.frame(frame(s, reps: 6, score: 100))
        XCTAssertEqual(s.xpSoFar, XP.breakXp(countedReps: 6, targetReps: 18, scores: [100]))
    }

    func testRepClipsAreSpreadOverTheBreak() async {
        let s = session()
        await s.begin()
        host.memes = []
        s.frame(frame(s, reps: 6)) // 6 of 18
        XCTAssertEqual(host.memes, [])
        s.frame(frame(s, reps: 3)) // 9 of 18: the first mark
        XCTAssertEqual(host.memes, ["reps"])
    }

    // MARK: Finishing

    func testFinishingEveryMoveEndsTheBreakWithASummary() async {
        host.doneResponse = response()
        let s = session()
        await s.begin()
        for _ in 0..<3 { s.frame(frame(s, reps: 6, score: 90)) }
        XCTAssertEqual(s.phase, .summary)
        XCTAssertEqual(host.doneWith?.result.countedReps, 18)
        XCTAssertEqual(host.doneWith?.result.scored, true)
        XCTAssertEqual(host.doneWith?.result.moves.allSatisfy(\.completed), true)
        XCTAssertEqual(host.doneWith?.lastKey, s.moves.last?.key)
        XCTAssertEqual(host.memes.last, "done")
        XCTAssertEqual(host.said.last, I18n.t("en", "sayDone"))
        XCTAssertEqual(host.stopped, 1)
    }

    func testSummaryLinesListEachBonus() async {
        host.doneResponse = response(73, levelUp: LevelUp(from: 1, to: 2, name: "Chair Escapee"), badges: ["daily:variety"])
        host.doneResponse!.breakdown.challenges = [CompletedChallenge(id: "variety", name: "Variety pack", bonus: 25),
                                                   CompletedChallenge(id: "weekly", name: "Knees week", bonus: 100)]
        host.doneResponse!.profile.weekly = Weekly(week: "2026-W46", area: "Knees", count: 10, done: true)
        let s = session()
        await s.begin()
        s.finish()
        let lines = s.summaryLines
        XCTAssertEqual(lines.map(\.label), [
            I18n.t("en", "break"), I18n.t("en", "firstBreak"), I18n.t("en", "streakBonus"),
            I18n.t("en", "challengeLine", ["name": "Variety pack"]),
            I18n.t("en", "challengeLine", ["name": I18n.t("en", "areaWeek", ["area": "Knees"])]),
            I18n.t("en", "newBadge", ["name": Badges.label("daily:variety")]),
        ])
        XCTAssertEqual(lines.map(\.xp), [10, 5, 3, 25, 100, nil])
        XCTAssertEqual(s.levelUpText, I18n.t("en", "levelUp", ["name": "Chair Escapee"]))
    }

    func testAnUnscoredDoneSaysNoRepsWereCounted() async {
        var r = response(0)
        r.breakdown = Breakdown()
        host.doneResponse = r
        let s = session()
        await s.begin()
        s.finish()
        XCTAssertEqual(host.doneWith?.result.scored, false)
        XCTAssertEqual(host.memes.last, "unscored")
        XCTAssertEqual(s.summaryLines.map(\.label), [I18n.t("en", "noReps")])
    }

    func testSnoozeAndSkipCloseTheWindow() async {
        let s = session()
        await s.begin()
        s.leave("snooze")
        XCTAssertEqual(host.left, ["snooze"])
        XCTAssertEqual(host.closed, 1)
        s.leave("skip")
        s.finish()
        XCTAssertEqual(host.left, ["snooze"]) // nothing after the break ended
        XCTAssertNil(host.doneWith)
    }

    // MARK: Camera and coach

    func testWhenThePoseModelCantStartTheBreakIsManual() async {
        let s = session()
        await s.begin()
        s.poseStatus(.unavailable)
        XCTAssertEqual(s.fallback?.title, I18n.t("en", "coachUnavailable"))
        XCTAssertEqual(s.fallback?.text, I18n.t("en", "unavailableText"))
        XCTAssertNil(s.demoURL)
    }

    func testNoCameraMeansNoPositioning() async {
        host.cameraWorks = false
        let s = session(catalog: catalog.filter { $0.camera == "side" })
        await s.begin()
        s.poseStatus(.cameraDenied)
        XCTAssertEqual(s.fallback?.title, I18n.t("en", "cameraUnavailable"))
        XCTAssertFalse(s.positioning)
    }

    func testWithoutACatalogTheBreakIsManual() async {
        let s = session(catalog: [])
        await s.begin()
        XCTAssertTrue(s.moves.isEmpty)
        XCTAssertEqual(s.fallback?.title, I18n.t("en", "coachUnavailable"))
        XCTAssertEqual(s.title, I18n.t("en", "timeToMove"))
    }

    func testSideOnMovesWaitForTheUserToStepIntoFrame() async {
        settings.areas = ["Knees"]
        let s = session(catalog: catalog.filter { $0.category == "Knees" && $0.camera == "side" })
        await s.begin()
        XCTAssertTrue(s.positioning)
        s.frame(frame(s, reps: 0, feedback: ["not_visible"]))
        XCTAssertTrue(s.positioning)
        s.frame(frame(s, reps: 0))
        XCTAssertFalse(s.positioning)
    }

    func testPositioningGivesUpAfterFifteenSeconds() async {
        settings.areas = ["Knees"]
        let s = session(catalog: catalog.filter { $0.category == "Knees" && $0.camera == "side" })
        await s.begin()
        host.fire(after: 15)
        XCTAssertFalse(s.positioning)
    }

    /// showDemo() in extension/break.js: the clip opens on youtube.com, and only while online.
    func testTheDemoClipOpensOnYouTube() async {
        let s = session(catalog: catalog.filter { $0.demo != nil })
        await s.begin()
        XCTAssertEqual(s.demoURL?.absoluteString, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        XCTAssertNotNil(s.demoLabel)
        XCTAssertNil(session(catalog: catalog.filter { $0.demo != nil }, online: false).demoURL)
    }

    // MARK: Swap and settings

    func testSwapReplacesTheMoveAndStartsItOver() async {
        let s = session()
        await s.begin()
        s.frame(frame(s, reps: 2))
        let before = s.moves[0].key
        s.swap()
        XCTAssertNotEqual(s.moves[0].key, before)
        XCTAssertEqual(s.moves[0].area, "Neck tension")
        XCTAssertEqual(s.progress[0].reps, 0)
        XCTAssertEqual(host.exercises.last, s.moves[0].key)
    }

    func testVoiceOffIsQuietAndSaved() async {
        settings.voice = false
        let s = session()
        await s.begin()
        s.frame(frame(s, reps: 1, score: 90))
        XCTAssertTrue(host.said.isEmpty)
        s.setVoice(true)
        XCTAssertEqual(host.saved["voice"], .bool(true))
        XCTAssertEqual(host.said.count, 1) // announces the current move
    }

    func testMemesOffPlayNothing() async {
        settings.memes = false
        let s = session()
        await s.begin()
        XCTAssertTrue(host.memes.isEmpty)
    }

    func testTheLookIsSavedAndSentToTheServer() async {
        let s = session()
        await s.begin()
        s.setPrivacy(false)
        XCTAssertEqual(host.saved["privacy"], .bool(false))
        XCTAssertEqual(host.privacy, [false])
    }
}
