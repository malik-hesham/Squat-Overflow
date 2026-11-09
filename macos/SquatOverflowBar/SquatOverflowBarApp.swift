import SquatCore
import SwiftUI

@main
struct SquatOverflowBarApp: App {
    @StateObject private var model = AppModel()

    var body: some Scene {
        MenuBarExtra {
            MenuView()
                .environmentObject(model)
        } label: {
            MenuBarLabel(model: model)
        }
        .menuBarExtraStyle(.window)
    }
}

/// The menu bar item: an icon plus the countdown, like the extension's toolbar badge
/// (updateBadge() in extension/service-worker.js): nothing until setup is done.
struct MenuBarLabel: View {
    @ObservedObject var model: AppModel

    private var countdown: String? {
        guard model.settings.setupDone, let next = model.store.schedule().nextAt else { return nil }
        return BreakSchedule.countdownText(next - LocalTime.millis(model.now))
    }

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "figure.strengthtraining.functional")
            if let text = countdown { Text(text).monospacedDigit() }
        }
        .accessibilityLabel(countdown.map { "Squat Overflow, next break in \($0)" } ?? "Squat Overflow")
    }
}
