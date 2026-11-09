import SquatCore
import SwiftUI

/// The menu bar window: extension/popup.html, natively.
struct MenuView: View {
    @EnvironmentObject private var model: AppModel

    private var lang: String { model.lang }
    private func t(_ key: String, _ vars: [String: Any] = [:]) -> String { I18n.t(lang, key, vars) }

    var body: some View {
        let settings = model.settings
        let profile = model.store.profile()
        let schedule = model.store.schedule()
        let nowMs = LocalTime.millis(model.now)
        VStack(alignment: .leading, spacing: 12) {
            me(settings, profile)
            if !settings.setupDone {
                VStack(alignment: .leading, spacing: 6) {
                    Text(t("finishSetup")).font(.callout)
                    Button(t("openSetup"), action: model.openSettings)
                }
            } else {
                next(schedule, settings, nowMs)
            }
            stats(profile, schedule, nowMs)
            challenges(Challenges.withPeriods(profile, now: nowMs))
            HStack {
                Button(action: model.breakNow) { Label(t("breakNow"), systemImage: "figure.strengthtraining.functional").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                Button(schedule.pausedUntil > nowMs ? t("resume") : t("pause"), action: model.togglePause)
                    .disabled(!settings.setupDone)
            }
            team
            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            HStack {
                Button(t("settings"), action: model.openSettings)
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }
            }
            .buttonStyle(.link)
            .font(.callout)
        }
        .padding(14)
        .frame(width: 320)
        .environment(\.layoutDirection, lang == "ar" ? .rightToLeft : .leftToRight)
        .task { await model.loadBoard() }
    }

    private func me(_ settings: SquatCore.Settings, _ profile: Profile) -> some View {
        let lv = XP.levelFor(xp: profile.xp)
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(settings.name.isEmpty ? t("you") : settings.name).font(.headline)
                Spacer()
                Text(lv.next.map { t("xpOf", ["xp": profile.xp, "next": $0]) } ?? t("xpMax", ["xp": profile.xp]))
                    .font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
            Text(t("level", ["n": lv.level, "name": I18n.levelName(lang, lv.level, fallback: lv.name)])).font(.subheadline)
            ProgressView(value: min(max(lv.progress, 0), 1)).tint(.green)
        }
    }

    private func next(_ schedule: ScheduleState, _ settings: SquatCore.Settings, _ nowMs: Millis) -> some View {
        let time = { (t: Millis) in LocalTime.date(t).formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(I18n.locale(lang))) }
        let day = { (t: Millis) in LocalTime.date(t).formatted(Date.FormatStyle().weekday(.abbreviated).locale(I18n.locale(lang))) }
        return VStack(alignment: .leading, spacing: 2) {
            Label(Popup.nextText(schedule: schedule, settings: settings, now: nowMs, lang: lang, time: time, weekday: day), systemImage: "timer")
                .font(.callout)
            if let shifted = Popup.shiftedText(schedule: schedule, settings: settings, now: nowMs, lang: lang, time: time) {
                Text(shifted).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func stats(_ profile: Profile, _ schedule: ScheduleState, _ nowMs: Millis) -> some View {
        HStack(spacing: 16) {
            stat("\(Popup.todayBreaks(model.store.log(), now: nowMs))", t("breaksToday"))
            stat("\(schedule.skipsInRow)", t("skipsInRow"))
            stat("\(profile.streak)", t("dayStreak"))
        }
    }

    private func stat(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(value).font(.title3.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }

    /// renderChallenges() in extension/popup.js.
    private func challenges(_ p: Profile) -> some View {
        let d = p.daily!
        let w = p.weekly!
        func progress(_ id: String) -> (Int, Int, String) {
            switch id {
            case "variety": return (d.areas.count, 3, t("unitAreas"))
            case "high_five": return (d.breaks, 5, t("unitBreaks"))
            case "clean_form": return (d.done.contains(id) ? 1 : 0, 1, t("unitCleanForm"))
            case "early_mover": return (d.done.contains(id) ? 1 : 0, 1, t("unitEarly"))
            default: return (d.run, 3, t("unitNoSkips"))
            }
        }
        return VStack(alignment: .leading, spacing: 6) {
            Text(t("challenges")).font(.subheadline.weight(.semibold))
            ForEach(d.ids, id: \.self) { id in
                let c = Challenges.dailyPool.first { $0.id == id }!
                let (have, need, unit) = progress(id)
                tile(Badges.challengeIcon(id), I18n.nameText(lang, "challenge.\(id)", fallback: c.name), c.bonus, have, need, unit, d.done.contains(id))
            }
            let area = I18n.areaName(lang, w.area)
            tile("🏅", t("areaWeek", ["area": area]), Challenges.weeklyBonus, w.count, Challenges.weeklyTarget,
                 t("unitAreaExercises", ["area": area]), w.done)
            if !p.badges.isEmpty {
                Text(p.badges.map { Badges.label($0, lang: lang) }.joined(separator: "  ")).font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func tile(_ icon: String, _ name: String, _ bonus: Int, _ have: Int, _ need: Int, _ unit: String, _ done: Bool) -> some View {
        HStack(spacing: 8) {
            Text(icon)
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(name).font(.caption.weight(.semibold))
                    Spacer()
                    Text(done ? "✓" : "\(min(have, need))/\(need)").font(.caption2).monospacedDigit()
                    Text("+\(bonus)").font(.caption2.bold())
                }
                ProgressView(value: min(1, Double(have) / Double(need))).tint(done ? .green : .accentColor)
            }
        }
        .help("\(name) · \(min(have, need))/\(need) \(unit) · +\(bonus)")
    }

    @ViewBuilder
    private var team: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(t("leaderboard")).font(.subheadline.weight(.semibold))
                Text(t("thisWeek")).font(.caption).foregroundStyle(.secondary)
            }
            if let msg = model.boardMessage {
                Text(msg).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if model.session == nil {
                    Button {
                        model.signIn()
                    } label: {
                        HStack {
                            if model.signingIn { ProgressView().controlSize(.small) }
                            Text(t("continueGoogle"))
                        }
                    }
                    .disabled(model.signingIn)
                }
            }
            ForEach(model.board) { row in
                HStack {
                    Text("#\(row.rank)").monospacedDigit().frame(width: 28, alignment: .leading)
                    Text(row.name).lineLimit(1)
                    Spacer()
                    Text("\(row.xp) XP · 🔥\(row.streak)").monospacedDigit().foregroundStyle(.secondary)
                }
                .font(.callout.weight(row.isMe ? .semibold : .regular))
            }
        }
    }
}
