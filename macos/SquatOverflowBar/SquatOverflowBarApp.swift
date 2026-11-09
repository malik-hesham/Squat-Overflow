import SquatCore
import SwiftUI

@main
struct SquatOverflowBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
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

final class AppDelegate: NSObject, NSApplicationDelegate {
    /// The unit tests run inside the app and wait on the pose model, so the app stays open for them.
    /// SwiftUI quits an app whose only scene is a MenuBarExtra when macOS hides its item
    /// (System Settings > Menu Bar), which can happen before the first test starts.
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        AppModel.underTests ? .terminateCancel : .terminateNow
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
