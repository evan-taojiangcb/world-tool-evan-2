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
const COMMON_PREFIXES = ["anti", "inter", "trans", "super", "under", "over", "pre", "post", "re", "un", "dis", "im", "in"];
const COMMON_SUFFIXES = ["ization", "ation", "ment", "ness", "less", "able", "ible", "tion", "sion", "ity", "ism", "ist", "ous", "ive", "al", "er", "or", "ly", "ed", "ing", "es", "s"];

function normalizeAudioUrl(url?: string): string | undefined {
  if (!url) return undefined;
  return url.startsWith("http://") ? url.replace("http://", "https://") : url;
}

function deriveMorphology(word: string): string[] {
  const clean = word.toLowerCase().replace(/[^a-z]/g, "");
  if (clean.length < 5) return [clean];
  const prefix = COMMON_PREFIXES.find((p) => clean.startsWith(p) && clean.length - p.length >= 3);
  const suffix = COMMON_SUFFIXES.find((s) => clean.endsWith(s) && clean.length - s.length >= 3);
  const coreStart = prefix ? prefix.length : 0;
  const coreEnd = suffix ? clean.length - suffix.length : clean.length;
  const core = clean.slice(coreStart, coreEnd);
  const parts = [prefix, core, suffix].filter(Boolean) as string[];
  return parts.length ? parts : [clean];
}

async function fetchDatamusePronunciation(word: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(word)}&md=r&max=1`, { cache: "no-store" });
    if (!response.ok) return undefined;
    const data = (await response.json()) as Array<{ tags?: string[] }>;
    const tag = data[0]?.tags?.find((t) => t.startsWith("pron:"));
    return tag ? tag.replace("pron:", "") : undefined;
  } catch {
    return undefined;
  }
}

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

async function parseEntry(word: string, entry: DictionaryApiEntry): Promise<WordData> {
  const rawPhonetic = choosePhonetic(entry.phonetics, entry.phonetic);
  const pronFallback = !rawPhonetic.uk && !rawPhonetic.us ? await fetchDatamusePronunciation(word) : undefined;
  const phonetic = {
    uk: rawPhonetic.uk ?? pronFallback,
    us: rawPhonetic.us ?? pronFallback
  };
  const definitions =
    entry.meanings
      ?.flatMap((meaning) =>
        (meaning.definitions ?? []).slice(0, 2).map((def) => ({
          partOfSpeech: meaning.partOfSpeech || "unknown",
          definition: def.definition || `${word} 的释义暂缺`,
          example: def.example,
          exampleTranslation: undefined
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
      uk: normalizeAudioUrl(chooseAudio(entry.phonetics, "uk")),
      us: normalizeAudioUrl(chooseAudio(entry.phonetics, "us"))
    },
    definitions: mergedDefinitions,
    translationZh: undefined,
    morphology: deriveMorphology(word)
  };
}

function phraseFallback(input: string): WordData {
  return {
    word: input,
    translationZh: `短语“${input}”暂无稳定直译，请结合上下文理解。`,
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

async function translateToZh(text: string): Promise<string | undefined> {
  const input = text?.trim();
  if (!input) return undefined;

  const tryMyMemory = async (): Promise<string | undefined> => {
    const params = new URLSearchParams({
      q: input,
      langpair: "en|zh-CN"
    });
    const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return undefined;
    const data = (await response.json()) as { responseData?: { translatedText?: string } };
    return data.responseData?.translatedText;
  };

  const tryGoogleGtx = async (): Promise<string | undefined> => {
    const params = new URLSearchParams({
      client: "gtx",
      sl: "en",
      tl: "zh-CN",
      dt: "t",
      q: input
    });
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, { cache: "no-store" });
    if (!response.ok) return undefined;
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return undefined;
    const out = (data[0] as unknown[])
      .map((item) => (Array.isArray(item) && typeof item[0] === "string" ? item[0] : ""))
      .join("")
      .trim();
    return out || undefined;
  };

  for (const provider of [tryMyMemory, tryGoogleGtx]) {
    try {
      const translated = sanitizeZhTranslation(await provider(), input);
      if (translated) return translated;
    } catch {
      // Try next provider.
    }
  }
  return undefined;
}

function sanitizeZhTranslation(value: string | undefined, source: string): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.toLowerCase() === source.trim().toLowerCase()) return undefined;
  if (!hasCjk(text)) return undefined;
  return text;
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

async function enrichZh(base: WordData, fallbackWord: string): Promise<WordData> {
  let definitionChanged = false;
  const definitions = await Promise.all(
    base.definitions.map(async (item) => {
      const translatedDef = item.translation && hasCjk(item.translation) ? item.translation : await translateToZh(item.definition);
      const translatedExample =
        item.exampleTranslation && hasCjk(item.exampleTranslation)
          ? item.exampleTranslation
          : item.example
            ? await translateToZh(item.example)
            : undefined;
      const next = {
        ...item,
        translation: translatedDef ?? item.translation,
        exampleTranslation: translatedExample ?? item.exampleTranslation
      };
      if (next.translation !== item.translation || next.exampleTranslation !== item.exampleTranslation) {
        definitionChanged = true;
      }
      return next;
    })
  );

  const current = base.translationZh?.trim();
  const translationZh =
    current && hasCjk(current)
      ? current
      : (await translateToZh(base.word || fallbackWord)) ??
        definitions.find((item) => item.translation && hasCjk(item.translation))?.translation;

  if (!definitionChanged && translationZh === base.translationZh) return base;
  return {
    ...base,
    definitions,
    translationZh
  };
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
    const base = await parseEntry(candidate, payload[0]);
    const translated = await enrichZh(base, phrase);
    return {
      ...base,
      word: phrase,
      translationZh: translated.translationZh ?? (await translateToZh(phrase)),
      definitions: [
        {
          partOfSpeech: "phrase",
          definition: `短语“${phrase}”未直接命中，以下为关键词 “${candidate}” 的释义。`,
          example: `Core-word fallback: ${candidate}`,
          translation: `短语改为关键词 ${candidate} 的解释结果。`
        },
        ...translated.definitions
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
      const base = await parseEntry(normalized, payload[0]);
      return enrichZh(base, normalized);
    }
    if (/\s/.test(normalized)) {
      return resolvePhrase(normalized);
    }
    return phraseFallback(normalized);
  } catch {
    return {
      word: normalized,
      translationZh: undefined,
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
