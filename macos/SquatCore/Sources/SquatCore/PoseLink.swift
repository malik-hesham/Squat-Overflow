import Foundation

/// One "frame" reply from the pose gateway (extension/lib/pose/gateway.js).
public struct PoseFrame: Equatable, Sendable {
    public struct RepEvent: Equatable, Sendable {
        public var score: Double
        public var partial: Bool
        public var issues: [String]
        public var issueText: [String]
        public init(score: Double, partial: Bool, issues: [String], issueText: [String]) {
            self.score = score; self.partial = partial; self.issues = issues; self.issueText = issueText
        }
    }
    public var exercise: String
    public var reps: Int
    public var feedbackCodes: [String]
    public var repEvent: RepEvent?
    /// 33 × [x, y, visibility], normalised to 0…1.
    public var landmarks: [[Double]]?

    public init(exercise: String, reps: Int, feedbackCodes: [String], repEvent: RepEvent?, landmarks: [[Double]]?) {
        self.exercise = exercise; self.reps = reps; self.feedbackCodes = feedbackCodes; self.repEvent = repEvent; self.landmarks = landmarks
    }
}

public enum PoseOutgoing: Equatable { case text(String), frame(Data) }

extension PoseFrame {
    init?(_ msg: JSONValue) {
        guard let exercise = msg["exercise"]?.string else { return nil }
        self.exercise = exercise
        reps = msg["summary"]?["reps"]?.int ?? 0
        feedbackCodes = msg["feedback"]?.array?.compactMap { $0["code"]?.string } ?? []
        if let ev = msg["rep_event"], ev.object != nil {
            repEvent = RepEvent(score: ev["score"]?.number ?? 0, partial: ev["partial"]?.bool ?? false,
                                issues: ev["issues"]?.array?.compactMap(\.string) ?? [],
                                issueText: ev["issue_text"]?.array?.compactMap(\.string) ?? [])
        }
        landmarks = msg["landmarks"]?.array?.map { $0.array?.compactMap(\.number) ?? [] }
    }
}

/// The pose conversation, ported from createPoseClient() in extension/lib/pose-client.js. The other
/// end is the extension's own lib/pose gateway, running on this Mac (PoseBridge in the app):
/// one camera frame in flight at a time (the next goes when the reply arrives), a 3 s watchdog for
/// a lost reply, the exercise and privacy mask settings, and close codes. The app owns the socket
/// and the camera and feeds events in; this decides what to send and what each reply means.
@MainActor
public final class PoseLink {
    public static let inflightTimeout = 3.0
    public static let maskMaxAge = 0.5
    public static let defaultConnections = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25],
                                            [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32]]

    private let send: (PoseOutgoing) -> Void
    private let now: () -> Double
    private let onFrame: (PoseFrame) -> Void
    private let onStatus: (PoseStatus) -> Void
    private let onCatalog: ([Exercise]) -> Void

    private var privacy: Bool
    private var running = false
    private var open = false
    private var inflightSince: Double?
    private var exercise: String?
    private var mask: (dataURL: String, at: Double)?
    public private(set) var connections = PoseLink.defaultConnections
    /// The newest reply for the current exercise, for drawing the skeleton.
    public private(set) var latest: (frame: PoseFrame, at: Double)?

    public init(privacy: Bool, send: @escaping (PoseOutgoing) -> Void, now: @escaping () -> Double,
                onFrame: @escaping (PoseFrame) -> Void, onStatus: @escaping (PoseStatus) -> Void,
                onCatalog: @escaping ([Exercise]) -> Void) {
        self.privacy = privacy
        self.send = send
        self.now = now
        self.onFrame = onFrame
        self.onStatus = onStatus
        self.onCatalog = onCatalog
    }

    private func sendJSON(_ obj: [String: JSONValue]) {
        guard open else { return }
        send(.text(JSONValue.object(obj).canonical))
    }

    /// Whether the camera should hand over its next frame now.
    public var wantsFrame: Bool { running && open && inflightSince == nil }

    /// The person mask from the server if it's recent enough to line up with the picture.
    public var freshMask: String? {
        guard let m = mask, now() - m.at < Self.maskMaxAge else { return nil }
        return m.dataURL
    }

    /// The camera is running and the socket is being opened.
    public func start() {
        running = true
        onStatus(.connecting)
    }

    public func stop() {
        running = false
        open = false
        inflightSince = nil
        mask = nil
    }

    public func opened() {
        guard running else { return }
        open = true
        inflightSince = nil
        onStatus(.open)
        if let exercise { sendJSON(["type": .string("config"), "exercise": .string(exercise)]) }
        sendJSON(["type": .string("privacy"), "enabled": .bool(privacy)])
    }

    /// The socket closed. 1011: the pose model couldn't start ("unavailable"); anything else: "offline".
    public func closed(code: Int) {
        open = false
        inflightSince = nil
        if running { onStatus(PoseStatus.closeStatus(code)) }
    }

    public func received(_ text: String) {
        guard let msg = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) else { return }
        switch msg["type"]?.string {
        case "ready":
            if let c = msg["connections"]?.array?.map({ $0.array?.compactMap(\.int) ?? [] }), !c.isEmpty { connections = c }
            if let list = try? msg["exercises"]?.decode([Exercise].self) { onCatalog(list) }
        case "frame":
            inflightSince = nil
            if let m = msg["mask"] { mask = m.string.map { ($0, now()) } }
            if let frame = PoseFrame(msg), frame.exercise == exercise {
                latest = (frame, now())
                onFrame(frame)
            }
        case "error":
            if inflightSince != nil { inflightSince = nil }
        default:
            break
        }
    }

    /// Sends a JPEG frame if the slot is free.
    public func sendFrame(_ jpeg: Data) {
        guard wantsFrame else { return }
        inflightSince = now()
        send(.frame(jpeg))
    }

    /// The watchdog: a reply that never came frees the slot after 3 s.
    public func tick() {
        if let since = inflightSince, now() - since > Self.inflightTimeout { inflightSince = nil }
    }

    public func setExercise(_ key: String) {
        exercise = key
        latest = nil
        sendJSON(["type": .string("config"), "exercise": .string(key)])
    }

    /// Blur on or off: the server only computes the person mask when it's needed.
    public func setPrivacy(_ on: Bool) {
        privacy = on
        mask = nil
        sendJSON(["type": .string("privacy"), "enabled": .bool(on)])
    }
}
