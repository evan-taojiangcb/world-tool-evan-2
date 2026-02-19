import { MARK_ATTR } from "./constants";
import { toWordPattern } from "./text";

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEXTAREA",
  "INPUT",
  "SELECT",
  "OPTION",
  "CODE",
  "PRE"
]);

function canProcessTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent) return false;
  if (SKIP_TAGS.has(parent.tagName)) return false;
  if (parent.closest(`[${MARK_ATTR}]`)) return false;
  const style = window.getComputedStyle(parent);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return true;
}

export function clearHighlights(root: ParentNode = document): void {
  const marks = root.querySelectorAll<HTMLElement>(`[${MARK_ATTR}]`);
  marks.forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    const textNode = document.createTextNode(mark.textContent ?? "");
    parent.replaceChild(textNode, mark);
    parent.normalize();
  });
}

export function highlightWords(words: string[], onClick: (word: string, rect: DOMRect) => void): void {
  if (!words.length) return;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (canProcessTextNode(node) && node.textContent?.trim()) {
      nodes.push(node);
    }
  }

  const patterns = words.map((word) => ({ word, pattern: toWordPattern(word) }));

  nodes.forEach((node) => {
    const content = node.textContent ?? "";
    let matched = false;
    patterns.forEach(({ pattern }) => {
      if (pattern.test(content)) matched = true;
      pattern.lastIndex = 0;
    });
    if (!matched) return;

    const fragment = document.createDocumentFragment();
    let cursor = 0;
    const matches: Array<{ start: number; end: number; word: string }> = [];

    patterns.forEach(({ word, pattern }) => {
      let m: RegExpExecArray | null;
      while ((m = pattern.exec(content)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, word: m[0] || word });
      }
    });

    matches.sort((a, b) => a.start - b.start);
    const filtered: Array<{ start: number; end: number; word: string }> = [];
    matches.forEach((item) => {
      const prev = filtered[filtered.length - 1];
      if (!prev || item.start >= prev.end) filtered.push(item);
    });

    filtered.forEach((m) => {
      if (m.start > cursor) {
        fragment.append(document.createTextNode(content.slice(cursor, m.start)));
      }
      const mark = document.createElement("mark");
      mark.textContent = content.slice(m.start, m.end);
      mark.setAttribute(MARK_ATTR, "1");
      mark.dataset.word = m.word.toLowerCase();
      mark.className = "word-tool-highlight";
      mark.addEventListener("click", (event) => {
        event.stopPropagation();
        const rect = mark.getBoundingClientRect();
        onClick(mark.dataset.word || m.word.toLowerCase(), rect);
      });
      fragment.append(mark);
      cursor = m.end;
    });

    if (cursor < content.length) {
      fragment.append(document.createTextNode(content.slice(cursor)));
    }

    node.parentNode?.replaceChild(fragment, node);
  });
}
