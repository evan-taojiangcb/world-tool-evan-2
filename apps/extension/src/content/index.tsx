import { createRoot } from "react-dom/client";
import type { WordData } from "@shared/index";
import { clearHighlights, highlightWords } from "../shared/highlight";
import { sendRuntimeMessage } from "../shared/api";
import { MARK_ATTR } from "../shared/constants";
import { isValidLookupText, normalizeSelectedText } from "../shared/text";
import { isEventInsideExtensionRoot, shouldIgnoreSelectionSample } from "./event-guards";

// 选区锚点：记录被查询文本及其在页面中的位置。
type SelectionAnchor = {
  text: string;
  rect: DOMRect;
  contextSentence?: string;
};

type PopoverPosition = {
  left: number;
  top: number;
};

// 内容脚本的单一状态源：驱动浮层渲染、交互、收藏和高亮。
/**
 * UI 层的状态定义，用于管理内容脚本中弹出面板及相关交互的状态。
 *
 * @property anchor - 当前文本选区的锚点信息，为 `null` 表示没有活跃的选区。
 * @property query - 用户输入或选中的查询词。
 * @property wordData - 查询到的单词数据，为 `null` 表示尚未获取到数据。
 * @property loading - 是否正在加载单词数据。
 * @property visible - 弹出面板是否可见。
 * @property favorited - 当前单词是否已被收藏。
 * @property collections - 用户的收藏集合，键为单词字符串，值为对应的单词数据。
 * @property popoverPosition - 弹出面板的定位信息，为 `null` 表示未计算或不需要显示。
 * @property menuOpen - 菜单（如收藏夹或设置菜单）是否处于展开状态。
 * @property flashText - 闪烁提示文本，用于短暂展示操作反馈信息，为 `null` 表示无提示。
 */
type UIState = {
  anchor: SelectionAnchor | null;
  query: string;
  wordData: WordData | null;
  loading: boolean;
  visible: boolean;
  favorited: boolean;
  collections: Record<string, WordData>;
  popoverPosition: PopoverPosition | null;
  menuOpen: boolean;
  flashText: string | null;
};

// 运行时状态容器（不使用 React 状态，统一通过 render() 刷新）。
const state: UIState = {
  anchor: null,
  query: "",
  wordData: null,
  loading: false,
  visible: false,
  favorited: false,
  collections: {},
  popoverPosition: null,
  menuOpen: false,
  flashText: null
};

const host = document.createElement("div");
host.id = "word-tool-evan-root";
document.documentElement.appendChild(host);
const root = createRoot(host);

// 拖拽与事件节流相关的临时变量。
let dragOrigin: { x: number; y: number } | null = null;
let dragStartPos: PopoverPosition | null = null;
let selectionTimer: number | null = null;
let isApplyingHighlights = false;
let suppressObserverUntil = 0;
let suppressSelectionUntil = 0;

// 启动入口：加载收藏词、首次渲染并绑定事件监听。
async function boot(): Promise<void> {
  state.collections = await sendRuntimeMessage<Record<string, WordData>>({ type: "GET_COLLECTIONS" });
  render();
  refreshHighlights();
  bindSelectionEvents();
  bindGlobalCloseEvents();
  observeDomChanges();
}

// 绑定选词相关事件：mouseup/dblclick/selectionchange，以及点击高亮词回查。
function bindSelectionEvents(): void {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (isEventInsideExtensionRoot(event, host)) {
        suppressSelectionUntil = Date.now() + 400;
      }
    },
    true
  );
  document.addEventListener("mouseup", () => {
    window.setTimeout(onTextSelection, 0);
  });
  document.addEventListener("dblclick", () => {
    window.setTimeout(onTextSelection, 0);
  });
  document.addEventListener("selectionchange", () => {
    if (selectionTimer) window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      selectionTimer = null;
      onTextSelection();
    }, 80);
  });
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      const mark = target?.closest<HTMLElement>(`[${MARK_ATTR}]`);
      if (!mark) return;
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      event.preventDefault();
      event.stopPropagation();
      // 点击高亮词时，以高亮元素矩形作为浮层锚点。
      const word = mark.dataset.word || mark.textContent || "";
      state.anchor = {
        text: word,
        rect: mark.getBoundingClientRect(),
        contextSentence: extractSentenceFromText(mark.parentElement?.textContent, word)
      };
      state.query = state.anchor.text;
      state.visible = true;
      state.popoverPosition = null;
      void lookupCurrent();
    },
    true
  );
}

