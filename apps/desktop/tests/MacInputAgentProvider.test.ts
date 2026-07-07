import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  describe("restart budget reset (fix 2)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("resets restartAttempts on the first valid sample so two distant crashes do not exhaust the cap", () => {
      const children = [new FakeChildProcess(), new FakeChildProcess(), new FakeChildProcess()];
      let spawnCount = 0;

      const provider = new MacInputAgentProvider({
        platform: "darwin",
        helperPath: "/tmp/MauzInputAgent",
        pathExists: () => true,
        spawn: () => children[spawnCount++]!,
        maxRestarts: 1,
        restartDelayMs: 100
      });

      provider.start();
      // First child receives a valid sample, then crashes.
      children[0]!.stdout.write('{"type":"mouse_move","x":1,"y":2,"ts":1000}\n');
      children[0]!.emit("exit", null, null);

      vi.advanceTimersByTime(200); // restart fires, child 1 spawned (restartAttempts now 1)

      // Second child receives a valid sample — this resets restartAttempts to 0.
      children[1]!.stdout.write('{"type":"mouse_move","x":3,"y":4,"ts":2000}\n');
      children[1]!.emit("exit", null, null);

      vi.advanceTimersByTime(200); // restart fires again because budget was reset

      // Without the fix only 2 spawns would occur; with the fix a third spawn happens.
      expect(spawnCount).toBe(3);
    });
  });

  describe("permission retry (fix 3)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("re-spawns the helper after 15 s when a permission failure occurs", () => {
      const children = [new FakeChildProcess(), new FakeChildProcess()];
      let spawnCount = 0;
      const spawnEnvs: Array<NodeJS.ProcessEnv | undefined> = [];

      const provider = new MacInputAgentProvider({
        platform: "darwin",
        helperPath: "/tmp/MauzInputAgent",
        pathExists: () => true,
        spawn: (_cmd, _args, opts) => {
          spawnEnvs.push(opts?.env);
          return children[spawnCount++]!;
        },
        permissionRetryDelayMs: 15_000
      });

      provider.start();
      children[0]!.stdout.write(
        '{"type":"permission_error","permission":"accessibility","message":"need perms"}\n'
      );
      children[0]!.emit("exit", 2, null);

      expect(spawnCount).toBe(1); // no immediate respawn

      vi.advanceTimersByTime(15_000);

      expect(spawnCount).toBe(2); // retry spawn
      expect(spawnEnvs[1]?.MAUZ_AX_PROMPT).toBe("0"); // no prompt on retry
    });

    it("clears permissionFailure and resumes normal restarts when retried helper emits a valid sample", () => {
      const children = [new FakeChildProcess(), new FakeChildProcess(), new FakeChildProcess()];
      let spawnCount = 0;

      const provider = new MacInputAgentProvider({
        platform: "darwin",
        helperPath: "/tmp/MauzInputAgent",
        pathExists: () => true,
        spawn: () => children[spawnCount++]!,
        maxRestarts: 1,
        restartDelayMs: 100,
        permissionRetryDelayMs: 15_000
      });

      provider.start();
      // Child 0 reports permission failure.
      children[0]!.stdout.write(
        '{"type":"permission_error","permission":"accessibility","message":"need perms"}\n'
      );
      children[0]!.emit("exit", 2, null);

      // Retry fires, child 1 spawned.
      vi.advanceTimersByTime(15_000);

      // Child 1 (retry) emits a valid sample — permission was granted.
      children[1]!.stdout.write('{"type":"mouse_move","x":5,"y":6,"ts":3000}\n');

      // Child 1 crashes for an unrelated reason.
      children[1]!.emit("exit", null, null);
      vi.advanceTimersByTime(200); // normal restart delay

      // Normal restart should fire because permissionFailure was cleared.
      expect(spawnCount).toBe(3);
    });

    it("stops the permission retry timer on stop()", () => {
      const children = [new FakeChildProcess()];
      let spawnCount = 0;

      const provider = new MacInputAgentProvider({
        platform: "darwin",
        helperPath: "/tmp/MauzInputAgent",
        pathExists: () => true,
        spawn: () => children[spawnCount++]!,
        permissionRetryDelayMs: 15_000
      });

      provider.start();
      children[0]!.stdout.write(
        '{"type":"permission_error","permission":"accessibility","message":"need perms"}\n'
      );
      children[0]!.emit("exit", 2, null);

      provider.stop();
      vi.advanceTimersByTime(20_000); // past retry delay

      expect(spawnCount).toBe(1); // no retry after stop
    });
  });
});
