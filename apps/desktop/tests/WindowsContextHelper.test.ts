import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  WindowsContextHelper,
  type WindowsContextSpawn,
  type WindowsCoordinateConverter
} from "../src/main/context/WindowsContextHelper";

type FakeChild = EventEmitter & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill(): boolean;
};

function createFakeHelper(coordinates?: WindowsCoordinateConverter) {
  const spawned: Array<{ command: string; args: readonly string[]; child: FakeChild }> = [];
  const written: string[] = [];
  const spawn: WindowsContextSpawn = (command, args) => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => true
    });
    child.stdin.on("data", (chunk: Buffer) =>
      written.push(...chunk.toString("utf8").split("\n").filter(Boolean))
    );
    spawned.push({ command, args, child });
    return child;
  };
  const helper = new WindowsContextHelper({ spawn, ...(coordinates === undefined ? {} : { coordinates }) });

  return {
    helper,
    spawned,
    written,
    /** Answers the next request with a result once it has been written. */
    async reply(result: unknown): Promise<void> {
      await new Promise((resolve) => setImmediate(resolve));
      const request = JSON.parse(written.at(-1)!) as { id: number };
      spawned[0]!.child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`);
    }
  };
}

const scale150: WindowsCoordinateConverter = {
  toPhysicalPoint: (point) => ({ x: point.x * 1.5, y: point.y * 1.5 }),
  toDipRect: (rect) => ({
    x: rect.x / 1.5,
    y: rect.y / 1.5,
    width: rect.width / 1.5,
    height: rect.height / 1.5
  })
};

describe("WindowsContextHelper", () => {
  it("keeps the command line short and sends the helper script over stdin", () => {
    const { helper, spawned, written } = createFakeHelper();

    helper.start();

    // Windows rejects command lines over 32,767 characters; the full script no longer fits.
    expect(spawned[0]!.args.join(" ").length).toBeLessThan(4_000);
    const script = Buffer.from(written[0]!, "base64").toString("utf8");
    expect(script).toContain("function Get-MauzElementAtPoint");
    expect(script).toContain("'elementAtPoint'");
    helper.stop();
  });

  it("asks for the element in physical pixels and returns DIP bounds", async () => {
    const { helper, written, reply } = createFakeHelper(scale150);
    const pending = helper.getElementAtPoint({ x: 100, y: 200 });

    await reply({
      element: { role: "Button", name: " Add to cart ", bounds: { x: 150, y: 300, width: 90, height: 30 } },
      container: {
        role: "ListItem",
        name: null,
        text: "Sony WH-1000XM5\r\n$328.00",
        bounds: { x: 120, y: 240, width: 450, height: 300 }
      },
      window: {
        title: "Shop",
        processName: "Microsoft Edge",
        executable: "msedge.exe",
        processId: 31,
        bounds: { x: 0, y: 0, width: 1500, height: 900 }
      }
    });

    expect(JSON.parse(written.at(-1)!)).toMatchObject({ command: "elementAtPoint", x: "150", y: "300" });
    await expect(pending).resolves.toEqual({
      source: "windows-uia",
      element: { role: "Button", name: "Add to cart", bounds: { x: 100, y: 200, width: 60, height: 20 } },
      container: {
        role: "ListItem",
        text: "Sony WH-1000XM5\r\n$328.00",
        bounds: { x: 80, y: 160, width: 300, height: 200 }
      },
      window: {
        title: "Shop",
        appName: "Microsoft Edge",
        executable: "msedge.exe",
        processId: 31,
        bounds: { x: 0, y: 0, width: 1000, height: 600 }
      }
    });
    helper.stop();
  });

  it("tolerates missing and oversized fields", async () => {
    const { helper, reply } = createFakeHelper();
    const empty = helper.getElementAtPoint({ x: 1, y: 2 });
    await reply({});
    await expect(empty).resolves.toBeUndefined();

    const partial = helper.getElementAtPoint({ x: 1, y: 2 });
    await reply({
      element: {
        role: "Document",
        text: "x".repeat(5_000),
        value: 42,
        bounds: { x: 0, y: 0, width: 0, height: 10 }
      },
      container: { name: "no role" },
      window: "not an object"
    });

    const target = await partial;
    expect(target?.element.role).toBe("Document");
    expect(target?.element.text).toHaveLength(4_000);
    expect(target?.element.value).toBeUndefined();
    expect(target?.element.bounds).toBeUndefined();
    expect(target?.container).toBeUndefined();
    expect(target?.window).toBeUndefined();
    helper.stop();
  });

  it("converts active window bounds to DIPs", async () => {
    const { helper, reply } = createFakeHelper(scale150);
    const pending = helper.getActiveWindow();

    await reply({ title: "Doc", processId: 5, bounds: { x: 300, y: 150, width: 1500, height: 900 } });

    await expect(pending).resolves.toEqual({
      title: "Doc",
      processId: 5,
      bounds: { x: 200, y: 100, width: 1000, height: 600 }
    });
    helper.stop();
  });
});
