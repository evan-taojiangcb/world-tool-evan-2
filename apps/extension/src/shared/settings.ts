export type PronunciationSettings = {
  morphologyAccent: "uk" | "us";
};

export const DEFAULT_SETTINGS: PronunciationSettings = {
  morphologyAccent: "uk"
};

export function normalizeSettings(input: unknown): PronunciationSettings {
  if (!input || typeof input !== "object") return DEFAULT_SETTINGS;
  const candidate = input as Partial<PronunciationSettings>;
  return {
    morphologyAccent: candidate.morphologyAccent === "us" ? "us" : "uk"
  };
}