// 绑定“点击外部关闭”逻辑，避免与扩展浮层内部点击冲突。
function bindGlobalCloseEvents(): void {
  document.addEventListener("click", (event) => {
    if (isEventInsideExtensionRoot(event, host)) return;
    hideFloating();
  });
}

// 从当前选区提取文本并更新 UI 状态；仅准备查询，不立即发请求。
function onTextSelection(): void {
  if (shouldIgnoreSelectionSample(Date.now(), suppressSelectionUntil, document.activeElement, host)) return;
  const active = document.activeElement;
  if (active && ["INPUT", "TEXTAREA"].includes(active.tagName)) return;
  const selection = window.getSelection();
  const text = normalizeSelectedText(selection?.toString() ?? "");
  if (!isValidLookupText(text) || !selection || selection.rangeCount === 0) {
    return;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  state.anchor = {
    text,
    rect,
    contextSentence: extractSentenceFromRange(selection.getRangeAt(0), text)
  };
  state.query = text;
  state.visible = true;
  state.wordData = null;
  state.popoverPosition = null;
  state.menuOpen = false;
  state.flashText = null;
  state.favorited = Boolean(state.collections[text.toLowerCase()]);
  render();
}

// 关闭浮层并清理本次查询相关状态。
function hideFloating(): void {
  state.visible = false;
  state.anchor = null;
  state.wordData = null;
  state.loading = false;
  state.popoverPosition = null;
  state.menuOpen = false;
  state.flashText = null;
  render();
}

// 根据 state.query 执行查词，失败时提供兜底定义。
async function lookupCurrent(): Promise<void> {
  if (!state.query) return;
  state.loading = true;
  render();
  try {
    const data = await sendRuntimeMessage<WordData>({
      type: "LOOKUP_WORD",
      payload: { text: state.query, contextSentence: state.anchor?.contextSentence }
    });
    state.wordData = data;
    state.favorited = Boolean(state.collections[data.word.toLowerCase()]);
  } catch {
    state.wordData = {
      word: state.query,
      translationZh: "查询失败，请稍后重试。",
      phonetic: {},
      audio: {},
      definitions: [
        {
          partOfSpeech: "unknown",
          definition: "查询失败，请稍后重试。"
        }
      ]
    };
  } finally {
    state.loading = false;
    render();
  }
}

// 顶部轻提示（如复制成功），自动消失。
function flash(message: string): void {
  state.flashText = message;
  render();
  window.setTimeout(() => {
    if (state.flashText === message) {
      state.flashText = null;
      render();
    }
  }, 1200);
}

// 收藏/取消收藏当前词，并触发页面高亮刷新。
async function toggleFavorite(): Promise<void> {
  if (!state.wordData) return;
  const key = state.wordData.word.toLowerCase();
  if (state.collections[key]) {
    await sendRuntimeMessage({ type: "DELETE_COLLECTION", payload: { word: key } });
    delete state.collections[key];
    state.favorited = false;
  } else {
    await sendRuntimeMessage({ type: "UPSERT_COLLECTION", payload: { data: state.wordData } });
    state.collections[key] = { ...state.wordData, collectedAt: Date.now() };
    state.favorited = true;
  }
  refreshHighlights();
  state.menuOpen = false;
  render();
}

// 复制当前单词。
async function copyWord(): Promise<void> {
  if (!state.wordData?.word) return;
  await navigator.clipboard.writeText(state.wordData.word);
  state.menuOpen = false;
  flash("Word copied");
}

// 复制第一条释义。
async function copyDefinition(): Promise<void> {
  const def = state.wordData?.definitions?.[0]?.definition;
  if (!def) return;
  await navigator.clipboard.writeText(def);
  state.menuOpen = false;
  flash("Definition copied");
}

// 将当前词加入复习队列。
async function addToReviewQueue(): Promise<void> {
  if (!state.wordData?.word) return;
  const result = await sendRuntimeMessage<{ queued: boolean }>({
    type: "ADD_REVIEW_QUEUE",
    payload: { word: state.wordData.word }
  });
  state.menuOpen = false;
  flash(result.queued ? "Added to review queue" : "Already in review queue");
}

// 依据收藏词重新进行页面高亮；优先在空闲时执行，降低主线程抖动。
function refreshHighlights(): void {
  const apply = () => {
    if (isApplyingHighlights) return;
    isApplyingHighlights = true;
    try {
      clearHighlights(document);
      const words = Object.keys(state.collections);
      highlightWords(words);
    } finally {
      isApplyingHighlights = false;
      suppressObserverUntil = Date.now() + 500;
    }
  };

  const idle = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) {
    idle(apply, { timeout: 180 });
    return;
  }
  globalThis.setTimeout(apply, 0);
}

