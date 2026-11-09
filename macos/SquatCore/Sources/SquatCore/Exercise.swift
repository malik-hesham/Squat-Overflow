import Foundation

/// One exercise of the pose server's catalog, as the "ready" message sends it
/// (server/src/catalog.ts) and extension/lib/store.js caches it.
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
