import SquatCore
import SwiftUI

/// extension/break.html as SwiftUI. Everything it shows comes from SquatCore.BreakSession.
struct BreakView: View {
    let holder: BreakHolder

    var body: some View {
        BreakLoader(holder: holder).frame(minWidth: 760, minHeight: 600)
    }
}

/// "Loading…" until the session exists (it needs the catalog from the server first).
private struct BreakLoader: View {
    @ObservedObject var holder: BreakHolder
    @State private var session: BreakSession?

    var body: some View {
        Group {
            if let session {
                BreakContent(session: session, holder: holder)
            } else {
                VStack(spacing: 12) {
                    ProgressView()
                    Text(I18n.t(UILang.current, "loading")).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onReceive(holder.$session) { session = $0 }
    }
}

/// The language the menu and windows use before a break has its own.
enum UILang {
    @MainActor static var current = "en"
}

private let good = Color(red: 0.24, green: 0.86, blue: 0.59)
private let warn = Color(red: 1, green: 0.71, blue: 0.28)

private struct BreakContent: View {
    @ObservedObject var session: BreakSession
    /// Not observed here: only the preview redraws for each camera frame.
    let holder: BreakHolder

    private func t(_ key: String, _ vars: [String: Any] = [:]) -> String { I18n.t(session.lang, key, vars) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            switch session.phase {
            case .loading: ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            case .warning: warning
            case .routine: routine
            case .summary: summary
            }
            if session.phase == .routine { footer }
        }
        .padding(20)
        .environment(\.layoutDirection, session.lang == "ar" ? .rightToLeft : .leftToRight)
    }

    // MARK: Header

    private var stepText: String {
        switch session.phase {
        case .warning: return t("skippedInRow", ["n": session.skipsInRow])
        case .summary: return t("breakComplete")
        default: return session.moves.isEmpty ? t("break") : t("exerciseStep", ["i": session.index + 1, "n": session.moves.count])
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(stepText).foregroundStyle(.secondary)
                Spacer()
                if session.phase == .routine { Text("+\(session.xpSoFar) XP").font(.headline).monospacedDigit().foregroundStyle(good) }
            }
            if session.phase == .routine, session.moves.indices.contains(session.index) {
                Text(I18n.areaName(session.lang, session.moves[session.index].area))
                    .font(.caption).padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Capsule().fill(Color.secondary.opacity(0.15)))
            }
            Text(session.phase == .summary ? t("niceWork") : session.title).font(.largeTitle.bold())
            if session.phase == .routine, session.totalTarget > 0 {
                ProgressView(value: Double(session.totalReps), total: Double(session.totalTarget)).tint(good)
                moveTabs
            }
        }
    }

    private var moveTabs: some View {
        HStack(spacing: 8) {
            ForEach(Array(session.moves.enumerated()), id: \.offset) { k, m in
                let reps = session.progress[k].reps
                let done = reps >= m.target
                Button { session.select(k) } label: {
                    HStack {
                        Text(m.label).lineLimit(1)
                        Spacer(minLength: 4)
                        Text(done ? "✓" : "\(reps)/\(m.target)").monospacedDigit()
                    }
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .frame(maxWidth: .infinity)
                    .background(RoundedRectangle(cornerRadius: 8).fill(k == session.index ? Color.accentColor.opacity(0.2) : Color.secondary.opacity(0.08)))
                    .foregroundStyle(done ? good : .primary)
                }
                .buttonStyle(.plain)
                .help("\(I18n.areaName(session.lang, m.area)) | \(m.label)")
            }
        }
    }

    // MARK: Warning

    private var warning: some View {
        VStack(spacing: 14) {
            Text("⚠️").font(.system(size: 56))
            Text(session.warningTitle).font(.title2.bold())
            Text(t("warnBody")).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 520)
            HStack {
                Button(t("warnStart")) { Task { await session.startFromWarning() } }.keyboardShortcut(.defaultAction)
                Button(session.canSnooze ? t("snooze") : t("snoozedTwice")) { session.leave("snooze") }.disabled(!session.canSnooze)
                Button(t("pause")) { session.leave("pause") }
            }
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: Routine

    private var routine: some View {
        VStack(alignment: .leading, spacing: 12) {
            stage
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.manualHowTo ?? (session.moves.indices.contains(session.index) ? session.moves[session.index].howTo : ""))
                        .fixedSize(horizontal: false, vertical: true)
                    if session.moves.indices.contains(session.index), session.moves[session.index].camera == "side" {
                        Text(t("cameraHint")).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if session.canSwap {
                    Button(t("swap")) { session.swap() }.help(t("swapTitle"))
                }
                // Like the extension: the clip opens on youtube.com, and only on a click.
                if let url = session.demoURL, let label = session.demoLabel {
                    Button(label) { NSWorkspace.shared.open(url) }
                }
            }
            HStack(spacing: 16) {
                Toggle(t("voiceCues"), isOn: Binding(get: { session.voice }, set: { session.setVoice($0) })).toggleStyle(.switch)
                Toggle(t("memeSounds"), isOn: Binding(get: { session.memes }, set: { session.setMemes($0) })).toggleStyle(.switch)
                Spacer()
                if session.fallback == nil {
                    Picker(t("look"), selection: Binding(get: { session.privacy }, set: { session.setPrivacy($0) })) {
                        Text(t("camera")).tag(false)
                        Text(t("lookBlur")).tag(true)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 240)
                }
            }
            .controlSize(.small)
        }
    }