// 监听 DOM 变化并在文本变化后重跑高亮，避开自身渲染/高亮造成的递归触发。
function observeDomChanges(): void {
  const observer = new MutationObserver((mutations) => {
    if (isApplyingHighlights) return;
    if (Date.now() < suppressObserverUntil) return;
    if (!Object.keys(state.collections).length) return;
    const hasTextChange = mutations.some((m) => {
      const targetElement = m.target instanceof Element ? m.target : m.target.parentElement;
      if (targetElement?.closest("#word-tool-evan-root")) return false;
      return m.type === "childList" || m.type === "characterData";
    });
    if (!hasTextChange) return;
    refreshHighlights();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

// 音频不可用时，使用 Web Speech API 进行兜底朗读。
function speakFallback(text: string): void {
  if (!("speechSynthesis" in window) || !text) return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith("en-US") && /Samantha|Google US English|Daniel/i.test(v.name)) ??
    voices.find((v) => v.lang.startsWith("en-US")) ??
    voices.find((v) => v.lang.startsWith("en"));
  utterance.voice = preferred || null;
  utterance.lang = preferred?.lang || "en-US";
  utterance.rate = 0.92;
  utterance.pitch = 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

// 优先播放词典音频，失败时按英美口音偏好走 TTS 兜底。
function playAudio(url: string | undefined, fallbackWord: string, locale: "uk" | "us"): void {
  if (!url) {
    speakFallback(fallbackWord);
    return;
  }
  const audio = new Audio(url);
  audio
    .play()
    .catch(() => {
      if ("speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(fallbackWord);
        const voices = window.speechSynthesis.getVoices();
        const targetLang = locale === "uk" ? "en-GB" : "en-US";
        utterance.voice = voices.find((v) => v.lang.startsWith(targetLang)) || null;
        utterance.lang = utterance.voice?.lang || targetLang;
        utterance.rate = 0.92;
        utterance.pitch = 1;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } else {
        speakFallback(fallbackWord);
      }
    });
}

type IconName = "search" | "star" | "more" | "close" | "volume" | "book" | "add" | "check";

// 统一图标组件，避免在 JSX 中散落 SVG 细节。
function Icon({ name, filled = false }: { name: IconName; filled?: boolean }): JSX.Element {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;
  switch (name) {
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="7" />
          <path d="M20 20l-3.5-3.5" />
        </svg>
      );
    case "star":
      return filled ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <path d="m12 2.5 2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5Z" />
        </svg>
      ) : (
        <svg {...common}>
          <path d="m12 2.5 2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5Z" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
    case "volume":
      return (
        <svg {...common}>
          <path d="M4 10h4l5-4v12l-5-4H4z" />
          <path d="M17 9a4 4 0 0 1 0 6" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M4 5a2 2 0 0 1 2-2h12v17H6a2 2 0 0 0-2 2z" />
          <path d="M6 3v17" />
        </svg>
      );
    case "add":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="m5 13 4 4L19 7" />
        </svg>
      );
  }
}

const ARPABET_TO_IPA: Record<string, string> = {
  AA: "ɑː",
  AE: "æ",
  AH: "ʌ",
  AO: "ɔː",
  AW: "aʊ",
  AY: "aɪ",
  B: "b",
  CH: "tʃ",
  D: "d",
  DH: "ð",
  EH: "e",
  ER: "ɝ",
  EY: "eɪ",
  F: "f",
  G: "ɡ",
  HH: "h",
  IH: "ɪ",
  IY: "iː",
  JH: "dʒ",
  K: "k",
  L: "l",
  M: "m",
  N: "n",
  NG: "ŋ",
  OW: "oʊ",
  OY: "ɔɪ",
  P: "p",
  R: "r",
  S: "s",
  SH: "ʃ",
  T: "t",
  TH: "θ",
  UH: "ʊ",
  UW: "uː",
  V: "v",
  W: "w",
  Y: "j",
  Z: "z",
  ZH: "ʒ"
};

const POS_ZH_MAP: Record<string, string> = {
  noun: "名词",
  n: "名词",
  verb: "动词",
  v: "动词",
  adjective: "形容词",
  adj: "形容词",
  adverb: "副词",
  adv: "副词",
  pronoun: "代词",
  pron: "代词",
  preposition: "介词",
  prep: "介词",
  conjunction: "连词",
  conj: "连词",
  interjection: "感叹词",
  int: "感叹词",
  determiner: "限定词",
  article: "冠词",
  phrase: "短语",
  idiom: "习语",
  unknown: "未知词性"
};

function formatPartOfSpeech(pos?: string): string {
  const raw = (pos || "unknown").trim().replace(/\.$/, "");
  const key = raw.toLowerCase();
  const zh = POS_ZH_MAP[key];
  return zh ? `${zh} (${raw})` : raw;
}

function getPrimaryDefinition(wordData: WordData): { pos: string; translation?: string; example?: string; exampleZh?: string } {
  const first = wordData.definitions[0];
  return {
    pos: formatPartOfSpeech(first?.partOfSpeech),
    translation: wordData.translationZh || first?.translation,
    example: first?.example || wordData.contextSentence,
    exampleZh: first?.exampleTranslation || wordData.contextSentenceZh
  };
}

function getContextExplanation(wordData: WordData): string {
  const sentence = wordData.contextSentence ? `原句：${wordData.contextSentence}` : "";
  const explain = wordData.contextExplanationZh || wordData.definitions[0]?.translation || `暂无 ${wordData.word} 的上下文解释说明。`;
  return sentence ? `${sentence}。${explain}` : explain;
}

function extractSentenceFromText(rawText: string | null | undefined, selectedText: string): string | undefined {
  if (!rawText) return undefined;
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  const selected = selectedText.trim().toLowerCase();
  if (!selected) return undefined;
  const candidates = (text.match(/[^.!?。！？]+[.!?。！？]?/g) ?? []).map((item) => item.trim()).filter(Boolean);
  const matched = candidates.find((item) => item.toLowerCase().includes(selected));
  return (matched || text).slice(0, 260);
}

function extractSentenceFromRange(range: Range, selectedText: string): string | undefined {
  const base = range.commonAncestorContainer;
  const element = base.nodeType === Node.ELEMENT_NODE ? (base as Element) : base.parentElement;
  return extractSentenceFromText(element?.textContent, selectedText);
}

// 将多种音标输入规整为可展示字符串：支持 IPA 直出与 ARPABET 转 IPA。
function formatPhonetic(raw?: string): string {
  if (!raw) return "-";
  const text = raw.trim();
  if (!text) return "-";
  if (/[/ɪʊəæɑɔʃʒθðŋ]/.test(text)) return text;
  if (/^[A-Z0-9\s]+$/.test(text)) {
    const vowelSet = new Set(["AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"]);
    let pendingStress = "";
    const ipa = text
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => {
        const m = token.match(/^([A-Z]+)([0-2])?$/);
        if (!m) return token.toLowerCase();
        const base = m[1];
        const stress = m[2];
        if (stress === "1") pendingStress = "ˈ";
        if (stress === "2") pendingStress = "ˌ";
        const ipaToken = ARPABET_TO_IPA[base] || base.toLowerCase();
        if (vowelSet.has(base) && pendingStress) {
          const out = `${pendingStress}${ipaToken}`;
          pendingStress = "";
          return out;
        }
        return ipaToken;
      })
      .join("");
    return ipa;
  }
  return text;
}

