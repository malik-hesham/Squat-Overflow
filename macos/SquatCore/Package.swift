// swift-tools-version:5.10
// The Mac app's business rules, ported from the browser extension (extension/lib and
// extension/service-worker.js). No AppKit or SwiftUI here, so `swift test` runs in seconds.
import PackageDescription

let package = Package(
    name: "SquatCore",
    defaultLocalization: "en",
    platforms: [.macOS(.v14)],
    products: [.library(name: "SquatCore", targets: ["SquatCore"])],
    targets: [
        .target(name: "SquatCore", resources: [.copy("Resources/i18n.json"), .copy("Resources/catalog.json")]),
        .testTarget(name: "SquatCoreTests", dependencies: ["SquatCore"], resources: [.copy("Fixtures")]),
    ]
)