    private var stage: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color.black)
            if session.fallback == nil { PreviewImage(holder: holder) }
            if session.starting {
                overlay {
                    ProgressView()
                    Text(t("startingCamera")).bold()
                    Text(session.cameraSlow ? cameraSlowText : t("framesLocal")).font(.caption).foregroundStyle(.secondary)
                }
            } else if let f = session.fallback {
                overlay {
                    Text(f.title).font(.title3.bold())
                    Text(f.text).multilineTextAlignment(.center)
                }
            } else if session.positioning {
                overlay {
                    Text(t("getInPosition")).bold()
                    Text(t("positionText")).multilineTextAlignment(.center)
                }
            }
            VStack {
                HStack {
                    if session.moves.indices.contains(session.index) {
                        Text("\(session.progress[session.index].reps) / \(session.moves[session.index].target)")
                            .font(.system(size: 34, weight: .heavy)).monospacedDigit()
                            .environment(\.layoutDirection, .leftToRight)
                    }
                    Spacer()
                    if let score = session.lastScore {
                        Text(t("form", ["score": score])).font(.headline).padding(6)
                            .background(Capsule().fill(.black.opacity(0.5)))
                    }
                }
                Spacer()
                if let cue = session.cue {
                    Text(cue.text).font(.title3.bold()).padding(.horizontal, 14).padding(.vertical, 8)
                        .background(Capsule().fill((cue.good ? good : warn).opacity(0.9)))
                        .foregroundStyle(.black)
                }
            }
            .padding(14)
            .foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// The extension's text names "this browser"; here it's this app that needs the camera.
    private var cameraSlowText: String {
        t("cameraSlow").replacingOccurrences(of: "this browser", with: "Squat Overflow")
            .replacingOccurrences(of: "هذا المتصفح", with: "Squat Overflow")
    }

    private func overlay<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(spacing: 8, content: content)
            .padding(20)
            .frame(maxWidth: 420)
            .background(RoundedRectangle(cornerRadius: 12).fill(.black.opacity(0.7)))
            .foregroundStyle(.white)
    }

    // MARK: Footer

    private var footer: some View {
        HStack {
            Button(t("done")) { session.finish() }.keyboardShortcut(.defaultAction).disabled(session.finished)
            Button(session.canSnooze ? t("snooze") : t("snoozedTwice")) { session.leave("snooze") }
                .disabled(!session.canSnooze || session.finished)
            Button(t("skip")) { session.leave("skip") }.disabled(session.finished)
        }
        .controlSize(.large)
    }

    // MARK: Summary

    private var summary: some View {
        VStack(spacing: 14) {
            Text(t("breakComplete")).foregroundStyle(.secondary)
            Text("+\(session.summary?.breakdown.total ?? 0) XP").font(.system(size: 52, weight: .heavy)).foregroundStyle(good)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(session.summaryLines.enumerated()), id: \.offset) { _, line in
                    HStack {
                        Text(line.label)
                        Spacer()
                        if let xp = line.xp { Text("+\(xp)").bold().monospacedDigit() }
                    }
                }
            }
            .frame(maxWidth: 420)
            if let up = session.levelUpText { Text(up).font(.title3.bold()).foregroundStyle(good) }
            if let lv = session.levelLines {
                VStack(alignment: .leading, spacing: 4) {
                    HStack { Text(lv.name).bold(); Spacer(); Text(lv.xp).foregroundStyle(.secondary) }
                    ProgressView(value: lv.after).tint(good)
                }
                .frame(maxWidth: 420)
            }
            Button(t("backToWork")) { holder.close() }.keyboardShortcut(.defaultAction).controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The camera picture, redrawn for every frame.
private struct PreviewImage: View {
    @ObservedObject var holder: BreakHolder

    var body: some View {
        if let image = holder.preview {
            Image(decorative: image, scale: 1).resizable().aspectRatio(contentMode: .fit)
        }
    }
}
