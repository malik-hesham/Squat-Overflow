import AppKit
import SquatCore
import SwiftUI

/// The settings window, natively: extension/options.html. Validation is SettingsForm.problem()
/// (ported from options.js); saving goes through the store, which marks shared settings for sync.
@MainActor
final class SettingsController: NSObject, NSWindowDelegate {
    private unowned let model: AppModel
    private var window: NSWindow?

    init(model: AppModel) { self.model = model }

    func show() {
        if window == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 760), styleMask: [.titled, .closable, .resizable],
                             backing: .buffered, defer: false)
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.contentView = NSHostingView(rootView: SettingsView(form: SettingsFormModel(model: model)).environmentObject(model))
            w.center()
            window = w
        }
        window?.title = I18n.t(model.lang, model.settings.setupDone ? "settingsTitle" : "welcome")
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        model.settingsWindowClosed()
    }
}

/// The form's state: a copy of the settings until Save.
@MainActor
final class SettingsFormModel: ObservableObject {
    private unowned let model: AppModel
    @Published var draft: SquatCore.Settings
    @Published var custom: Bool
    /// What was last saved, so "Saved ✓" shows until the form changes again.
    @Published private var savedDraft: SquatCore.Settings?
    private(set) var initial: SquatCore.Settings

    init(model: AppModel) {
        self.model = model
        let s = model.settings
        draft = s
        initial = s
        custom = !SettingsForm.presets.contains(s.intervalMin)
    }

    var lang: String { I18n.resolveLang(draft.lang, browserLang: Locale.preferredLanguages.first) }

    var saved: Bool { savedDraft == draft }

    var problem: String? { SettingsForm.problem(draft, email: model.session?.email, lang: lang) }

    /// save() in options.js.
    func save() {
        guard problem == nil else { return }
        let keys = ["intervalMin", "areas", "activeStart", "activeEnd", "workdays", "weekStart", "autoPause", "privacy", "mode", "name", "serverUrl"]
        var draft = self.draft
        draft.name = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        draft.serverUrl = draft.serverUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        var patch = draft.json.filter { keys.contains($0.key) }
        patch["setupDone"] = .bool(true)
        model.store.saveSettings(patch, now: AppModel.nowMs())
        model.settingsSaved(previous: initial)
        initial = model.settings
        self.draft = initial
        savedDraft = initial
    }

    /// The language applies at once, like the extension's language radios.
    func setLang(_ lang: String) {
        draft.lang = lang
        model.store.saveSettings(["lang": .string(lang)], now: AppModel.nowMs())
        model.changed()
    }

    /// The avatar applies at once too (it's your face on the team board).
    func setAvatar(_ key: String) {
        draft.avatar = key
        model.store.saveSettings(["avatar": .string(key)], now: AppModel.nowMs())
    }
}

struct SettingsView: View {
    @ObservedObject var form: SettingsFormModel
    @EnvironmentObject private var model: AppModel

    /// The extension's characters (extension/lib/avatar-characters.js), by name.
    static let avatars = [("slothbear", "Sloth bear"), ("bunny", "Bunny"), ("penguin", "Penguin"), ("dragon", "Baby dragon"),
                          ("critter", "Space critter"), ("platypus", "Platypus"), ("monster", "Fuzzy monster"), ("robot", "Robot")]
    static let intervalLabels = [30: "min30", 45: "min45", 60: "hr1", 90: "min90", 120: "hr2"]

    private var lang: String { form.lang }
    private func t(_ key: String, _ vars: [String: Any] = [:]) -> String { I18n.t(lang, key, vars) }

    var body: some View {
        VStack(spacing: 0) {
            Form {
                if !model.settings.setupDone {
                    Section { Text(t("intro")).foregroundStyle(.secondary) }
                }
                profile
                interval
                areas
                hours
                Section(t("camera")) {
                    Toggle(t("privacy"), isOn: $form.draft.privacy)
                    Text(t("notice")).font(.caption).foregroundStyle(.secondary)
                }
                mode
                Section(t("language")) {
                    Picker(t("language"), selection: Binding(get: { I18n.langs.contains(form.draft.lang) ? form.draft.lang : "auto" }, set: form.setLang)) {
                        Text(t("lang.auto")).tag("auto")
                        Text("English").tag("en")
                        Text("العربية").tag("ar")
                    }
                    .pickerStyle(.segmented)
                }
                Section(t("advanced")) {
                    TextField(t("serverUrl"), text: $form.draft.serverUrl)
                }
            }
            .formStyle(.grouped)
            Divider()
            HStack {
                if form.saved { Text(t("saved")).foregroundStyle(.green) }
                if model.settings.setupDone, let problem = form.problem {
                    Text(problem).foregroundStyle(.red).font(.callout)
                }
                Spacer()
                Button(model.settings.setupDone ? t("save") : t("getStarted"), action: form.save)
                    .keyboardShortcut(.defaultAction)
                    .disabled(form.problem != nil)
            }
            .padding(12)
        }
        .frame(minWidth: 560, minHeight: 600)
        .environment(\.layoutDirection, lang == "ar" ? .rightToLeft : .leftToRight)
    }

