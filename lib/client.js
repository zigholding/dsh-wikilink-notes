window.__ModuleLoader__.load({ id: "dsh-wikilink-completion", factory: function (require) {
var module = { exports: {} };
var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/entry.jsx
var entry_exports = {};
__export(entry_exports, {
  Picker: () => Picker,
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(entry_exports);
var import_react = __toESM(require("react"), 1);
var import_react_dom = require("react-dom");

// src/complete/rank.js
function rankNotes(notes, query, limit = 8) {
  const terms = String(query).trim().split(/\s+/u).filter(Boolean);
  const ranked = [];
  for (const note of notes) {
    if (terms.length === 0) {
      ranked.push({ note, score: 1, hint: "" });
      continue;
    }
    let score = 0;
    let hint = "";
    let matched = true;
    for (const term of terms) {
      const hit = bestField(note, term);
      if (hit.score <= 0) {
        matched = false;
        break;
      }
      score += hit.score;
      if (hit.hint) hint = hit.hint;
    }
    if (matched) ranked.push({ note, score, hint });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.note.name.localeCompare(b.note.name, "zh");
  });
  const cap = Math.max(0, limit);
  return terms.length === 0 ? ranked.slice(0, cap) : ranked.slice(0, cap);
}
function bestField(note, term) {
  let score = scoreField(note.name, term);
  let hint = "";
  const linkScore = scoreField(note.link, term);
  if (linkScore > score) score = linkScore;
  for (const alias of note.aliases ?? []) {
    const aliasScore = scoreField(alias, term);
    if (aliasScore > score) {
      score = aliasScore;
      hint = alias === note.name ? "" : alias;
    }
  }
  const folderScore = Math.min(scoreField(note.folder ?? "", term), 420);
  if (folderScore > score) score = folderScore;
  return { score, hint };
}
function scoreField(field, query) {
  if (!field || !query) return 0;
  const f = field.normalize("NFC").toLowerCase();
  const q = query.normalize("NFC").toLowerCase();
  if (f === q) return 1e3;
  if (f.startsWith(q)) return 820;
  const at = f.indexOf(q);
  if (at >= 0) return 640 - Math.min(at, 80);
  if (q.length < 2) return 0;
  let index = 0;
  let gaps = 0;
  let previous = -2;
  for (let cursor = 0; cursor < f.length && index < q.length; cursor += 1) {
    if (f[cursor] !== q[index]) continue;
    if (previous >= 0 && cursor > previous + 1) gaps += 1;
    previous = cursor;
    index += 1;
  }
  if (index < q.length) return 0;
  return Math.max(120, 360 - gaps * 24);
}

// src/complete/trigger.js
var OPENERS = ["[[", "\u3010\u3010"];
function findOpenTrigger(text, caret = text.length) {
  if (typeof text !== "string") return null;
  const safeCaret = clamp(caret, 0, text.length);
  const head = text.slice(0, safeCaret);
  let at = head.length;
  while (at > 0) {
    const open = lastOpener(head, at);
    if (open === null) return null;
    const query = head.slice(open.index + 2);
    if (query.includes("\n") || query.includes("\r")) {
      at = open.index;
      continue;
    }
    if (isClosedBeforeCaret(text, open.index, safeCaret)) {
      at = open.index;
      continue;
    }
    if (/[\]】|#|^]/u.test(query)) return null;
    if (query.length > 80) return null;
    if (fenceIsOpen(head.slice(0, open.index))) return null;
    return {
      start: open.index,
      end: safeCaret + closingSpan(text, safeCaret),
      query,
      fullwidth: open.fullwidth
    };
  }
  return null;
}
function replaceTrigger(text, trigger, link) {
  const safe = sanitizeLink(link);
  return `${text.slice(0, trigger.start)}[[${safe}]]${text.slice(trigger.end)}`;
}
function sanitizeLink(link) {
  return String(link).replace(/[\[\]\n\r]/g, "").trim();
}
function lastOpener(head, before) {
  let best = null;
  for (const token of OPENERS) {
    const index = head.lastIndexOf(token, before - 1);
    if (index < 0) continue;
    if (best === null || index > best.index) {
      best = { index, fullwidth: token === "\u3010\u3010" };
    }
  }
  return best;
}
function isClosedBeforeCaret(text, open, caret) {
  const between = text.slice(open + 2, caret);
  return between.includes("]]") || between.includes("\u3011\u3011");
}
function closingSpan(text, caret) {
  if (text.startsWith("]]", caret) || text.startsWith("\u3011\u3011", caret)) return 2;
  return 0;
}
function fenceIsOpen(before) {
  const fences = before.match(/```/g);
  return fences !== null && fences.length % 2 === 1;
}
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, value));
}

// src/client/entry.jsx
var STYLE_ID = "dsh-wikilink-completion-style";
var noteCache = /* @__PURE__ */ new Map();
var inject = ["slots"];
function apply(ctx) {
  ctx.effect(() => installStyles(), "wikilink-completion: styles");
  ctx.on?.("connection/reset", () => {
    noteCache.clear();
  });
  ctx.slots.inject(
    "conversation.input.overlay",
    () => ctx.slots.register(
      {
        name: "conversation.input.overlay",
        id: "wikilink-completion",
        order: 24
      },
      Picker
    )
  );
}
function Picker({ sessionId, useInput, inputActions }) {
  const input = useInput((state) => state);
  const draft = typeof input?.draft === "string" ? input.draft : "";
  const [caret, setCaret] = (0, import_react.useState)(draft.length);
  const [suppressed, setSuppressed] = (0, import_react.useState)(false);
  const [active, setActive] = (0, import_react.useState)(0);
  const [index, setIndex] = (0, import_react.useState)(() => readCache(sessionId));
  (0, import_react.useEffect)(() => {
    setSuppressed(false);
  }, [draft]);
  (0, import_react.useEffect)(() => {
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
  const trigger = (0, import_react.useMemo)(() => findOpenTrigger(draft, caret), [draft, caret]);
  const open = !suppressed && trigger !== null && input !== void 0;
  (0, import_react.useEffect)(() => {
    if (!open || !sessionId) return void 0;
    const cached = readCache(sessionId);
    if (cached.status === "ready") {
      setIndex(cached);
      return void 0;
    }
    const controller = new AbortController();
    setIndex({ status: "loading", notes: [], message: "" });
    const url = `/api/wikilink-completion/notes?sessionId=${encodeURIComponent(sessionId)}`;
    fetch(url, { signal: controller.signal, headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok) throw new Error("notes-unavailable");
      return response.json();
    }).then((payload) => {
      const notes = Array.isArray(payload?.notes) ? payload.notes.filter(isNote) : [];
      const next = {
        status: payload?.status === "no-workspace" ? "empty" : "ready",
        notes,
        message: payload?.status === "no-workspace" ? "\u5F53\u524D\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u533A" : ""
      };
      noteCache.set(sessionId, { at: Date.now(), ...next });
      if (!controller.signal.aborted) setIndex(next);
    }).catch((error) => {
      if (controller.signal.aborted) return;
      setIndex({ status: "error", notes: [], message: "\u7B14\u8BB0\u540D\u79F0\u6682\u65F6\u8BFB\u4E0D\u51FA\u6765" });
      console.error("[wikilink-completion]", error);
    });
    return () => controller.abort();
  }, [open, sessionId]);
  const ranked = (0, import_react.useMemo)(
    () => trigger ? rankNotes(index.notes, trigger.query, 8) : [],
    [index.notes, trigger]
  );
  (0, import_react.useEffect)(() => {
    setActive(0);
  }, [trigger?.query]);
  const pick = (link) => {
    if (!trigger || typeof inputActions?.setDraft !== "function") return;
    inputActions.setDraft(replaceTrigger(draft, trigger, link));
  };
  (0, import_react.useEffect)(() => {
    if (!open) return void 0;
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
  (0, import_react.useEffect)(() => {
    if (!open) return void 0;
    const onPointer = (event) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".wlc-menu") === null) {
        setSuppressed(true);
      }
    };
    document.addEventListener("mousedown", onPointer, true);
    return () => document.removeEventListener("mousedown", onPointer, true);
  }, [open]);
  const [box, setBox] = (0, import_react.useState)(null);
  (0, import_react.useEffect)(() => {
    if (!open) return void 0;
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
    onPick: pick
  });
  return (0, import_react_dom.createPortal)(
    /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        className: "wlc-menu",
        role: "listbox",
        "aria-label": "\u7B14\u8BB0\u540D\u79F0",
        style: { left: box.left, width: box.width, bottom: box.bottom }
      },
      body
    ),
    document.body
  );
}
function renderMenu({ ranked, active, status, message, onHover, onPick }) {
  if (!ranked.length && (status === "loading" || status === "idle")) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "wlc-empty" }, "\u6B63\u5728\u8BFB\u53D6\u7B14\u8BB0\u540D\u79F0\u2026");
  }
  if (status === "error" || status === "empty") return /* @__PURE__ */ import_react.default.createElement("div", { className: "wlc-empty" }, message);
  if (ranked.length === 0) return /* @__PURE__ */ import_react.default.createElement("div", { className: "wlc-empty" }, "\u6CA1\u6709\u5339\u914D\u7684\u7B14\u8BB0");
  return /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, ranked.map((item, index) => /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      key: item.note.link,
      type: "button",
      role: "option",
      "aria-selected": index === active,
      className: "wlc-item",
      "data-active": index === active ? "true" : "false",
      onMouseDown: (event) => {
        event.preventDefault();
        onPick(item.note.link);
      },
      onMouseEnter: () => onHover(index)
    },
    /* @__PURE__ */ import_react.default.createElement("span", { className: "wlc-mark" }, "[["),
    /* @__PURE__ */ import_react.default.createElement("span", { className: "wlc-copy" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "wlc-name" }, item.note.name), /* @__PURE__ */ import_react.default.createElement("span", { className: "wlc-meta" }, item.note.folder ? item.note.folder : "\u5DE5\u4F5C\u533A", item.hint ? ` \xB7 ${item.hint}` : "", item.note.link !== item.note.name ? ` \xB7 ${item.note.link}` : ""))
  )), /* @__PURE__ */ import_react.default.createElement("div", { className: "wlc-hint" }, "\u2191\u2193 \u9009\u62E9 \xB7 Enter \u63D2\u5165 \xB7 Esc \u5173\u95ED"));
}
function readCache(sessionId) {
  const hit = sessionId ? noteCache.get(sessionId) : void 0;
  if (!hit || Date.now() - hit.at > 15e3) {
    return { status: "idle", notes: [], message: "" };
  }
  return { status: hit.status, notes: hit.notes, message: hit.message };
}
function isNote(value) {
  return value && typeof value === "object" && typeof value.name === "string" && typeof value.link === "string" && value.name.length > 0 && value.link.length > 0 && value.link.length < 300;
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
return module.exports;
} });
