import { describe, expect, it } from "vitest";
import { getLensActionQuestion, type LensObject } from "../src/renderer/src/lib/lensObject";
import type { LensMemory } from "../src/renderer/src/state/useMauzStore";

const mockLensObject: LensObject = {
  id: "selected-text:2024-01-01T00:00:00.000Z:100:200",
  type: "selected-text",
  label: "Selected text in VS Code",
  summary: "A short snippet of code.",
  confidence: 96,
  privacyMode: "Selected text + cursor crop",
  suggestedActions: ["explain", "transform", "remember", "compare"]
};

const mockPinned: LensMemory = {
  id: "pinned:1234567890",
  label: "Terminal output",
  type: "cursor-area",
  summary: "A build error log.",
  createdAt: "2024-01-01T00:00:00.000Z"
};

describe("getLensActionQuestion – pin injection scoped to compare only", () => {
  it("does NOT inject pinned object for explain default prompt", () => {
    const result = getLensActionQuestion("explain", mockLensObject, mockPinned, "");
    expect(result).not.toContain("Pinned");
    expect(result).not.toContain(mockPinned.label);
  });

  it("does NOT inject pinned object for transform default prompt", () => {
    const result = getLensActionQuestion("transform", mockLensObject, mockPinned, "");
    expect(result).not.toContain("Pinned");
    expect(result).not.toContain(mockPinned.label);
  });

  it("does NOT inject pinned object for ask default prompt", () => {
    const result = getLensActionQuestion("ask", mockLensObject, mockPinned, "");
    expect(result).not.toContain("Pinned");
    expect(result).not.toContain(mockPinned.label);
  });

  it("does NOT inject pinned object for explain with a custom question", () => {
    const result = getLensActionQuestion("explain", mockLensObject, mockPinned, "Simplify this");
    expect(result).toBe("Simplify this");
    expect(result).not.toContain("Pinned");
  });

  it("does NOT inject pinned object for transform with a custom question", () => {
    const result = getLensActionQuestion("transform", mockLensObject, mockPinned, "Convert to JSON");
    expect(result).toBe("Convert to JSON");
  });

  it("does NOT inject pinned object for ask with a custom question", () => {
    const result = getLensActionQuestion("ask", mockLensObject, mockPinned, "What is this?");
    expect(result).toBe("What is this?");
  });

  it("DOES inject pinned object for compare with a custom question", () => {
    const result = getLensActionQuestion("compare", mockLensObject, mockPinned, "How do these differ?");
    expect(result).toContain("How do these differ?");
    expect(result).toContain(mockPinned.label);
  });

  it("DOES inject pinned object for compare default prompt when pinned exists", () => {
    const result = getLensActionQuestion("compare", mockLensObject, mockPinned, "");
    expect(result).toContain(mockPinned.label);
    expect(result).toContain(mockPinned.summary);
  });

  it("returns a standalone compare prompt when nothing is pinned", () => {
    const result = getLensActionQuestion("compare", mockLensObject, null, "");
    expect(result).not.toContain("Pinned");
    expect(result).toContain("compare");
  });
});
