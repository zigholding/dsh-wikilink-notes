/**
 * Browser half: when the composer draft contains an unclosed `[[`,
 * show note names and insert the chosen link.
 */
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { rankNotes } from "../complete/rank.js";
import { findOpenTrigger, replaceTrigger } from "../complete/trigger.js";
import { SettingsBoundary } from "./settings.jsx";

const STYLE_ID = "dsh-wikilink-completion-style";
const noteCache = new Map();

export const inject = ["slots"];

export function apply(ctx) {
  ctx.effect(() => installStyles(), "wikilink-completion: styles");
  ctx.on?.("connection/reset", () => {
    noteCache.clear();
  });
  ctx.slots.inject("conversation.input.overlay", () =>
    ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: "wikilink-completion",
        order: 24,
      },
      Picker,
    ),
  );
  ctx.slots.inject("settings.general.item", () =>
    ctx.slots.register(
      { name: "settings.general.item", id: "wikilink-completion", order: 30 },
      () => React.createElement(SettingsBoundary),
    ),
  );
  ctx.slots.inject("settings.section", () =>
    ctx.slots.register(
      {
        name: "settings.section",
        id: "wikilink-completion",
        order: 48,
        label: () => "双链补全",
      },
      () => React.createElement(SettingsBoundary),
    ),
  );
}

export function Picker({ sessionId, useInput, inputActions }) {
  const input = useInput((state) => state);
  const draft = typeof input?.draft === "string" ? input.draft : "";
  const [caret, setCaret] = useState(draft.length);
  const [suppressed, setSuppressed] = useState(false);
  const [active, setActive] = useState(0);
  const [index, setIndex] = useState(() => readCache(sessionId));

  useEffect(() => {
    setSuppressed(false);
  }, [draft]);

  useEffect(() => {
    const sync = () => {
      const field = composerField();
      if (field && field.value === draft) setCaret(field.selectionStart ?? draft.length);
      else setCaret(draft.length);
    };
    sync();
    document.addEventListener("selectionchange", sync);
    document.addEventListener("keyup", sync);
    return () => {
      document.removeEventListener("selectionchange", sync);
      document.removeEventListener("keyup", sync);
    };
  }, [draft]);

  useEffect(() => {
    const refresh = () => {
      noteCache.clear();
      setIndex({ status: "idle", notes: [], message: "" });
    };
    window.addEventListener("wlc-settings-saved", refresh);
    return () => window.removeEventListener("wlc-settings-saved", refresh);
  }, []);

  const trigger = useMemo(() => findOpenTrigger(draft, caret), [draft, caret]);
  const open = !suppressed && trigger !== null && input !== undefined;

  useEffect(() => {
    if (!open || !sessionId) return undefined;
    const cached = readCache(sessionId);
    if (cached.status === "ready") {
      setIndex(cached);
      return undefined;
    }
    const controller = new AbortController();
    setIndex({ status: "loading", notes: [], message: "" });
    const url = `/api/wikilink-completion/notes?sessionId=${encodeURIComponent(sessionId)}`;
    fetch(url, { signal: controller.signal, headers: { accept: "application/json" } })
      .then(async (response) => {
        if (!response.ok) throw new Error("notes-unavailable");
        return response.json();
      })
      .then((payload) => {
        const notes = Array.isArray(payload?.notes) ? payload.notes.filter(isNote) : [];
        const next = {
          status: payload?.status === "no-workspace" || payload?.status === "no-vaults" ? "empty" : "ready",
          notes,
          message: indexMessage(payload),
        };
        noteCache.set(sessionId, { at: Date.now(), ...next });
        if (!controller.signal.aborted) setIndex(next);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setIndex({ status: "error", notes: [], message: "笔记名称暂时读不出来" });
        console.error("[wikilink-completion]", error);
      });
    return () => controller.abort();
  }, [open, sessionId]);

  const ranked = useMemo(
    () => (trigger ? rankNotes(index.notes, trigger.query, 8) : []),
    [index.notes, trigger],
  );

  useEffect(() => {
    setActive(0);
  }, [trigger?.query]);

  const pick = (link) => {
    if (!trigger || typeof inputActions?.setDraft !== "function") return;
    inputActions.setDraft(replaceTrigger(draft, trigger, link));
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (!eventInComposer(event)) return;
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && ranked.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        setActive((current) => {
          if (event.key === "ArrowDown") return Math.min(current + 1, ranked.length - 1);
          return Math.max(current - 1, 0);
        });
      } else if (event.key === "Enter" && !event.shiftKey && ranked.length > 0) {
        event.preventDefault();
        event.stopPropagation();
        const hit = ranked[Math.min(active, ranked.length - 1)];
        if (hit) pick(hit.note.link);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSuppressed(true);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, ranked, active, trigger, draft, inputActions]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".wlc-menu") === null) {
        setSuppressed(true);
      }
    };
    document.addEventListener("mousedown", onPointer, true);
    return () => document.removeEventListener("mousedown", onPointer, true);
  }, [open]);

  const [box, setBox] = useState(null);
  useEffect(() => {
    if (!open) return undefined;
    const measure = () => setBox(measureMenu());
    measure();
    window.addEventListener("resize", measure);
    document.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      document.removeEventListener("scroll", measure, true);
    };
  }, [open, draft, caret]);

  if (!open || box === null || typeof document === "undefined") return null;

  const body = renderMenu({
    ranked,
    active,
    status: index.status,
    message: index.message,
    onHover: setActive,
    onPick: pick,
  });
  return createPortal(
    <div
      className="wlc-menu"
      role="listbox"
      aria-label="笔记名称"
      style={{ left: box.left, width: box.width, bottom: box.bottom }}
    >
      {body}
    </div>,
    document.body,
  );
}

