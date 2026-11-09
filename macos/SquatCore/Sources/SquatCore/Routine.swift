import Foundation

/// One exercise of a break, toMove() in extension/lib/routine.js.
public struct Move: Codable, Equatable, Sendable {
    public var key: String
    public var label: String
    public var area: String
    public var camera: String
    public var stance: String
    public var howTo: String
    public var demo: JSONValue?
    public var target: Int

    public init(key: String, label: String, area: String, camera: String, stance: String, howTo: String, demo: JSONValue?, target: Int) {
        self.key = key; self.label = label; self.area = area; self.camera = camera
        self.stance = stance; self.howTo = howTo; self.demo = demo; self.target = target
    }

    /// The demo clip's YouTube id, if the catalog has one.
    public var youtubeID: String? { demo?["youtube_id"]?.string }

    enum CodingKeys: String, CodingKey {
        case key, label, area, camera, stance, demo, target
        case howTo = "how_to"
    }
}

/// Port of extension/lib/routine.js: pain areas, the weekly featured area, and which three
/// exercises a break has.
public enum Routine {
    /// Pain areas, matching the server's exercise categories (five exercises each).
    public static let areas = [
        "Neck tension",
        "Rounded shoulders",
        "Upper back",
        "Shoulder & rotator cuff",
        "Lower back",
        "Wrist & hand",
        "Knees",
        "Eyes",
    ]

    public static let breakReps = 6

    /// Eyes is opt-in: it never becomes the weekly featured area.
    static let featuredAreas = areas.filter { $0 != "Eyes" }

    /// Area names from before the pain areas, so old settings and this week's challenge still work.
    static let legacyAreas: [String: [String]] = [
        "Neck": ["Neck tension"],
        "Shoulders": ["Shoulder & rotator cuff"],
        "Upper back & posture": ["Upper back", "Rounded shoulders"],
        "Arms & wrists": ["Wrist & hand"],
        "Lower back & core": ["Lower back"],
        "Hips & glutes": ["Lower back", "Knees"],
        "Legs & circulation": ["Knees"],
    ]

    /// Saved areas → current area names, in `areas` order; unknown names are dropped.
    public static func currentAreas(_ saved: [String]) -> [String] {
        let named = Set(saved.flatMap { legacyAreas[$0] ?? [$0] })
        return areas.filter { named.contains($0) }
    }

    public static func featuredArea(_ now: Millis) -> String {
        featuredAreas[XP.isoWeekNumber(now) % featuredAreas.count]
    }

    static func toMove(_ e: Exercise) -> Move {
        Move(key: e.key, label: e.label, area: e.category, camera: e.camera, stance: e.stance ?? "seated",
             howTo: e.howTo, demo: e.demo, target: breakReps)
    }

    /// buildRoutine(): up to three areas starting at break `n`, one exercise each, rotating
    /// through each area's list and skipping `lastKey` in the first slot.
    public static func build(catalog: [Exercise], areas: [String], lastKey: String?, n: Int) -> [Move] {
        var slots: [String] = []
        var i = 0
        while slots.count < 3 && !areas.isEmpty && i < 3 {
            slots.append(areas[(n + i) % areas.count])
            i += 1
        }
        var moves: [Move] = []
        for area in slots {
            let list = catalog.filter { $0.category == area }
            for k in 0..<list.count {
                let e = list[(n + k) % list.count]
                if moves.contains(where: { $0.key == e.key }) { continue }
                if moves.isEmpty && e.key == lastKey { continue }
                moves.append(toMove(e))
                break
            }
        }
        return moves
    }

    /// The next exercise in the same area that isn't already in the break, or nil.
    public static func swapMove(catalog: [Exercise], moves: [Move], index i: Int) -> Move? {
        let list = catalog.filter { $0.category == moves[i].area }
        let start = list.firstIndex { $0.key == moves[i].key } ?? -1
        guard list.count > 1 else { return nil }
        for step in 1..<list.count {
            let e = list[((start + step + list.count) % list.count + list.count) % list.count]
            if !moves.enumerated().contains(where: { $0.offset != i && $0.element.key == e.key }) { return toMove(e) }
        }
        return nil
    }

    /// Side-on and standing moves need the user to step back into frame first.
    public static func needsPositioning(_ move: Move) -> Bool {
        move.camera == "side" || move.stance == "standing"
    }

    /// The next unfinished exercise after `from`, wrapping round; -1 when all are done.
    public static func nextOpenMove(moves: [Move], reps: [Int], from: Int) -> Int {
        guard !moves.isEmpty else { return -1 }
        for step in 1...moves.count {
            let k = (from + step) % moves.count
            if reps[k] < moves[k].target { return k }
        }
        return -1
    }
}
