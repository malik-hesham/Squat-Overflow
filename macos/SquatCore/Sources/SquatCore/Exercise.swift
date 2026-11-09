import Foundation

/// One exercise of the catalog: exerciseCatalog() in extension/lib/pose/catalog.js, also what the
/// pose gateway's "ready" message sends.
public struct Exercise: Codable, Equatable, Sendable {
    public var key: String
    public var label: String
    public var metric: String?
    public var category: String
    public var camera: String
    public var howTo: String
    public var stance: String?
    /// `{ youtube_id, start, end, title }` or null.
    public var demo: JSONValue?

    public init(key: String, label: String, metric: String? = nil, category: String, camera: String,
                howTo: String, stance: String? = nil, demo: JSONValue? = nil) {
        self.key = key; self.label = label; self.metric = metric; self.category = category
        self.camera = camera; self.howTo = howTo; self.stance = stance; self.demo = demo
    }

    enum CodingKeys: String, CodingKey {
        case key, label, metric, category, camera, stance, demo
        case howTo = "how_to"
    }
}

extension Exercise {
    /// The office catalog, exported from extension/lib/pose by macos/scripts/parity-fixtures.mjs.
    public static let catalog: [Exercise] = {
        guard let url = Bundle.module.url(forResource: "catalog", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([Exercise].self, from: data)) ?? []
    }()
}
