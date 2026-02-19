import localforage from "localforage";
import type { WordData } from "@shared/index";

const collectionsStore = localforage.createInstance({
  name: "word-tool-evan",
  storeName: "collections"
});

export async function getAllCollections(): Promise<Record<string, WordData>> {
  const map: Record<string, WordData> = {};
  await collectionsStore.iterate<WordData, void>((value, key) => {
    map[key] = value;
  });
  return map;
}

export async function getCollection(word: string): Promise<WordData | null> {
  const found = await collectionsStore.getItem<WordData>(word.toLowerCase());
  return found ?? null;
}

export async function upsertCollection(data: WordData): Promise<void> {
  const key = data.word.toLowerCase();
  await collectionsStore.setItem(key, { ...data, collectedAt: Date.now() });
}

export async function removeCollection(word: string): Promise<void> {
  await collectionsStore.removeItem(word.toLowerCase());
}
