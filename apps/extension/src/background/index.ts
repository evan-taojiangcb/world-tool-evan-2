import type { CollectionSyncPayload, WordData } from "@shared/index";
import { STORAGE_KEYS } from "../shared/constants";
import { DEFAULT_SETTINGS, normalizeSettings, type PronunciationSettings } from "../shared/settings";
import type { RuntimeMessage, RuntimeResponse } from "../types/messages";
import {
  LOOKUP_CACHE_KEY,
  normalizeLookupKey,
  pruneLookupCache,
  type LookupCacheMap
} from "./lookup-cache";

const API_BASE = import.meta.env.VITE_WORD_TOOL_API_BASE ?? "http://localhost:3000";
const REVIEW_QUEUE_KEY = "review_queue";
const sentenceZhCache = new Map<string, string>();
const morphologyPronCache = new Map<string, string>();
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

function extractPhraseCandidates(phrase: string): string[] {
  const tokens = phrase
    .split(/[\s\-_/]+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[a-z]+$/.test(t) && t.length > 2 && !STOP_WORDS.has(t));
  return [...new Set(tokens)].sort((a, b) => b.length - a.length);
}

async function fetchDatamusePronunciation(word: string): Promise<string | undefined> {
  const key = word.trim().toLowerCase();
  if (!key) return undefined;
  const cached = morphologyPronCache.get(key);
  if (cached) return cached;
  try {
    const response = await fetch(`https://api.datamuse.com/words?sp=${encodeURIComponent(key)}&md=r&max=1`);
    if (!response.ok) return undefined;
    const data = (await response.json()) as Array<{ tags?: string[] }>;
    const tag = data[0]?.tags?.find((t) => t.startsWith("pron:"));
    const pron = tag ? tag.replace("pron:", "") : undefined;
    if (pron) morphologyPronCache.set(key, pron);
    return pron;
  } catch {
    return undefined;
  }
}

async function translateToZh(text: string): Promise<string | undefined> {
  const input = text?.trim();
  if (!input) return undefined;

  const tryMyMemory = async (): Promise<string | undefined> => {
    const params = new URLSearchParams({
      q: input,
      langpair: "en|zh-CN"
    });
    const response = await fetch(`https://api.mymemory.translated.net/get?${params.toString()}`);
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
    const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`);
    if (!response.ok) return undefined;
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data) || !Array.isArray(data[0])) return undefined;
    const segments = data[0] as unknown[];
    const out = segments
      .map((item) => (Array.isArray(item) && typeof item[0] === "string" ? item[0] : ""))
      .join("")
      .trim();
    return out || undefined;
  };

  for (const provider of [tryMyMemory, tryGoogleGtx]) {
    try {
      const candidate = sanitizeZhTranslation(await provider(), input);
      if (candidate) return candidate;
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

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("word-tool-sync", { periodInMinutes: 10 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "word-tool-sync") return;
  const username = await getUsername();
  if (!username) return;
  await syncCollections(username).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then((data) => sendResponse({ ok: true, data } satisfies RuntimeResponse))
    .catch((error: Error) => sendResponse({ ok: false, error: error.message } satisfies RuntimeResponse));
  return true;
});

async function handleMessage(message: RuntimeMessage): Promise<unknown> {
  switch (message.type) {
    case "LOOKUP_WORD":
      return lookupWord(message.payload.text, message.payload.contextSentence);
    case "GET_COLLECTIONS":
      return getCollections();
    case "UPSERT_COLLECTION":
      return upsertCollection(message.payload.data);
    case "DELETE_COLLECTION":
      return deleteCollection(message.payload.word);
    case "GET_USERNAME":
      return getUsername();
    case "SET_USERNAME":
      await setUsername(message.payload.username);
      return true;
    case "ADD_REVIEW_QUEUE":
      return addReviewQueue(message.payload.word);
    case "GET_REVIEW_QUEUE":
      return getReviewQueue();
    case "DELETE_REVIEW_QUEUE":
      return deleteReviewQueue(message.payload.word);
    case "CLEAR_REVIEW_QUEUE":
      return clearReviewQueue();
    case "GET_SETTINGS":
      return getSettings();
    case "SET_SETTINGS":
      return setSettings(message.payload.settings);
    default:
      return null;
  }
}

async function lookupWord(text: string, contextSentence?: string): Promise<WordData> {
  const queryKey = normalizeLookupKey(text);
  if (!queryKey) throw new Error("Lookup failed");
  const cached = await getCachedWord(queryKey);
  if (cached) {
    const enrichedCached = await ensureMorphologyPhonetics(await ensureZhTranslation(cached, queryKey));
    const withContext = await applyContextInfo(enrichedCached, contextSentence, { translateSentence: true });
    if (withContext !== cached) {
      await setCachedWord(queryKey, withContext);
    }
    return withContext;
  }

  const username = await getUsername();
  const params = new URLSearchParams({ word: queryKey });
  try {
    const response = await fetch(`${API_BASE}/api/word?${params.toString()}`, {
      headers: username ? { "X-Username": username } : undefined
    });
    if (response.ok) {
      const data = (await response.json()) as WordData;
      const enriched = await ensureMorphologyPhonetics(await ensureZhTranslation(data, queryKey));
      const withContext = await applyContextInfo(enriched, contextSentence, { translateSentence: true });
      await setCachedWord(queryKey, withContext);
      return withContext;
    }
  } catch {
    // Fall through to public dictionary API.
  }

  const payload = await fetchDictionaryPayload(queryKey);
  if (!payload) {
    if (/\s/.test(queryKey)) {
      const phraseResult = await resolvePhraseFallback(queryKey);
      const enrichedPhrase = await ensureMorphologyPhonetics(await ensureZhTranslation(phraseResult, queryKey));
      const withContext = await applyContextInfo(enrichedPhrase, contextSentence, { translateSentence: true });
      await setCachedWord(queryKey, withContext);
      return withContext;
    }
    throw new Error("Lookup failed");
  }

  const first = payload[0];
  if (!first) throw new Error("Lookup failed");
  const result = await mapDictionaryEntryToWordData(first, text, queryKey);
  const withContext = await applyContextInfo(result, contextSentence, { translateSentence: true });
  await setCachedWord(queryKey, withContext);
  return withContext;
}

async function fetchDictionaryPayload(query: string): Promise<
  | Array<{
      word?: string;
      phonetic?: string;
      phonetics?: Array<{ text?: string; audio?: string }>;
      meanings?: Array<{
        partOfSpeech?: string;
        definitions?: Array<{ definition?: string; example?: string }>;
      }>;
    }>
  | null
> {
  const fallback = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(query)}`);
  if (!fallback.ok) return null;
  return (await fallback.json()) as Array<{
    word?: string;
    phonetic?: string;
    phonetics?: Array<{ text?: string; audio?: string }>;
    meanings?: Array<{
      partOfSpeech?: string;
      definitions?: Array<{ definition?: string; example?: string }>;
    }>;
  }>;
}

