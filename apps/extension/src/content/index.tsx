import { createRoot } from "react-dom/client";
import type { WordData } from "@shared/index";
import { clearHighlights, highlightWords } from "../shared/highlight";
import { sendRuntimeMessage } from "../shared/api";
import { isValidLookupText, normalizeSelectedText } from "../shared/text";

type SelectionAnchor = {
  text: string;
  rect: DOMRect;
};

type PopoverPosition = {
  left: number;
  top: number;
};

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

let dragOrigin: { x: number; y: number } | null = null;
let dragStartPos: PopoverPosition | null = null;

async function boot(): Promise<void> {
  state.collections = await sendRuntimeMessage<Record<string, WordData>>({ type: "GET_COLLECTIONS" });
  render();
  refreshHighlights();
  bindSelectionEvents();
  bindGlobalCloseEvents();
  observeDomChanges();
}

function bindSelectionEvents(): void {
  document.addEventListener("mouseup", onTextSelection);
  document.addEventListener("dblclick", onTextSelection);
}

function bindGlobalCloseEvents(): void {
  document.addEventListener("scroll", () => hideFloating(), true);
  document.addEventListener("click", (event) => {
    const el = event.target as HTMLElement;
    if (el.closest("#word-tool-evan-root")) return;
    hideFloating();
  });
}

function onTextSelection(): void {
  const active = document.activeElement;
  if (active && ["INPUT", "TEXTAREA"].includes(active.tagName)) return;
  const selection = window.getSelection();
  const text = normalizeSelectedText(selection?.toString() ?? "");
  if (!isValidLookupText(text) || !selection || selection.rangeCount === 0) {
    return;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  state.anchor = { text, rect };
  state.query = text;
  state.visible = true;
  state.wordData = null;
  state.popoverPosition = null;
  state.menuOpen = false;
  state.flashText = null;
  state.favorited = Boolean(state.collections[text.toLowerCase()]);
  render();
}

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

async function lookupCurrent(): Promise<void> {
  if (!state.query) return;
  state.loading = true;
  render();
  try {
    const data = await sendRuntimeMessage<WordData>({
      type: "LOOKUP_WORD",
      payload: { text: state.query }
    });
    state.wordData = data;
    state.favorited = Boolean(state.collections[data.word.toLowerCase()]);
  } catch {
    state.wordData = {
      word: state.query,
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

async function copyWord(): Promise<void> {
  if (!state.wordData?.word) return;
  await navigator.clipboard.writeText(state.wordData.word);
  state.menuOpen = false;
  flash("Word copied");
}

async function copyDefinition(): Promise<void> {
  const def = state.wordData?.definitions?.[0]?.definition;
  if (!def) return;
  await navigator.clipboard.writeText(def);
  state.menuOpen = false;
  flash("Definition copied");
}

async function addToReviewQueue(): Promise<void> {
  if (!state.wordData?.word) return;
  const result = await sendRuntimeMessage<{ queued: boolean }>({
    type: "ADD_REVIEW_QUEUE",
    payload: { word: state.wordData.word }
  });
  state.menuOpen = false;
  flash(result.queued ? "Added to review queue" : "Already in review queue");
}

function refreshHighlights(): void {
  clearHighlights(document);
  const words = Object.keys(state.collections);
  highlightWords(words, async (word, rect) => {
    state.anchor = { text: word, rect };
    state.query = word;
    state.visible = true;
    state.popoverPosition = null;
    await lookupCurrent();
  });
}

function observeDomChanges(): void {
  const observer = new MutationObserver((mutations) => {
    if (!Object.keys(state.collections).length) return;
    const hasTextChange = mutations.some((m) => m.type === "childList" || m.type === "characterData");
    if (!hasTextChange) return;
    refreshHighlights();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
}

function playAudio(url?: string): void {
  if (!url) return;
  const audio = new Audio(url);
  void audio.play();
}

type IconName = "search" | "star" | "more" | "close" | "volume" | "book" | "add" | "check";

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

function getDefaultPopoverPosition(anchor: SelectionAnchor): PopoverPosition {
  const left = Math.min(window.innerWidth - 352, Math.max(8, anchor.rect.left));
  const top = Math.min(window.innerHeight - 420, Math.max(8, anchor.rect.bottom + 10));
  return { left, top };
}

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

function stopDrag(): void {
  dragOrigin = null;
  dragStartPos = null;
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", stopDrag);
}

function startDrag(event: { clientX: number; clientY: number }): void {
  const anchor = state.anchor;
  if (!anchor) return;
  const current = state.popoverPosition ?? getDefaultPopoverPosition(anchor);
  dragOrigin = { x: event.clientX, y: event.clientY };
  dragStartPos = current;
  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", stopDrag);
}

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
                  <div className="word-tool-ipa">/{state.wordData.phonetic.uk || state.wordData.phonetic.us || "-"}/</div>
                </div>
                <div className="word-tool-actions">
                  <button
                    className={`word-tool-icon-btn ${state.favorited ? "word-tool-star-active" : ""}`}
                    onClick={() => void toggleFavorite()}
                    title={state.favorited ? "取消收藏" : "收藏"}
                  >
                    <Icon name="star" filled={state.favorited} />
                  </button>
                  <button className="word-tool-icon-btn" title="更多" onClick={() => ((state.menuOpen = !state.menuOpen), render())}>
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
                <button className="word-tool-audio-chip" onClick={() => playAudio(state.wordData?.audio.uk)}>
                  <strong>UK</strong> <Icon name="volume" />
                </button>
                <button className="word-tool-audio-chip" onClick={() => playAudio(state.wordData?.audio.us)}>
                  <strong>US</strong> <Icon name="volume" />
                </button>
              </div>

              <div>
                {state.wordData.definitions.map((item, idx) => (
                  <div className="word-tool-def" key={`${item.partOfSpeech}-${idx}`}>
                    <div>
                      <span className="word-tool-pos">{(item.partOfSpeech || "n.").replace(/\.$/, "")}</span>
                      <span>{item.definition}</span>
                    </div>
                    {item.example && <div className="word-tool-example">"{item.example}"</div>}
                    {item.translation && <div className="word-tool-example word-tool-translation">{item.translation}</div>}
                  </div>
                ))}
              </div>

              <div className="word-tool-footer">
                <span className="word-tool-footer-note">
                  <Icon name="book" /> See full dictionary
                </span>
                <button className="word-tool-add-btn" onClick={() => void toggleFavorite()}>
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

void boot();
