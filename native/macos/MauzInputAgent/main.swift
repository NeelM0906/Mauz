import ApplicationServices
import Darwin
import Foundation

struct MouseMoveEvent: Encodable {
    let type = "mouse_move"
    let x: Int
    let y: Int
    let ts: Int64
}

struct PermissionErrorEvent: Encodable {
    let type = "permission_error"
    let permission = "accessibility"
    let message: String
}

let encoder = JSONEncoder()

func emit<T: Encodable>(_ event: T) {
    guard let data = try? encoder.encode(event) else {
        return
    }

    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    fflush(stdout)
}

func emitPermissionError() {
    emit(
        PermissionErrorEvent(
            message: "Mauz needs Accessibility permission to detect the mouse shake. Open System Settings -> Privacy & Security -> Accessibility, then enable MauzInputAgent."
        )
    )
}

// Support MAUZ_AX_PROMPT=0 to skip the system prompt on automatic retries.
let promptForAccessibility = ProcessInfo.processInfo.environment["MAUZ_AX_PROMPT"] != "0"
let accessibilityOptions = [
    kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: promptForAccessibility
] as CFDictionary

guard AXIsProcessTrustedWithOptions(accessibilityOptions) else {
    emitPermissionError()
    exit(2)
}

let eventMask = CGEventMask(1 << CGEventType.mouseMoved.rawValue)

// File-scope port so the callback can re-enable the tap when macOS disables it
// under load (.tapDisabledByTimeout / .tapDisabledByUserInput).
var eventTapPort: CFMachPort? = nil

let callback: CGEventTapCallBack = { _, type, event, _ in
    // Re-enable the tap if macOS disabled it due to timeout or user input.
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTapPort {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        return nil
    }

    if type == .mouseMoved {
        let location = event.location
        let sample = MouseMoveEvent(
            x: Int(location.x.rounded()),
            y: Int(location.y.rounded()),
            ts: Int64(Date().timeIntervalSince1970 * 1000)
        )
        emit(sample)
    }

    return Unmanaged.passUnretained(event)
}

guard let eventTap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: eventMask,
    callback: callback,
    userInfo: nil
) else {
    emitPermissionError()
    exit(2)
}

// Set before CFRunLoopRun so the callback can safely read it.
eventTapPort = eventTap

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)

// Parent-death watchdog — exit cleanly if Electron is SIGKILLed so the
// CGEventTap is released and does not linger in the system.
let parentWatchdog = DispatchSource.makeTimerSource(queue: .main)
parentWatchdog.schedule(deadline: .now() + 5, repeating: 5)
parentWatchdog.setEventHandler {
    if getppid() == 1 {
        exit(0)
    }
}
parentWatchdog.resume()

CFRunLoopRun()
