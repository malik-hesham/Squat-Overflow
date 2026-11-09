import SquatCore
import XCTest

/// extension/lib/sync-core.js
final class SyncCoreParityTests: XCTestCase {
    func testConstants() {
        checkParity("syncCore.constants") { _ in
            .object([
                "OUTBOX_MAX": .number(Double(SyncCore.outboxMax)), "PUSH_BATCH": .number(Double(SyncCore.pushBatch)),
                "PULL_LIMIT": .number(Double(SyncCore.pullLimit)), "MIN_AT": .number(Double(SyncCore.minAt)),
                "SHARED_KEYS": try json(SyncCore.sharedKeys), "BACKFILL_NAMESPACE": .string(SyncCore.backfillNamespace),
            ])
        }
    }

    func testBreakEventClampsAndRefusesOutOfRangeTimes() {
        checkParity("syncCore.breakEvent") { args in
            let o = args[1]
            let areas = try o["areas"]?.array?.map { try $0.as_(String.self) } ?? []
            let event = SyncCore.breakEvent(try args[0].as_(LogEntry.self), id: try o["id"]!.as_(), areas: areas,
                                            device: try o["device"]!.as_(), now: try o["now"]!.as_())
            return try event.map(json) ?? .null
        }
    }

    func testUUIDv5() {
        checkParity("syncCore.uuidv5") { .string(SyncCore.uuidv5(try $0[0].as_(), namespace: try $0[1].as_())) }
    }

    func testBackfillEvents() {
        // The extension stamps its breaks "chrome"; the Mac app stamps its own "mac".
        let macDevice: (JSONValue) -> JSONValue = { v in
            guard var o = v.object, let events = o["events"]?.array else { return v }
            o["events"] = .array(events.map { e in
                guard var eo = e.object else { return e }
                if eo["device"] == .string("chrome") { eo["device"] = .string(SyncCore.device) }
                return .object(eo)
            })
            return .object(o)
        }
        checkParity("syncCore.backfillEvents", normalize: macDevice) { args in
            let r = SyncCore.backfillEvents(try args[0].as_([LogEntry].self), playerId: try args[1].as_(), now: try args[2].as_())
            return .object(["events": try json(r.events), "log": try json(r.log)])
        }
    }

    func testOutbox() {
        checkParity("syncCore.addToOutbox") { args in
            let incoming = try args[1].as_([JSONValue].self).map { $0.isNull ? nil : try $0.as_(OutboxItem.self) }
            return try json(SyncCore.addToOutbox(try args[0].as_([OutboxItem].self), incoming))
        }
        checkParity("syncCore.addToOutbox.capped") { args in
            let big = (0..<(try args[0].as_(Int.self))).map { OutboxItem(id: "o\($0)") }
            let grown = SyncCore.addToOutbox(big, try args[1].as_([String].self).map { OutboxItem(id: $0) })
            return .object(["length": .number(Double(grown.count)), "first": .string(grown.first!.id), "last": .string(grown.last!.id)])
        }
        checkParity("syncCore.removeFromOutbox") { try json(SyncCore.removeFromOutbox(try $0[0].as_([OutboxItem].self), ids: try $0[1].as_())) }
    }

    func testSettingsMerge() {
        checkParity("syncCore.changedSharedKeys") { try json(SyncCore.changedSharedKeys(try $0[0].as_(), try $0[1].as_())) }
        checkParity("syncCore.markDirty") { try json(SyncCore.markDirty(try $0[0].as_(), keys: try $0[1].as_(), at: try $0[2].as_())) }
        checkParity("syncCore.clearDirty") { args in
            try json(SyncCore.clearDirty(args[0].isNull ? nil : try args[0].as_(), sent: try args[1].as_()))
        }
        checkParity("syncCore.seedPatch") { try json(SyncCore.seedPatch(try $0[0].as_(), doc: try $0[1].as_())) }
        checkParity("syncCore.remotePatch") { args in
            try json(SyncCore.remotePatch(try args[0].as_(), doc: args[1].isNull ? nil : try args[1].as_(), dirty: args[2].isNull ? nil : try args[2].as_()))
        }
    }

    func testDirtyPatchesGroupByChangeTime() {
        // `invalid` follows JS object key order, which means nothing here: compare it sorted.
        let sortInvalid: (JSONValue) -> JSONValue = { v in
            guard var o = v.object, let list = o["invalid"]?.array else { return v }
            o["invalid"] = .array(list.sorted { ($0.string ?? "") < ($1.string ?? "") })
            return .object(o)
        }
        checkParity("syncCore.dirtyPatches", normalize: sortInvalid) { args in
            let r = SyncCore.dirtyPatches(try args[0].as_(), dirty: try args[1].as_())
            return .object(["patches": try json(r.patches), "invalid": try json(r.invalid)])
        }
    }

    func testProgressOf() {
        checkParity("syncCore.progressOf") { try json(SyncCore.progressOf(try $0[0].as_(Profile.self))) }
    }

    func testMergeProfileTakesServerTotalsAndUnionsBadges() {
        checkParity("syncCore.mergeProfile") { try json(SyncCore.mergeProfile(try $0[0].as_(), server: try $0[1].as_())) }
    }

    func testMergeLog() {
        checkParity("syncCore.mergeLog") { args in
            let r = SyncCore.mergeLog(try args[0].as_(), events: try args[1].as_(), max: try args[2].as_())
            return .object(["log": try json(r.log), "added": try json(r.added)])
        }
        checkParity("syncCore.lastBreakAt") { .number(Double(SyncCore.lastBreakAt(try $0[0].as_([LogEntry].self)))) }
    }
}

/// An outbox entry as the fixtures have it: an id plus whatever else the event carries.
struct OutboxItem: Codable, Identifiable, Equatable {
    var id: String
    var raw: JSONValue
    init(id: String) { self.id = id; raw = .object(["id": .string(id)]) }
    init(from decoder: Decoder) throws {
        raw = try JSONValue(from: decoder)
        id = raw["id"]?.string ?? ""
    }
    func encode(to encoder: Encoder) throws { try raw.encode(to: encoder) }
}
