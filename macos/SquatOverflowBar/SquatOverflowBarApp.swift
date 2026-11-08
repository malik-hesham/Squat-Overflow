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

/// The menu bar item: an icon plus the next-break countdown ("23m", "45s", "move").
struct MenuBarLabel: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "figure.strengthtraining.functional")
            if let text = model.countdown {
                Text(text).monospacedDigit()
            }
        }
        .accessibilityLabel(model.countdown.map { "Squat Overflow, next break in \($0)" } ?? "Squat Overflow")
    }
}
