import ApplicationServices
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
            message: "Mauz needs Accessibility permission to detect the mouse shake."
        )
    )
}

let eventMask = CGEventMask(1 << CGEventType.mouseMoved.rawValue)

let callback: CGEventTapCallBack = { _, type, event, _ in
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

let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
CGEvent.tapEnable(tap: eventTap, enable: true)
CFRunLoopRun()
