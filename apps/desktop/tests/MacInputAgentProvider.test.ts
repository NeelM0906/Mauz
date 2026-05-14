import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { MacInputAgentProvider } from "../src/main/input/MacInputAgentProvider";
import type { ShakeDetectorResult } from "../src/main/input/ShakeDetector";

class FakeChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  kill(): boolean {
    this.killed = true;
    this.emit("exit", null, "SIGTERM");
    return true;
  }
}

function createDetector(result: ShakeDetectorResult = { activated: false }) {
  return {
    push: vi.fn(() => result),
    reset: vi.fn()
  };
}

describe("MacInputAgentProvider", () => {
  it("parses mouse_move JSON and feeds the shake detector", () => {
    const child = new FakeChildProcess();
    const detector = createDetector();
    const provider = new MacInputAgentProvider({
      platform: "darwin",
      helperPath: "/tmp/MauzInputAgent",
      pathExists: () => true,
      spawn: () => child,
      detector
    });

    provider.start();
    child.stdout.write('{"type":"mouse_move","x":123,"y":456,"ts":1710000000000}\n');

    expect(detector.push).toHaveBeenCalledWith({
      x: 123,
      y: 456,
      ts: 1710000000000
    });
  });

  it("ignores malformed JSON from the helper", () => {
    const child = new FakeChildProcess();
    const detector = createDetector();
    const provider = new MacInputAgentProvider({
      platform: "darwin",
      helperPath: "/tmp/MauzInputAgent",
      pathExists: () => true,
      spawn: () => child,
      detector
    });

    provider.start();
    child.stdout.write("not-json\n");
    child.stdout.write('{"type":"mouse_move","x":"bad","y":456,"ts":1710000000000}\n');

    expect(detector.push).not.toHaveBeenCalled();
  });

  it("forwards permission_error events", () => {
    const child = new FakeChildProcess();
    const provider = new MacInputAgentProvider({
      platform: "darwin",
      helperPath: "/tmp/MauzInputAgent",
      pathExists: () => true,
      spawn: () => child
    });
    const listener = vi.fn();

    provider.onPermissionError(listener);
    provider.start();
    child.stdout.write(
      '{"type":"permission_error","permission":"accessibility","message":"Mauz needs Accessibility permission to detect the mouse shake."}\n'
    );

    expect(listener).toHaveBeenCalledWith({
      permission: "accessibility",
      message: "Mauz needs Accessibility permission to detect the mouse shake."
    });
  });

  it("emits activation when the shake detector activates", () => {
    const child = new FakeChildProcess();
    const provider = new MacInputAgentProvider({
      platform: "darwin",
      helperPath: "/tmp/MauzInputAgent",
      pathExists: () => true,
      spawn: () => child,
      detector: createDetector({ activated: true })
    });
    const listener = vi.fn();

    provider.onActivation(listener);
    provider.start();
    child.stdout.write('{"type":"mouse_move","x":321,"y":654,"ts":1710000000000}\n');

    expect(listener).toHaveBeenCalledWith({
      source: "mouse-shake",
      cursor: {
        x: 321,
        y: 654
      }
    });
  });

  it("reports a friendly error when the helper binary is missing", () => {
    const provider = new MacInputAgentProvider({
      platform: "darwin",
      helperPath: "/missing/MauzInputAgent",
      pathExists: () => false
    });
    const listener = vi.fn();

    provider.onPermissionError(listener);
    provider.start();

    expect(listener).toHaveBeenCalledWith({
      permission: "unknown",
      message:
        "Mauz native input helper is not built. Run native/macos/MauzInputAgent/build.sh, then restart Mauz."
    });
  });

  it("kills the helper process on stop", () => {
    const child = new FakeChildProcess();
    const provider = new MacInputAgentProvider({
      platform: "darwin",
      helperPath: "/tmp/MauzInputAgent",
      pathExists: () => true,
      spawn: () => child
    });

    provider.start();
    provider.stop();

    expect(child.killed).toBe(true);
  });
});
