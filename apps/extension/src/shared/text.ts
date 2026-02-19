export function normalizeSelectedText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function isValidLookupText(text: string): boolean {
  if (!text) return false;
  if (text.length > 100) return false;
  if (!/[A-Za-z]/.test(text)) return false;
  if (/^[\d\W_]+$/.test(text)) return false;
  return true;
}

export function toWordPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b(${escaped})\\b`, "gi");
}
