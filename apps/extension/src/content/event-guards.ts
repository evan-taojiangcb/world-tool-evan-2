type HostLike = EventTarget & {
  contains: (node: Node | null) => boolean;
};

function safeHostContains(host: HostLike, node: unknown): boolean {
  try {
    return host.contains(node as Node | null);
  } catch {
    return false;
  }
}

export function isEventInsideExtensionRoot(event: Event, host: HostLike, rootSelector = "#word-tool-evan-root"): boolean {
  const target = (event as Event & { target?: unknown }).target;
  if (target && safeHostContains(host, target)) return true;

  const path: EventTarget[] =
    typeof (event as Event & { composedPath?: () => unknown[] }).composedPath === "function"
      ? (event as Event & { composedPath: () => unknown[] }).composedPath()
      : [];

  return path.some((node) => {
    if (node === host) return true;
    if (safeHostContains(host, node)) return true;
    return typeof (node as { closest?: (selector: string) => unknown })?.closest === "function"
      ? Boolean((node as unknown as { closest: (selector: string) => unknown }).closest(rootSelector))
      : false;
  });
}

export function shouldIgnoreSelectionSample(now: number, suppressUntil: number, activeElement: Element | null, host: HostLike): boolean {
  if (now < suppressUntil) return true;
  return Boolean(activeElement && safeHostContains(host, activeElement));
}

export function shouldPreserveSelectionClick(now: number, suppressUntil: number, isInsideExtensionRoot: boolean): boolean {
  return now < suppressUntil && !isInsideExtensionRoot;
}

export function getFloatingButtonRevealDelay(trigger: "drag" | "dblclick"): number {
  return trigger === "drag" ? 140 : 0;
}

export function shouldShowFloatingButton(now: number, revealAt: number): boolean {
  return now >= revealAt;
}