async function mapDictionaryEntryToWordData(
  first: {
    word?: string;
    phonetic?: string;
    phonetics?: Array<{ text?: string; audio?: string }>;
    meanings?: Array<{
      partOfSpeech?: string;
      definitions?: Array<{ definition?: string; example?: string }>;
    }>;
  },
  text: string,
  queryKey: string
): Promise<WordData> {
  const phonetics = first.phonetics ?? [];
  const getPhonetic = (key: "uk" | "us"): string | undefined =>
    phonetics.find((p) => (p.text || "").toLowerCase().includes(key))?.text ??
    phonetics.find((p) => p.text)?.text ??
    first.phonetic;
  const getAudio = (key: "uk" | "us"): string | undefined =>
    normalizeAudioUrl(
      phonetics.find((p) => (p.audio || "").toLowerCase().includes(key))?.audio ?? phonetics.find((p) => p.audio)?.audio
    );

  const definitions =
    first.meanings?.flatMap((meaning) =>
      (meaning.definitions ?? []).slice(0, 2).map((d) => ({
        partOfSpeech: meaning.partOfSpeech || "unknown",
        definition: d.definition || "No definition",
        example: d.example
      }))
    ) ?? [];

  const translatedDefinitions = await Promise.all(
    definitions.map(async (item) => ({
      ...item,
      translation: await translateToZh(item.definition),
      exampleTranslation: item.example ? await translateToZh(item.example) : undefined
    }))
  );

  const uk = getPhonetic("uk");
  const us = getPhonetic("us");
  const pronFallback = !uk && !us ? await fetchDatamusePronunciation(first.word || queryKey) : undefined;

  const morphology = deriveMorphology(first.word || queryKey);
  const result: WordData = {
    word: first.word || text.trim().toLowerCase(),
    translationZh:
      (await translateToZh(first.word || text.trim().toLowerCase())) ??
      translatedDefinitions.find((item) => item.translation)?.translation,
    phonetic: {
      uk: uk ?? pronFallback,
      us: us ?? pronFallback
    },
    audio: {
      uk: getAudio("uk"),
      us: getAudio("us")
    },
    definitions: translatedDefinitions.length
      ? translatedDefinitions
      : [
          {
            partOfSpeech: "unknown",
            definition: "No definition found.",
            translation: "未查询到释义。"
          }
        ],
    morphology,
    morphologyPhonetics: await buildMorphologyPhonetics(morphology)
  };
  return result;
}

