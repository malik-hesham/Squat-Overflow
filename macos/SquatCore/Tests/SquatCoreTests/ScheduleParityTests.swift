import SquatCore
import XCTest

/// extension/lib/schedule.js
final class ScheduleParityTests: XCTestCase {
    func testConstants() {
        checkParity("schedule.constants") { _ in
            .object([
                "SNOOZE_MIN": .number(Double(BreakSchedule.snoozeMin)), "SNOOZE_CAP": .number(Double(BreakSchedule.snoozeCap)),
                "WARN_SKIPS": .number(Double(BreakSchedule.warnSkips)), "PAUSE_MIN": .number(Double(BreakSchedule.pauseMin)),
                "LATE_MS": .number(Double(BreakSchedule.lateMs)), "DEFER_MIN": .number(Double(BreakSchedule.deferMin)),
                "IDLE_SEC": .number(Double(BreakSchedule.idleSec)),
            ])
        }
    }

    func testInitialSchedule() {
        checkParity("schedule.initialSchedule") { try json(BreakSchedule.initial(now: try $0[0].as_(), intervalMin: try $0[1].as_())) }
    }

    func testOnFireKeepsTheGrid() {
        checkParity("schedule.onFire") { try json(BreakSchedule.onFire(try $0[0].as_(), now: try $0[1].as_(), intervalMin: try $0[2].as_())) }
    }

    func testSnoozeCapAndSkipWarning() {
        checkParity("schedule.canSnooze") { .bool(BreakSchedule.canSnooze(try $0[0].as_())) }
        checkParity("schedule.showWarning") { .bool(BreakSchedule.showWarning(try $0[0].as_())) }
        checkParity("schedule.warningHours") { .number(BreakSchedule.warningHours(skips: try $0[0].as_(), intervalMin: try $0[1].as_())) }
    }

    func testApplyAction() {
        checkParity("schedule.applyAction") {
            try json(BreakSchedule.apply(try $0[1].as_(String.self), to: try $0[0].as_(), now: try $0[2].as_(), intervalMin: try $0[3].as_()))
        }
    }

    func testRescheduleAndUpcoming() {
        checkParity("schedule.rescheduleForInterval") {
            try json(BreakSchedule.rescheduleForInterval(try $0[0].as_(), now: try $0[1].as_(), intervalMin: try $0[2].as_()))
        }
        checkParity("schedule.upcoming") { try json(BreakSchedule.upcoming(try $0[0].as_(), intervalMin: try $0[1].as_(), count: try $0[2].as_())) }
    }

    func testActiveHoursAcrossDaylightSaving() {
        checkParity("schedule.isActive") { .bool(BreakSchedule.isActive(try $0[0].as_(), hours: try $0[1].as_())) }
        checkParity("schedule.nextActiveSlot") {
            .number(Double(BreakSchedule.nextActiveSlot(try $0[0].as_(), intervalMin: try $0[1].as_(), hours: try $0[2].as_())))
        }
    }

    func testDecideFire() {
        checkParity("schedule.decideFire") { args in
            let ctx = args[3]
            let settings = ctx["settings"]!
            return try json(BreakSchedule.decideFire(
                try args[0].as_(), now: try args[1].as_(), intervalMin: try args[2].as_(),
                idle: try ctx["idle"]!.as_(), meeting: try ctx["meeting"]!.as_(),
                hours: try settings.as_(), autoPause: try settings["autoPause"]!.as_()))
        }
    }

    func testScheduleSettingsChanged() {
        checkParity("schedule.scheduleSettingsChanged") { .bool(BreakSchedule.settingsChanged(try $0[0].as_(Hours.self, interval: true), try $0[1].as_(Hours.self, interval: true))) }
    }

    func testWeekOrderAndCountdown() {
        checkParity("schedule.weekOrder") { try json(BreakSchedule.weekOrder(try $0[0].as_())) }
        checkParity("schedule.countdownText") { .string(BreakSchedule.countdownText(try $0[0].as_())) }
    }
}

private extension JSONValue {
    /// Hours plus the interval, for scheduleSettingsChanged().
    func as_(_: Hours.Type, interval: Bool) throws -> (Hours, Int) { (try as_(Hours.self), try self["intervalMin"]!.as_(Int.self)) }
}
