import SwiftUI

struct MenuView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let session = model.session {
                signedIn(session)
            } else {
                signedOut
            }
            if let error = model.error {
                Text(error).font(.caption).foregroundStyle(.red).fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            footer
        }
        .padding(14)
        .frame(width: 300)
        .task { await model.refresh() } // every time the menu opens
    }

    // MARK: Signed out

    private var signedOut: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Squat Overflow").font(.headline)

            nextBreak

            breakNowButton

            // Optional, like the extension's Options → Profile: everything above works signed out.
            VStack(alignment: .leading, spacing: 6) {
                Text("Sign in to sync your schedule and see your level, streak and team board.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Button {
                    model.signIn()
                } label: {
                    HStack {
                        if model.signingIn { ProgressView().controlSize(.small) }
                        Text("Continue with Google")
                    }
                    .frame(maxWidth: .infinity)
                }
                .disabled(model.signingIn)
            }
        }
    }

    private var breakNowButton: some View {
        Button(action: model.breakNow) {
            Label("Break now", systemImage: "figure.walk").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .help("Opens the break in Chrome")
    }

    // MARK: Signed in

    @ViewBuilder
    private func signedIn(_ session: Session) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(model.settings?.name.isEmpty == false ? model.settings!.name : (session.name.isEmpty ? "Squat Overflow" : session.name))
                .font(.headline)
            Text(session.email).font(.caption).foregroundStyle(.secondary)
        }

        if let p = model.profile {
            progress(p)
            HStack(spacing: 16) {
                stat("🔥", "\(p.streak)", p.streak == 1 ? "day streak" : "days streak")
                stat("✅", "\(p.todayBreaks)", "today")
                stat("⚡️", "\(p.weekXp)", "XP this week")
            }
        } else {
            ProgressView().controlSize(.small)
        }

        nextBreak

        breakNowButton

        team
    }

    private func progress(_ p: Profile) -> some View {
        let lvl = Levels.progress(xp: p.xp)
        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Level \(p.level) · \(p.levelName)").font(.subheadline.weight(.semibold))
                Spacer()
                Text(lvl.next.map { "\(p.xp) / \($0) XP" } ?? "\(p.xp) XP")
                    .font(.caption).monospacedDigit().foregroundStyle(.secondary)
            }
            ProgressView(value: min(max(lvl.fraction, 0), 1)).tint(.green)
        }
    }

    private func stat(_ icon: String, _ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(icon) \(value)").font(.body.weight(.semibold)).monospacedDigit()
            Text(label).font(.caption2).foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var nextBreak: some View {
        if let next = model.nextBreak {
            let left = next.timeIntervalSince(model.now)
            HStack {
                Image(systemName: "timer")
                Text(left <= 0 ? "Time to move" : "Next break in \(Schedule.countdownText(left))")
                Spacer()
                Text(next, format: Date.FormatStyle(date: Calendar.current.isDateInToday(next) ? .omitted : .abbreviated, time: .shortened))
                    .foregroundStyle(.secondary)
            }
            .font(.callout)
        }
    }

    @ViewBuilder
    private var team: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Team this week").font(.subheadline.weight(.semibold))
            if !model.boardLoaded {
                ProgressView().controlSize(.small)
            } else if model.board.isEmpty {
                Text("No team board yet. It needs a company email and Competitive mode.")
                    .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(model.board) { row in
                    HStack {
                        Text("\(row.rank).").monospacedDigit().frame(width: 20, alignment: .trailing)
                        Text(row.name).lineLimit(1)
                        Spacer()
                        Text("\(row.xp) XP").monospacedDigit().foregroundStyle(.secondary)
                    }
                    .font(.callout.weight(row.isMe ? .semibold : .regular))
                }
            }
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack {
            Button("Open settings", action: model.openSettings)
            if model.session != nil {
                Button("Sign out", action: model.signOut)
            }
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }
        }
        .buttonStyle(.link)
        .font(.callout)
    }
}