// 浮层默认定位：靠近选区并限制在可视区域内。
function getDefaultPopoverPosition(anchor: SelectionAnchor): PopoverPosition {
  const left = Math.min(window.innerWidth - 352, Math.max(8, anchor.rect.left));
  const top = Math.min(window.innerHeight - 420, Math.max(8, anchor.rect.bottom + 10));
  return { left, top };
}

// 拖拽过程中更新浮层位置。
function onDragMove(event: MouseEvent): void {
  if (!dragOrigin || !dragStartPos) return;
  const nextLeft = dragStartPos.left + (event.clientX - dragOrigin.x);
  const nextTop = dragStartPos.top + (event.clientY - dragOrigin.y);
  state.popoverPosition = {
    left: Math.min(window.innerWidth - 352, Math.max(8, nextLeft)),
    top: Math.min(window.innerHeight - 80, Math.max(8, nextTop))
  };
  render();
}

// 结束拖拽并解绑全局鼠标事件。
function stopDrag(): void {
  dragOrigin = null;
  dragStartPos = null;
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", stopDrag);
}

// 从标题栏开始拖拽，记录起始点并绑定 move/up 监听。
function startDrag(event: { clientX: number; clientY: number }): void {
  const anchor = state.anchor;
  if (!anchor) return;
  const current = state.popoverPosition ?? getDefaultPopoverPosition(anchor);
  dragOrigin = { x: event.clientX, y: event.clientY };
  dragStartPos = current;
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", stopDrag);
}

