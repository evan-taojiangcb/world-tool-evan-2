import { describe, expect, it } from "vitest";
import { isValidLookupText, normalizeSelectedText } from "./text";

describe("text helpers", () => {
  it("normalizes spaces", () => {
    expect(normalizeSelectedText("  good   morning  ")).toBe("good morning");
  });

  it("validates lookup text", () => {
    expect(isValidLookupText("apple")).toBe(true);
    expect(isValidLookupText("12345")).toBe(false);
    expect(isValidLookupText("!!!")).toBe(false);
  });
});