async function resolvePhraseFallback(phrase: string): Promise<WordData> {
  const candidates = extractPhraseCandidates(phrase);
  for (const candidate of candidates) {
    const payload = await fetchDictionaryPayload(candidate);
    if (!payload?.length) continue;
    const base = await mapDictionaryEntryToWordData(payload[0], candidate, candidate);
    return {
      ...base,
      word: phrase,
      translationZh: (await translateToZh(phrase)) ?? base.translationZh,
      definitions: [
        {
          partOfSpeech: "phrase",
          definition: `短语“${phrase}”未直接命中，当前展示关键词“${candidate}”的结果。`,
          translation: `短语“${phrase}”暂无直查结果，已回退到关键词“${candidate}”。`,
          example: base.definitions[0]?.example,
          exampleTranslation: base.definitions[0]?.exampleTranslation
        },
        ...base.definitions
      ],
      morphology: base.morphology,
      morphologyPhonetics: base.morphologyPhonetics
    };
  }
  const morphology = phrase
    .split(/\s+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return {
    word: phrase,
    translationZh: (await translateToZh(phrase)) ?? `短语“${phrase}”暂无稳定翻译。`,
    phonetic: {},
    audio: {},
    definitions: [
      {
        partOfSpeech: "phrase",
        definition: `短语“${phrase}”查询失败，建议改查关键单词。`,
        translation: `短语“${phrase}”暂未查到，可尝试拆分后查询。`
      }
    ],
    morphology,
    morphologyPhonetics: await buildMorphologyPhonetics(morphology)
  };
}

async function ensureZhTranslation(data: WordData, fallbackWord: string): Promise<WordData> {
  let definitionChanged = false;
  const definitions = await Promise.all(
    data.definitions.map(async (item) => {
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

  const currentWordZh = data.translationZh?.trim();
  if (currentWordZh && hasCjk(currentWordZh)) {
    return definitionChanged ? { ...data, definitions } : data;
  }

  const translationZh = (await translateToZh(data.word || fallbackWord)) ?? definitions.find((item) => item.translation && hasCjk(item.translation))?.translation;
  if (!translationZh && !definitionChanged) return data;
  return {
    ...data,
    definitions,
    translationZh: translationZh ?? data.translationZh
  };
}

async function ensureMorphologyPhonetics(data: WordData): Promise<WordData> {
  if (!data.morphology?.length) return data;
  if (data.morphologyPhonetics && Object.keys(data.morphologyPhonetics).length) return data;
  const morphologyPhonetics = await buildMorphologyPhonetics(data.morphology);
  if (!morphologyPhonetics) return data;
  return { ...data, morphologyPhonetics };
}

function normalizeSentence(input?: string): string | undefined {
  const cleaned = input?.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, 260);
}

async function applyContextInfo(
  data: WordData,
  contextSentence?: string,
  options?: { translateSentence?: boolean }
): Promise<WordData> {
  const sentence = normalizeSentence(contextSentence);
  if (!sentence) {
    if (!data.contextSentence && !data.contextSentenceZh && !data.contextExplanationZh) return data;
    const { contextSentence: _c1, contextSentenceZh: _c2, contextExplanationZh: _c3, ...rest } = data;
    return rest;
  }
  const shouldTranslateSentence = options?.translateSentence ?? false;
  const sentenceZh = shouldTranslateSentence ? await translateSentenceWithCache(sentence) : undefined;
  const meaning =
    data.translationZh ??
    data.definitions.find((item) => item.translation && hasCjk(item.translation))?.translation ??
    data.definitions[0]?.definition ??
    "当前语义";
  const contextExplanationZh = sentenceZh
    ? `在当前句子中，“${data.word}”表示“${meaning}”。整句可理解为：${sentenceZh}`
    : `在当前句子中，“${data.word}”表示“${meaning}”。`;
  return {
    ...data,
    contextSentence: sentence,
    contextSentenceZh: sentenceZh,
    contextExplanationZh
  };
}

async function translateSentenceWithCache(sentence: string): Promise<string | undefined> {
  const cached = sentenceZhCache.get(sentence);
  if (cached) return cached;
  const translated = await translateToZh(sentence);
  if (translated) sentenceZhCache.set(sentence, translated);
  return translated;
}

async function getCollections(): Promise<Record<string, WordData>> {
  const { collections = {} } = await chrome.storage.local.get("collections");
  return collections as Record<string, WordData>;
}

async function upsertCollection(data: WordData): Promise<void> {
  const current = await getCollections();
  current[data.word.toLowerCase()] = { ...data, collectedAt: Date.now() };
  await chrome.storage.local.set({ collections: current });
}

async function deleteCollection(word: string): Promise<void> {
  const current = await getCollections();
  delete current[word.toLowerCase()];
  await chrome.storage.local.set({ collections: current });
}

async function getUsername(): Promise<string | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.USERNAME);
  const value = result[STORAGE_KEYS.USERNAME];
  return typeof value === "string" ? value : null;
}

async function setUsername(username: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.USERNAME]: username.trim() });
}