// 主渲染函数：根据 state 生成悬浮查询按钮与词义弹窗。
function render(): void {
  const anchor = state.anchor;
  if (!state.visible || !anchor) {
    root.render(null);
    return;
  }

  const btnLeft = Math.min(window.innerWidth - 44, Math.max(8, anchor.rect.right + 6));
  const btnTop = Math.min(window.innerHeight - 44, Math.max(8, anchor.rect.top - 8));
  const popover = state.popoverPosition ?? getDefaultPopoverPosition(anchor);

  root.render(
    <>
      <button
        className="word-tool-floating-btn"
        style={{ left: `${btnLeft}px`, top: `${btnTop}px` }}
        onClick={() => void lookupCurrent()}
        title="查询"
      >
        <Icon name="search" />
      </button>

      {(state.loading || state.wordData) && (
        <div className="word-tool-popover" style={{ top: `${popover.top}px`, left: `${popover.left}px` }}>
          <div className="word-tool-popover-arrow" />
          {state.flashText && <div className="word-tool-flash">{state.flashText}</div>}
          {state.loading && <div className="word-tool-loading">Loading definition...</div>}
          {!state.loading && state.wordData && (
            <>
              <div className="word-tool-title" onMouseDown={startDrag}>
                <div>
                  <div className="word-tool-word">{state.wordData.word}</div>
                  <div className="word-tool-ipa-list">
                    {/* <div className="word-tool-ipa">
                      <span className="word-tool-ipa-label">UK</span> /{formatPhonetic(state.wordData.phonetic.uk)}/
                    </div>
                    <div className="word-tool-ipa">
                      <span className="word-tool-ipa-label">US</span> /{formatPhonetic(state.wordData.phonetic.us)}/
                    </div> */}
                  </div>
                </div>
                <div className="word-tool-actions">
                  <button
                    className={`word-tool-icon-btn ${state.favorited ? "word-tool-star-active" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void toggleFavorite();
                    }}
                    title={state.favorited ? "取消收藏" : "收藏"}
                  >
                    <Icon name="star" filled={state.favorited} />
                  </button>
                  <button
                    className="word-tool-icon-btn"
                    title="更多"
                    onClick={(event) => {
                      event.stopPropagation();
                      state.menuOpen = !state.menuOpen;
                      render();
                    }}
                  >
                    <Icon name="more" />
                  </button>
                  <button className="word-tool-icon-btn" onClick={() => hideFloating()} title="关闭">
                    <Icon name="close" />
                  </button>
                </div>
              </div>
              {state.menuOpen && (
                <div className="word-tool-menu">
                  <button className="word-tool-menu-item" onClick={() => void copyWord()}>
                    Copy word
                  </button>
                  <button className="word-tool-menu-item" onClick={() => void copyDefinition()}>
                    Copy definition
                  </button>
                  <button className="word-tool-menu-item" onClick={() => void addToReviewQueue()}>
                    Add to review queue
                  </button>
                  <button className="word-tool-menu-item" onClick={() => void toggleFavorite()}>
                    {state.favorited ? "Unfavorite" : "Favorite"}
                  </button>
                </div>
              )}

              <div className="word-tool-phonetic-row">
                <div className="word-tool-audio-row">
                  <div className="word-tool-audio-text">
                    <strong>UK</strong>
                    <span>{formatPhonetic(state.wordData.phonetic.uk)}</span>
                  </div>
                  <button
                    className="word-tool-audio-chip"
                    onClick={(event) => {
                      event.stopPropagation();
                      playAudio(state.wordData?.audio.uk, state.wordData!.word, "uk");
                    }}
                  >
                    <Icon name="volume" />
                  </button>
                </div>
                <div className="word-tool-audio-row">
                  <div className="word-tool-audio-text">
                    <strong>US</strong>
                    <span>{formatPhonetic(state.wordData.phonetic.us)}</span>
                  </div>
                  <button
                    className="word-tool-audio-chip"
                    onClick={(event) => {
                      event.stopPropagation();
                      playAudio(state.wordData?.audio.us, state.wordData!.word, "us");
                    }}
                  >
                    <Icon name="volume" />
                  </button>
                </div>
              </div>

              {(() => {
                const primary = getPrimaryDefinition(state.wordData);
                return (
                  <div className="word-tool-def">
                    <div>
                      <span className="word-tool-pos">中文</span>
                      <span>{primary.translation || "暂无翻译"} / {primary.pos}</span>
                    </div>
                  </div>
                );
              })()}

              {(() => {
                const morphParts = state.wordData.morphology ?? [];
                if (!morphParts.length) return null;
                return (
                  <div className="word-tool-morph">
                    <span className="word-tool-pos">词根词缀</span>
                    <span className="word-tool-morph-parts">
                      {morphParts.map((part, idx) => (
                        <span key={`${part}-${idx}`} className="word-tool-morph-token">
                          <span className="word-tool-morph-chip">{part}</span>
                          {idx < morphParts.length - 1 ? <span className="word-tool-morph-plus">+</span> : null}
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })()}

              {(() => {
                const primary = getPrimaryDefinition(state.wordData);
                return (
                  <div className="word-tool-def">
                    <div>
                      <span className="word-tool-pos">例句</span>
                      <span>{primary.example || `暂无 ${state.wordData.word} 的例句。`}</span>
                    </div>
                    {primary.exampleZh ? <div className="word-tool-example word-tool-translation">{primary.exampleZh}</div> : null}
                  </div>
                );
              })()}

              <div className="word-tool-def">
                <div>
                  <span className="word-tool-pos">上下文解释说明</span>
                  <span>{getContextExplanation(state.wordData)}</span>
                </div>
              </div>

              <div className="word-tool-footer">
                <span className="word-tool-footer-note">
                  <Icon name="book" /> See full dictionary
                </span>
                <button
                  className="word-tool-add-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    void toggleFavorite();
                  }}
                >
                  {state.favorited ? <Icon name="check" /> : <Icon name="add" />}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// 内容脚本启动。
void boot();
