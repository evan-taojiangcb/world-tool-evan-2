import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { WordData } from "@shared/index";
import { sendRuntimeMessage } from "../shared/api";
import { DEFAULT_SETTINGS, type PronunciationSettings } from "../shared/settings";

type ReviewQueueItem = {
  word: string;
  addedAt: number;
};

function download(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCsv(items: WordData[]): string {
  const rows = ["word,partOfSpeech,definition,collectedAt"];
  items.forEach((item) => {
    item.definitions.forEach((def) => {
      rows.push(
        [
          item.word,
          def.partOfSpeech,
          def.definition.replaceAll(",", "，"),
          item.collectedAt ? new Date(item.collectedAt).toISOString() : ""
        ].join(",")
      );
    });
  });
  return rows.join("\n");
}

function queueToCsv(items: ReviewQueueItem[]): string {
  const rows = ["word,addedAt"];
  items.forEach((item) => {
    rows.push([item.word, new Date(item.addedAt).toISOString()].join(","));
  });
  return rows.join("\n");
}

function OptionsApp(): JSX.Element {
  const [collections, setCollections] = useState<Record<string, WordData>>({});
  const [queue, setQueue] = useState<ReviewQueueItem[]>([]);
  const [activeTab, setActiveTab] = useState<"collections" | "queue">("collections");
  const [settings, setSettings] = useState<PronunciationSettings>(DEFAULT_SETTINGS);

  useEffect(() => {
    void sendRuntimeMessage<Record<string, WordData>>({ type: "GET_COLLECTIONS" }).then(setCollections);
    void sendRuntimeMessage<ReviewQueueItem[]>({ type: "GET_REVIEW_QUEUE" }).then(setQueue);
    void sendRuntimeMessage<PronunciationSettings>({ type: "GET_SETTINGS" }).then(setSettings);
  }, []);

  const words = useMemo(() => Object.values(collections), [collections]);

  const remove = async (word: string): Promise<void> => {
    await sendRuntimeMessage({ type: "DELETE_COLLECTION", payload: { word } });
    setCollections((prev) => {
      const next = { ...prev };
      delete next[word.toLowerCase()];
      return next;
    });
  };

  const removeQueueItem = async (word: string): Promise<void> => {
    await sendRuntimeMessage({ type: "DELETE_REVIEW_QUEUE", payload: { word } });
    setQueue((prev) => prev.filter((item) => item.word !== word.toLowerCase()));
  };

  const clearQueue = async (): Promise<void> => {
    await sendRuntimeMessage({ type: "CLEAR_REVIEW_QUEUE" });
    setQueue([]);
  };

  const updateSettings = async (patch: Partial<PronunciationSettings>): Promise<void> => {
    const next = await sendRuntimeMessage<PronunciationSettings>({
      type: "SET_SETTINGS",
      payload: { settings: patch }
    });
    setSettings(next);
  };

  return (
    <div style={{ maxWidth: 840, margin: "30px auto", fontFamily: "-apple-system, Segoe UI, sans-serif" }}>
      <h2>收藏与复习管理</h2>
      <div style={{ marginBottom: 16, padding: 12, border: "1px solid #e5e7eb", borderRadius: 8 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>词根音标展示设置</div>
        <label style={{ marginRight: 16 }}>
          <input
            type="radio"
            name="morphology-accent"
            checked={settings.morphologyAccent === "uk"}
            onChange={() => void updateSettings({ morphologyAccent: "uk" })}
          />{" "}
          默认英音 (UK)
        </label>
        <label style={{ marginLeft: 16 }}>
          <input
            type="radio"
            name="morphology-accent"
            checked={settings.morphologyAccent === "us"}
            onChange={() => void updateSettings({ morphologyAccent: "us" })}
          />{" "}
          默认美音 (US)
        </label>
      </div>
      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <button
          onClick={() => setActiveTab("collections")}
          style={{ background: activeTab === "collections" ? "#111827" : "#f3f4f6", color: activeTab === "collections" ? "#fff" : "#111" }}
        >
          收藏词条
        </button>
        <button
          onClick={() => setActiveTab("queue")}
          style={{ background: activeTab === "queue" ? "#111827" : "#f3f4f6", color: activeTab === "queue" ? "#fff" : "#111" }}
        >
          复习队列
        </button>
      </div>

      {activeTab === "collections" && (
        <>
          <div style={{ marginBottom: 14, display: "flex", gap: 8 }}>
            <button onClick={() => download(JSON.stringify(words, null, 2), "word-collections.json", "application/json")}>导出 JSON</button>
            <button onClick={() => download(toCsv(words), "word-collections.csv", "text/csv")}>导出 CSV</button>
          </div>
          <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">单词/短语</th>
                <th align="left">释义</th>
                <th align="left">收藏时间</th>
                <th align="left">操作</th>
              </tr>
            </thead>
            <tbody>
              {words.map((item) => (
                <tr key={item.word} style={{ borderTop: "1px solid #eaecf0" }}>
                  <td>{item.word}</td>
                  <td>{item.definitions[0]?.definition || "-"}</td>
                  <td>{item.collectedAt ? new Date(item.collectedAt).toLocaleString() : "-"}</td>
                  <td>
                    <button onClick={() => void remove(item.word)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {activeTab === "queue" && (
        <>
          <div style={{ marginBottom: 14, display: "flex", gap: 8 }}>
            <button onClick={() => download(JSON.stringify(queue, null, 2), "review-queue.json", "application/json")}>导出 JSON</button>
            <button onClick={() => download(queueToCsv(queue), "review-queue.csv", "text/csv")}>导出 CSV</button>
            <button onClick={() => void clearQueue()}>清空队列</button>
          </div>
          <table width="100%" cellPadding={8} style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th align="left">单词</th>
                <th align="left">加入时间</th>
                <th align="left">操作</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item) => (
                <tr key={`${item.word}-${item.addedAt}`} style={{ borderTop: "1px solid #eaecf0" }}>
                  <td>{item.word}</td>
                  <td>{new Date(item.addedAt).toLocaleString()}</td>
                  <td>
                    <button onClick={() => void removeQueueItem(item.word)}>删除</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
