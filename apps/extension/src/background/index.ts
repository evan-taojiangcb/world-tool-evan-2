import type { CollectionSyncPayload, WordData } from "@shared/index";
import { STORAGE_KEYS } from "../shared/constants";
import type { RuntimeMessage, RuntimeResponse } from "../types/messages";

const API_BASE = import.meta.env.VITE_WORD_TOOL_API_BASE ?? "http://localhost:3000";
const REVIEW_QUEUE_KEY = "review_queue";

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
      return lookupWord(message.payload.text);
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
    default:
      return null;
  }
}

async function lookupWord(text: string): Promise<WordData> {
  const username = await getUsername();
  const params = new URLSearchParams({ word: text });
  const response = await fetch(`${API_BASE}/api/word?${params.toString()}`, {
    headers: username ? { "X-Username": username } : undefined
  });
  if (!response.ok) throw new Error("Lookup failed");
  return (await response.json()) as WordData;
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
