export type DefinitionItem = {
  partOfSpeech: string;
  definition: string;
  example?: string;
  exampleTranslation?: string;
  translation?: string;
};

export type WordData = {
  word: string;
  translationZh?: string;
  contextSentence?: string;
  contextSentenceZh?: string;
  contextExplanationZh?: string;
  phonetic: {
    uk?: string;
    us?: string;
  };
  audio: {
    uk?: string;
    us?: string;
  };
  definitions: DefinitionItem[];
  morphology?: string[];
  collectedAt?: number;
};

export type CollectionSyncPayload = {
  words: Array<{
    word: string;
    data: WordData;
    collectedAt: number;
  }>;
};
