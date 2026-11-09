import AppKit
import CoreAudio
import CoreGraphics
import SquatCore

/// What the extension asks Chrome when a break is due (chrome.idle and inMeeting() in
/// extension/service-worker.js), answered from the Mac itself. Nothing here reads window titles,
/// audio or video: only whether input is idle, the screen is locked, the microphone is in use,
/// or the front app is fullscreen.
enum Presence {
    /// chrome.idle.queryState(): "locked", "idle" after `threshold` seconds without input, else "active".
    static func idleState(threshold: Int) -> IdleState {
        if screenLocked() { return .locked }
        let anyInput = CGEventType(rawValue: ~0)!
        let idle = CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: anyInput)
        return idle >= Double(threshold) ? .idle : .active
    }

    static func screenLocked() -> Bool {
        let info = CGSessionCopyCurrentDictionary() as? [String: Any]
        return info?["CGSSessionScreenIsLocked"] as? Bool ?? false
    }

    /// The Mac stand-in for "an audible Meet, Zoom or Teams tab, or a fullscreen window": some app
    /// is using the microphone (a call in any app), or the front app is fullscreen.
    static func inMeeting() -> Bool { microphoneInUse() || frontAppIsFullscreen() }

    static func microphoneInUse() -> Bool {
        var device = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyDefaultInputDevice,
                                                 mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &device) == noErr,
              device != 0 else { return false }
        var running = UInt32(0)
        size = UInt32(MemoryLayout<UInt32>.size)
        address.mSelector = kAudioDevicePropertyDeviceIsRunningSomewhere
        guard AudioObjectGetPropertyData(device, &address, 0, nil, &size, &running) == noErr else { return false }
        return running != 0
    }

    static func frontAppIsFullscreen() -> Bool {
        guard let pid = NSWorkspace.shared.frontmostApplication?.processIdentifier,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        else { return false }
        let screens = NSScreen.screens.map(\.frame.size)
        return windows.contains { w in
            guard w[kCGWindowOwnerPID as String] as? pid_t == pid, w[kCGWindowLayer as String] as? Int == 0,
                  let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { return false }
            let size = CGSize(width: b["Width"] ?? 0, height: b["Height"] ?? 0)
            return screens.contains(size)
        }
    }
}
