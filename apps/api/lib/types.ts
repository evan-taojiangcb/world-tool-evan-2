import type { WordData } from "@shared/index";

export type CollectionItem = {
  username: string;
  word: string;
  collectedAt: number;
  data: WordData;
};
