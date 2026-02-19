import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sendRuntimeMessage } from "../shared/api";

function PopupApp(): JSX.Element {
  const [username, setUsername] = useState("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    void sendRuntimeMessage<string | null>({ type: "GET_USERNAME" }).then((v) => {
      if (v) {
        setUsername(v);
        setDraft(v);
      }
    });
  }, []);

  return (
    <div style={{ width: 320, padding: 12, fontFamily: "-apple-system, Segoe UI, sans-serif" }}>
      <h3 style={{ marginTop: 0 }}>Word Tool Evan</h3>
      <label style={{ display: "block", marginBottom: 6 }}>用户名</label>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="如: john@example"
        style={{ width: "100%", boxSizing: "border-box", marginBottom: 10 }}
      />
      <button
        onClick={() =>
          void sendRuntimeMessage({ type: "SET_USERNAME", payload: { username: draft } }).then(() => setUsername(draft))
        }
      >
        保存
      </button>
      <div style={{ marginTop: 10, fontSize: 12, color: "#475467" }}>当前: {username || "未设置"}</div>
      <div style={{ marginTop: 12 }}>
        <button onClick={() => chrome.runtime.openOptionsPage()}>收藏管理</button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