async function getReviewQueue(): Promise<Array<{ word: string; addedAt: number }>> {
  const result = await chrome.storage.local.get(REVIEW_QUEUE_KEY);
  const queue = result[REVIEW_QUEUE_KEY];
  return Array.isArray(queue) ? queue : [];
}

async function addReviewQueue(word: string): Promise<{ queued: boolean }> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return { queued: false };
  const queue = await getReviewQueue();
  if (queue.some((q) => q.word === normalized)) return { queued: false };
  queue.unshift({ word: normalized, addedAt: Date.now() });
  await chrome.storage.local.set({ [REVIEW_QUEUE_KEY]: queue.slice(0, 500) });
  return { queued: true };
}

async function deleteReviewQueue(word: string): Promise<void> {
  const normalized = word.trim().toLowerCase();
  if (!normalized) return;
  const queue = await getReviewQueue();
  const next = queue.filter((item) => item.word !== normalized);
  await chrome.storage.local.set({ [REVIEW_QUEUE_KEY]: next });
}

async function clearReviewQueue(): Promise<void> {
  await chrome.storage.local.set({ [REVIEW_QUEUE_KEY]: [] });
}

async function getLookupCache(): Promise<LookupCacheMap> {
  const result = await chrome.storage.local.get(LOOKUP_CACHE_KEY);
  const raw = result[LOOKUP_CACHE_KEY];
  return raw && typeof raw === "object" ? (raw as LookupCacheMap) : {};
}

async function getCachedWord(queryKey: string): Promise<WordData | null> {
  const cache = await getLookupCache();
  const entry = cache[queryKey];
  return entry?.data ?? null;
}

async function setCachedWord(queryKey: string, data: WordData): Promise<void> {
  const cache = await getLookupCache();
  const now = Date.now();
  const stored = stripContextFields(data);
  cache[queryKey] = { data: stored, cachedAt: now };
  const canonicalKey = normalizeLookupKey(stored.word);
  if (canonicalKey && canonicalKey !== queryKey) {
    cache[canonicalKey] = { data: stored, cachedAt: now };
  }
  const next = pruneLookupCache(cache);
  await chrome.storage.local.set({ [LOOKUP_CACHE_KEY]: next });
}

function stripContextFields(data: WordData): WordData {
  const { contextSentence: _c1, contextSentenceZh: _c2, contextExplanationZh: _c3, ...rest } = data;
  return rest;
}

async function buildMorphologyPhonetics(parts?: string[]): Promise<Record<string, { uk?: string; us?: string }> | undefined> {
  if (!parts?.length) return undefined;
  const entries = await Promise.all(
    parts.map(async (part) => {
      const pron = await fetchDatamusePronunciation(part);
      if (!pron) return null;
      return [part, { uk: pron, us: pron }] as const;
    })
  );
  const map = Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, { uk?: string; us?: string }]>);
  return Object.keys(map).length ? map : undefined;
}

async function getSettings(): Promise<PronunciationSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return normalizeSettings(result[STORAGE_KEYS.SETTINGS]);
}

async function setSettings(settingsPatch: Partial<PronunciationSettings>): Promise<PronunciationSettings> {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...settingsPatch });
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: next });
  return next;
}

async function syncCollections(username: string): Promise<void> {
  const collections = await getCollections();
  const words = Object.values(collections).map((data) => ({
    word: data.word.toLowerCase(),
    data,
    collectedAt: data.collectedAt ?? Date.now()
  }));
  const payload: CollectionSyncPayload = { words };
  const response = await fetch(`${API_BASE}/api/collections`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Username": username
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Sync failed");
  const latest = (await response.json()) as Record<string, WordData>;
  await chrome.storage.local.set({ collections: latest });
}