    // MARK: Sections

    private var profile: some View {
        Section(t("profile")) {
            TextField(t("displayName"), text: $form.draft.name)
            Picker("Avatar", selection: Binding(get: { form.draft.avatar }, set: form.setAvatar)) {
                ForEach(Self.avatars, id: \.0) { key, label in Text(I18n.nameText(lang, "avatar.\(key)", fallback: label)).tag(key) }
            }
            if let s = model.session {
                let company = Account.companyFromEmail(s.email)
                Text(company.map { t("companyFrom", ["domain": $0]) } ?? t("companyPersonal")).font(.caption)
                HStack {
                    Text(t("signedInAs", ["email": s.email])).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(t("signOut")) { model.signOut() }
                }
            } else if Config.serverURL != nil { // a local-only build has nothing to sign in to
                HStack {
                    Text(t("notSignedIn")).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(t("continueGoogle")) { model.signIn() }.disabled(model.signingIn)
                }
            }
        }
    }

    private var interval: some View {
        Section(t("howOften")) {
            Picker(t("howOften"), selection: Binding(
                get: { form.custom ? 0 : form.draft.intervalMin },
                set: { v in
                    form.custom = v == 0
                    if v != 0 { form.draft.intervalMin = v }
                })) {
                ForEach(SettingsForm.presets, id: \.self) { m in Text(t(Self.intervalLabels[m] ?? "")).tag(m) }
                Text(t("custom")).tag(0)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            if form.custom {
                HStack {
                    Text(t("every"))
                    TextField("", value: $form.draft.intervalMin, format: .number).frame(width: 60)
                    Text(t("minutes"))
                }
            }
        }
    }

    private var areas: some View {
        Section {
            ForEach(Routine.areas, id: \.self) { area in
                Toggle(isOn: Binding(
                    get: { form.draft.areas.contains(area) },
                    set: { on in
                        let picked = Set(form.draft.areas).union(on ? [area] : []).subtracting(on ? [] : [area])
                        form.draft.areas = Routine.areas.filter(picked.contains)
                    })) {
                    VStack(alignment: .leading) {
                        Text(I18n.areaName(lang, area))
                        Text(t("areaHint.\(area)")).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        } header: {
            Text(t("whereFeel"))
        } footer: {
            Text(t("pickAreas")).font(.caption)
        }
    }

    private var hours: some View {
        Section(t("when")) {
            HStack {
                Text(t("from"))
                TimeField(value: $form.draft.activeStart)
                Text(t("to"))
                TimeField(value: $form.draft.activeEnd)
            }
            Picker(t("weekStarts"), selection: $form.draft.weekStart) {
                ForEach([6, 0, 1], id: \.self) { d in Text(t("weekday.\(d)")).tag(d) }
            }
            HStack {
                ForEach(BreakSchedule.weekOrder(form.draft.weekStart), id: \.self) { d in
                    Toggle(t("day.\(d)"), isOn: Binding(
                        get: { form.draft.workdays.contains(d) },
                        set: { on in
                            var w = form.draft.workdays.filter { $0 != d }
                            if on { w.append(d) }
                            form.draft.workdays = w.sorted()
                        }))
                    .toggleStyle(.button)
                }
            }
            Toggle(t("autoPause"), isOn: $form.draft.autoPause)
        }
    }

    private var mode: some View {
        Section(t("playMode")) {
            Picker(t("playMode"), selection: $form.draft.mode) {
                Text(t("personal")).tag("personal")
                Text(t("competitive")).tag("competitive")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            Text(t(form.draft.mode == "competitive" ? "modeCompetitiveHint" : "modePersonalHint")).font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// An "HH:MM" setting as a time picker.
private struct TimeField: View {
    @Binding var value: String

    var body: some View {
        DatePicker("", selection: Binding(get: { date }, set: { value = Self.format($0) }), displayedComponents: .hourAndMinute)
            .labelsHidden()
    }

    private var date: Date {
        let parts = value.split(separator: ":").compactMap { Int($0) }
        return Calendar.current.date(bySettingHour: parts.first ?? 9, minute: parts.count > 1 ? parts[1] : 0, second: 0, of: Date()) ?? Date()
    }

    private static func format(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }
}
