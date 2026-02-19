import type { WordData } from "@shared/index";
import type { PronunciationSettings } from "../shared/settings";

export type RuntimeMessage =
  | { type: "LOOKUP_WORD"; payload: { text: string; contextSentence?: string } }
  | { type: "GET_COLLECTIONS" }
  | { type: "UPSERT_COLLECTION"; payload: { data: WordData } }
  | { type: "DELETE_COLLECTION"; payload: { word: string } }
  | { type: "ADD_REVIEW_QUEUE"; payload: { word: string } }
  | { type: "GET_REVIEW_QUEUE" }
  | { type: "DELETE_REVIEW_QUEUE"; payload: { word: string } }
  | { type: "CLEAR_REVIEW_QUEUE" }
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; payload: { settings: Partial<PronunciationSettings> } }
  | { type: "GET_USERNAME" }
  | { type: "SET_USERNAME"; payload: { username: string } };

export type RuntimeResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};
