import { describe, expect, it } from "vitest";
import { isEventInsideExtensionRoot, shouldIgnoreSelectionSample } from "./event-guards";

function createHost(insideNodes: unknown[] = []): EventTarget & { contains: (node: Node | null) => boolean } {
  const host = new EventTarget() as EventTarget & { contains: (node: Node | null) => boolean };
  host.contains = (node: Node | null) => insideNodes.includes(node);
  return host;
}

describe("event guards", () => {
  it("detects event target inside extension host", () => {
    const insideTarget = { id: "audio-btn" };
    const host = createHost([insideTarget]);
    const event = {
      target: insideTarget,
      composedPath: () => [insideTarget]
    } as unknown as Event;

    expect(isEventInsideExtensionRoot(event, host)).toBe(true);
  });

  it("detects event path node inside extension root", () => {
    const pathNode = {
      closest: (selector: string) => (selector === "#word-tool-evan-root" ? {} : null)
    };
    const host = createHost();
    const event = {
      target: { id: "outside" },
      composedPath: () => [pathNode]
    } as unknown as Event;

    expect(isEventInsideExtensionRoot(event, host)).toBe(true);
  });

  it("does not mark outside click as inside", () => {
    const host = createHost();
    const event = {
      target: { id: "outside" },
      composedPath: () => [{ id: "outside" }, { id: "document" }]
    } as unknown as Event;

    expect(isEventInsideExtensionRoot(event, host)).toBe(false);
  });

  it("suppresses selection sampling during internal interaction window", () => {
    const host = createHost();
    expect(shouldIgnoreSelectionSample(2000, 2100, null, host)).toBe(true);
  });

  it("suppresses selection sampling when active element is inside host", () => {
    const activeElement = { id: "audio-btn" } as unknown as Element;
    const host = createHost([activeElement]);
    expect(shouldIgnoreSelectionSample(2200, 2100, activeElement, host)).toBe(true);
  });
});