function renderMenu({ ranked, active, status, message, onHover, onPick }) {
  if (!ranked.length && (status === "loading" || status === "idle")) {
    return <div className="wlc-empty">正在读取笔记名称…</div>;
  }
  if (status === "error" || status === "empty") return <div className="wlc-empty">{message}</div>;
  if (ranked.length === 0) return <div className="wlc-empty">没有匹配的笔记</div>;
  return (
    <>
      {ranked.map((item, index) => (
        <button
          key={item.note.link}
          type="button"
          role="option"
          aria-selected={index === active}
          className="wlc-item"
          data-active={index === active ? "true" : "false"}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item.note.link);
          }}
          onMouseEnter={() => onHover(index)}
        >
          <span className="wlc-mark">[[</span>
          <span className="wlc-copy">
            <span className="wlc-name">{item.note.name}</span>
            <span className="wlc-meta">
              {[item.note.vault, item.note.folder].filter(Boolean).join(" / ") || "工作区"}
              {item.hint ? ` · ${item.hint}` : ""}
              {item.note.link !== item.note.name ? ` · ${item.note.link}` : ""}
            </span>
          </span>
        </button>
      ))}
      <div className="wlc-hint">↑↓ 选择 · Enter 插入 · Esc 关闭</div>
    </>
  );
}

function indexMessage(payload) {
  if (payload?.status === "no-workspace") {
    return "这个会话还没有工作区。可以在设置 → 双链补全里添加 Obsidian 仓库。";
  }
  if (payload?.status === "no-vaults") {
    return "还没有笔记来源。打开设置 → 双链补全，添加 Obsidian 仓库。";
  }
  const warning = Array.isArray(payload?.warnings) ? payload.warnings.find((item) => typeof item === "string") : "";
  return warning || "";
}

function readCache(sessionId) {
  const hit = sessionId ? noteCache.get(sessionId) : undefined;
  if (!hit || Date.now() - hit.at > 15_000) {
    return { status: "idle", notes: [], message: "" };
  }
  return { status: hit.status, notes: hit.notes, message: hit.message };
}

function isNote(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.name === "string" &&
    typeof value.link === "string" &&
    value.name.length > 0 &&
    value.link.length > 0 &&
    value.link.length < 300
  );
}

function composerField() {
  const active = document.activeElement;
  if (active instanceof HTMLTextAreaElement && active.closest("[data-composer-card]")) return active;
  const card = document.querySelector("[data-composer-card] textarea");
  return card instanceof HTMLTextAreaElement ? card : null;
}

function eventInComposer(event) {
  const target = event.target;
  if (!(target instanceof Node)) return false;
  const element = target instanceof Element ? target : target.parentElement;
  return element?.closest("[data-composer-card]") != null;
}

function measureMenu() {
  const card = document.querySelector("[data-composer-card]");
  const rect = card?.getBoundingClientRect();
  if (!rect) return { left: 16, width: Math.min(380, window.innerWidth - 32), bottom: 120 };
  const width = Math.min(420, Math.max(260, rect.width - 24));
  const left = Math.min(rect.left + 12, window.innerWidth - width - 12);
  const bottom = Math.max(12, window.innerHeight - rect.top + 8);
  return { left: Math.max(12, left), width, bottom };
}

function installStyles() {
  const previous = document.getElementById(STYLE_ID);
  previous?.remove();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.wlc-menu {
  position: fixed;
  z-index: 70;
  max-height: min(320px, 46vh);
  overflow: auto;
  padding: 6px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border, rgba(255, 244, 224, 0.14));
  background: var(--dsw-alias-bg-elevated, #231f1a);
  color: var(--dsw-alias-fg, #f6f1e8);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.32);
  font: 13px/1.35 ui-sans-serif, "PingFang SC", "Noto Sans SC", sans-serif;
}
.wlc-item {
  display: flex;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  padding: 8px 10px;
  cursor: pointer;
}
.wlc-item[data-active="true"] {
  background: var(--dsw-alias-bg-selected, rgba(224, 168, 92, 0.18));
}
.wlc-mark {
  color: var(--dsw-alias-accent, #e0a85c);
  font-family: ui-monospace, "Sarasa Mono SC", monospace;
  padding-top: 1px;
}
.wlc-copy { display: flex; flex-direction: column; min-width: 0; }
.wlc-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wlc-meta, .wlc-hint, .wlc-empty {
  color: var(--dsw-alias-fg-muted, rgba(246, 241, 232, 0.62));
}
.wlc-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.wlc-hint, .wlc-empty { padding: 6px 10px 4px; font-size: 12px; }
`;
  document.head.appendChild(style);
  return () => style.remove();
}
