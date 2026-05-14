import { describe, expect, it } from "vitest";
import { parseFormattedAnswer } from "../src/renderer/src/lib/formatAnswer";

describe("parseFormattedAnswer", () => {
  it("turns markdown-ish answers into readable blocks", () => {
    expect(
      parseFormattedAnswer(
        [
          "## Fix",
          "",
          "Use the selected error first.",
          "",
          "- Check imports",
          "- Restart dev server",
          "",
          "```ts",
          "const ok = true;",
          "```"
        ].join("\n")
      )
    ).toEqual([
      {
        type: "heading",
        level: 2,
        text: "Fix"
      },
      {
        type: "paragraph",
        text: "Use the selected error first."
      },
      {
        type: "list",
        ordered: false,
        items: ["Check imports", "Restart dev server"]
      },
      {
        type: "code",
        language: "ts",
        code: "const ok = true;"
      }
    ]);
  });
});
