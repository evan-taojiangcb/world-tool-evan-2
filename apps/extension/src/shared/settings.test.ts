import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

describe("settings helpers", () => {
  it("returns defaults for invalid input", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("x")).toEqual(DEFAULT_SETTINGS);
  });

  it("merges partial settings with defaults", () => {
    expect(normalizeSettings({ morphologyAccent: "us" })).toEqual({
      morphologyAccent: "us"
    });
  });
});
