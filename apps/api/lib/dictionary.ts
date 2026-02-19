import type { WordData } from "@shared/index";

type DictionaryApiDefinition = {
  definition?: string;
  example?: string;
};

type DictionaryApiMeaning = {
  partOfSpeech?: string;
  definitions?: DictionaryApiDefinition[];
};

type DictionaryApiPhonetic = {
  text?: string;
  audio?: string;
  sourceUrl?: string;
};

type DictionaryApiEntry = {
  word?: string;
  phonetic?: string;
  phonetics?: DictionaryApiPhonetic[];
  meanings?: DictionaryApiMeaning[];
};

const DICTIONARY_API_BASE = process.env.DICTIONARY_API_BASE || "https://api.dictionaryapi.dev/api/v2/entries/en";
const STOP_WORDS = new Set(["a", "an", "the", "to", "of", "in", "on", "for", "at", "and", "or", "with"]);

function chooseAudio(phonetics: DictionaryApiPhonetic[] | undefined, localeHint: "uk" | "us"): string | undefined {
  if (!phonetics?.length) return undefined;
  const withAudio = phonetics.filter((p) => p.audio);
  if (!withAudio.length) return undefined;

  const byHint = withAudio.find((p) => {
    const text = `${p.audio || ""} ${p.sourceUrl || ""} ${p.text || ""}`.toLowerCase();
    return localeHint === "uk" ? text.includes("uk") || text.includes("gb") : text.includes("us");
  });
  return (byHint ?? withAudio[0]).audio;
}

function choosePhonetic(phonetics: DictionaryApiPhonetic[] | undefined, fallback?: string): { uk?: string; us?: string } {
  if (!phonetics?.length) {
    return { uk: fallback, us: fallback };
  }
  const textItems = phonetics.filter((p) => p.text).map((p) => p.text as string);
  const uk = textItems.find((v) => /uk|gb/i.test(v)) ?? textItems[0] ?? fallback;
  const us = textItems.find((v) => /us/i.test(v)) ?? textItems[0] ?? fallback;
  return { uk, us };
}

function parseEntry(word: string, entry: DictionaryApiEntry): WordData {
  const phonetic = choosePhonetic(entry.phonetics, entry.phonetic);
  const definitions =
    entry.meanings
      ?.flatMap((meaning) =>
        (meaning.definitions ?? []).slice(0, 2).map((def) => ({
          partOfSpeech: meaning.partOfSpeech || "unknown",
          definition: def.definition || `${word} 的释义暂缺`,
          example: def.example
        }))
      )
      .filter((d) => d.definition) ?? [];

  const mergedDefinitions =
    definitions.length > 0
      ? definitions
      : [
          {
            partOfSpeech: "unknown",
            definition: `${word} 的释义暂缺`,
            example: `No example available for ${word}.`
          }
        ];

  return {
    word,
    phonetic,
    audio: {
      uk: chooseAudio(entry.phonetics, "uk"),
      us: chooseAudio(entry.phonetics, "us")
    },
    definitions: mergedDefinitions
  };
}

function phraseFallback(input: string): WordData {
  return {
    word: input,
    phonetic: {},
    audio: {},
    definitions: [
      {
        partOfSpeech: "phrase",
        definition: `短语“${input}”暂无词典直查结果，建议尝试查询核心单词。`,
        example: `Try searching key words from "${input}".`,
        translation: `短语“${input}”暂无直查结果，可拆分后重试。`
      }
    ]
  };
}

async function fetchDictionaryEntries(query: string): Promise<DictionaryApiEntry[] | null> {
  const response = await fetch(`${DICTIONARY_API_BASE}/${encodeURIComponent(query)}`, {
    headers: {
      Accept: "application/json"
    },
    cache: "no-store"
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as DictionaryApiEntry[];
  return Array.isArray(payload) && payload.length ? payload : null;
}

function extractPhraseCandidates(phrase: string): string[] {
  const tokens = phrase
    .split(/[\s\-_/]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[a-z]+$/.test(t) && t.length > 2 && !STOP_WORDS.has(t));
  return [...new Set(tokens)].sort((a, b) => b.length - a.length);
}

async function resolvePhrase(phrase: string): Promise<WordData> {
  const candidates = extractPhraseCandidates(phrase);
  for (const candidate of candidates) {
    const payload = await fetchDictionaryEntries(candidate);
    if (!payload) continue;
    const base = parseEntry(candidate, payload[0]);
    return {
      ...base,
      word: phrase,
      definitions: [
        {
          partOfSpeech: "phrase",
          definition: `短语“${phrase}”未直接命中，以下为关键词 “${candidate}” 的释义。`,
          example: `Core-word fallback: ${candidate}`,
          translation: `短语改为关键词 ${candidate} 的解释结果。`
        },
        ...base.definitions
      ]
    };
  }
  return phraseFallback(phrase);
}

export async function queryDictionary(word: string): Promise<WordData> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) {
    return phraseFallback(word);
  }

  try {
    const payload = await fetchDictionaryEntries(normalized);
    if (payload?.length) {
      return parseEntry(normalized, payload[0]);
    }
    if (/\s/.test(normalized)) {
      return resolvePhrase(normalized);
    }
    return phraseFallback(normalized);
  } catch {
    return {
      word: normalized,
      phonetic: {},
      audio: {},
      definitions: [
        {
          partOfSpeech: "unknown",
          definition: "词典服务暂时不可用，请稍后重试。",
          example: `Try again later for "${normalized}".`,
          translation: "词典服务暂时不可用，请稍后重试。"
        }
      ]
    };
  }
}
