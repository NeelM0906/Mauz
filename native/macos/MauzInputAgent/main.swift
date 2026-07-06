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
let output = EventOutput(socketPath: getSocketPath())

func emit<T: Encodable>(_ event: T) {
    guard let data = try? encoder.encode(event) else {
        return
    }

    output.write(data)
    output.write(Data([0x0a]))
}

func emitPermissionError() {
    emit(
        PermissionErrorEvent(
            message: "Mauz needs Accessibility permission to detect the mouse shake. Open System Settings -> Privacy & Security -> Accessibility, then enable MauzInputAgent."
        )
    )
}

// Fix 3: Support MAUZ_AX_PROMPT=0 to skip the system prompt on automatic retries.
let promptForAccessibility = ProcessInfo.processInfo.environment["MAUZ_AX_PROMPT"] != "0"
let accessibilityOptions = [
    kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: promptForAccessibility
] as CFDictionary

guard AXIsProcessTrustedWithOptions(accessibilityOptions) else {
    emitPermissionError()
    exit(2)
}

let eventMask = CGEventMask(1 << CGEventType.mouseMoved.rawValue)

// Fix 1: File-scope port so the callback can re-enable the tap when macOS disables it
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

// Fix 4: Parent-death watchdog — exit cleanly if Electron is SIGKILLed so the
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

final class EventOutput {
    private let fileHandle: FileHandle
    private let usesStdout: Bool

    init(socketPath: String?) {
        if let socketPath, let socketHandle = connectUnixSocket(path: socketPath) {
            self.fileHandle = socketHandle
            self.usesStdout = false
        } else {
            self.fileHandle = .standardOutput
            self.usesStdout = true
        }
    }

    func write(_ data: Data) {
        fileHandle.write(data)

        if usesStdout {
            fflush(stdout)
        }
    }
}

func getSocketPath() -> String? {
    let arguments = CommandLine.arguments

    for index in arguments.indices where arguments[index] == "--socket" {
        let valueIndex = arguments.index(after: index)

        if valueIndex < arguments.endIndex {
            return arguments[valueIndex]
        }
    }

    return nil
}

func connectUnixSocket(path: String) -> FileHandle? {
    let fileDescriptor = socket(AF_UNIX, SOCK_STREAM, 0)

    guard fileDescriptor >= 0 else {
        return nil
    }

    var address = sockaddr_un()
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    address.sun_family = sa_family_t(AF_UNIX)

    let pathBytes = Array(path.utf8)
    let maxPathLength = MemoryLayout.size(ofValue: address.sun_path)

    guard pathBytes.count < maxPathLength else {
        close(fileDescriptor)
        return nil
    }

    withUnsafeMutableBytes(of: &address.sun_path) { buffer in
        buffer.copyBytes(from: pathBytes)
        buffer[pathBytes.count] = 0
    }

    let connected = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
            connect(fileDescriptor, socketAddress, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }

    guard connected == 0 else {
        close(fileDescriptor)
        return nil
    }

    return FileHandle(fileDescriptor: fileDescriptor, closeOnDealloc: true)
}
