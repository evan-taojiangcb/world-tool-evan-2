export type DefinitionItem = {
  partOfSpeech: string;
  definition: string;
  example?: string;
  translation?: string;
};

export type WordData = {
  word: string;
  phonetic: {
    uk?: string;
    us?: string;
  };
  audio: {
    uk?: string;
    us?: string;
  };
  definitions: DefinitionItem[];
  collectedAt?: number;
};

export type CollectionSyncPayload = {
  words: Array<{
    word: string;
    data: WordData;
    collectedAt: number;
  }>;
};
