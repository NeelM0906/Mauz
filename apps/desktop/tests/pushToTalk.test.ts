import { describe, expect, it } from "vitest";
import { encodeWav, takeCompleteSentences, toSpeakableText } from "../src/renderer/src/lib/pushToTalk";

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM WAV header and clamps samples", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 16_000);
    const view = new DataView(wav);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...new Uint8Array(wav, offset, length));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff);
  });
});

describe("takeCompleteSentences", () => {
  it("returns finished sentences and keeps the unfinished tail for later", () => {
    expect(takeCompleteSentences("It is a chart. It shows sales", 0)).toEqual({
      text: "It is a chart.",
      nextIndex: 14
    });
  });

  it("continues from the previous index", () => {
    const text = "First one. Second one! Third";

    expect(takeCompleteSentences(text, 10)).toEqual({ text: "Second one!", nextIndex: 22 });
  });

  it("does not split decimals", () => {
    expect(takeCompleteSentences("Version 3.5 is out", 0)).toEqual({ text: "", nextIndex: 0 });
  });
});

describe("toSpeakableText", () => {
  it("removes Markdown that would be read literally", () => {
    expect(toSpeakableText("## Steps\n- Click **Save** in `File`\n- See [docs](https://x.y)")).toBe(
      "Steps Click Save in File See docs"
    );
  });
});
