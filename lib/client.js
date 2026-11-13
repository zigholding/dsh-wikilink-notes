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
var import_react2 = __toESM(require("react"), 1);
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
  const vaultScore = Math.min(scoreField(note.vault ?? "", term), 420);
  if (vaultScore > score) score = vaultScore;
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
function replaceTrigger(text, trigger, link, origin = "") {
  const safe = sanitizeLink(link);
  const from = sanitizeOrigin(origin);
  const suffix = from ? `(from ${from})` : "";
  return insertRendered(text, trigger, `[[${safe}]]${suffix}`);
}
function insertRendered(text, trigger, rendered) {
  const safe = String(rendered).replace(/[\n\r]/gu, "").trim();
  return `${text.slice(0, trigger.start)}${safe}${text.slice(trigger.end)}`;
}
function sanitizeLink(link) {
  return String(link).replace(/[\[\]\n\r]/g, "").trim();
}
function sanitizeOrigin(origin) {
  return String(origin).replace(/[()[\]\n\r]/g, "").trim();
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

// src/complete/format.js
var DEFAULT_LINK_FORMAT = "[[${name}]](from ${mcp})";
function checkFormat(value) {
  if (value === void 0 || value === null || value === "") {
    return { ok: true, format: DEFAULT_LINK_FORMAT };
  }
  const format = String(value).replaceAll("\0", "").trim();
  if (!format) return { ok: true, format: DEFAULT_LINK_FORMAT };
  if (format.length > 200) return { ok: false, error: "\u63D2\u5165\u683C\u5F0F\u592A\u957F" };
  if (/[\r\n]/u.test(format)) return { ok: false, error: "\u63D2\u5165\u683C\u5F0F\u4E0D\u80FD\u6362\u884C" };
  if (!format.includes("${name}")) return { ok: false, error: "\u63D2\u5165\u683C\u5F0F\u91CC\u8981\u6709 ${name}" };
  return { ok: true, format };
}
function normalizeFormat(value) {
  const checked = checkFormat(value);
  return checked.ok ? checked.format : DEFAULT_LINK_FORMAT;
}
function formatLink(template, note) {
  const format = normalizeFormat(template);
  const name = String(note.name ?? "").replace(/[\r\n]/gu, "").trim();
  const mcp = String(note.mcp ?? "").replace(/[\r\n]/gu, "").trim();
  let rendered = format.replaceAll("${name}", name).replaceAll("${mcp}", mcp);
  if (!mcp) rendered = rendered.replace(/[ \t]*\(from\s*\)/gu, "");
  return rendered.trim();
}
function renderInsertion(template, note) {
  const mcp = String(note.mcp ?? note.origin ?? "").replace(/[\r\n]/gu, "").trim();
  if (!mcp) return `[[${sanitizeLink(note.link || note.name || "")}]]`;
  return formatLink(template, { name: note.name || note.link || "", mcp });
}

// src/client/settings.jsx
var import_react = __toESM(require("react"), 1);
var EMPTY = {
  includeWorkspace: true,
  vaults: [],
  noteChains: [],
  linkFormat: DEFAULT_LINK_FORMAT,
  discovered: []
};
var SettingsBoundary = class extends import_react.default.Component {
  constructor(props) {
    super(props);
    this.state = { error: "" };
  }
  static getDerivedStateFromError(error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  render() {
    if (this.state.error) {
      return import_react.default.createElement("p", { className: "wlc-settings-error" }, `\u53CC\u94FE\u8865\u5168\u8BBE\u7F6E\u6CA1\u6709\u6253\u5F00\uFF1A${this.state.error}`);
    }
    return import_react.default.createElement(SettingsSection);
  }
};
function SettingsSection() {
  const [settings, setSettings] = (0, import_react.useState)(EMPTY);
  const [text, setText] = (0, import_react.useState)("");
  const [services, setServices] = (0, import_react.useState)("");
  const [format, setFormat] = (0, import_react.useState)(DEFAULT_LINK_FORMAT);
  const [dirty, setDirty] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const [busy, setBusy] = (0, import_react.useState)(false);
  (0, import_react.useEffect)(() => installSettingsStyles(), []);
  (0, import_react.useEffect)(() => {
    let gone = false;
    fetch("/api/wikilink-completion/settings").then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "\u8BBE\u7F6E\u8BFB\u4E0D\u51FA\u6765");
      if (!gone) setSettings(normalize(payload));
    }).catch((reason) => {
      if (!gone) setError(reason instanceof Error ? reason.message : "\u8BBE\u7F6E\u8BFB\u4E0D\u51FA\u6765");
    });
    return () => {
      gone = true;
    };
  }, []);
  (0, import_react.useEffect)(() => {
    if (!dirty) {
      setText(settings.vaults.join("\n"));
      setServices(settings.noteChains.join("\n"));
      setFormat(settings.linkFormat || DEFAULT_LINK_FORMAT);
    }
  }, [settings.vaults, settings.noteChains, settings.linkFormat, dirty]);
  function lines(value) {
    return value.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  }
  async function save(next) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/wikilink-completion/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          includeWorkspace: next.includeWorkspace,
          vaults: next.vaults,
          noteChains: next.noteChains,
          linkFormat: next.linkFormat
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "\u6CA1\u6709\u4FDD\u5B58");
      setSettings(normalize(payload));
      window.dispatchEvent(new Event("wlc-settings-saved"));
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "\u6CA1\u6709\u4FDD\u5B58");
      return false;
    } finally {
      setBusy(false);
    }
  }
  const unused = settings.discovered.filter((path) => !settings.vaults.includes(path));
  return /* @__PURE__ */ import_react.default.createElement("section", { className: "wlc-settings" }, /* @__PURE__ */ import_react.default.createElement("h3", { className: "wlc-settings-title" }, "\u53CC\u94FE\u8865\u5168"), /* @__PURE__ */ import_react.default.createElement("p", { className: "wlc-settings-lead" }, "\u8F93\u5165 ", /* @__PURE__ */ import_react.default.createElement("code", null, "[["), " \u65F6\u6309\u8FD9\u4E9B\u6765\u6E90\u8865\u5168\u7B14\u8BB0\u540D\u3002\u672C\u673A\u4ED3\u5E93\u6BCF\u884C\u4E00\u4E2A\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u76EE\u5F55\u91CC\u8981\u6709 ", /* @__PURE__ */ import_react.default.createElement("code", null, ".obsidian"), "\u3002\u53E6\u4E00\u53F0\u7535\u8111\u4E0A\u7684 Obsidian \u586B\u5199 NoteChain \u7684 ", /* @__PURE__ */ import_react.default.createElement("code", null, "/mcp"), " \u5730\u5740\u3002"), /* @__PURE__ */ import_react.default.createElement("label", { className: "wlc-check" }, /* @__PURE__ */ import_react.default.createElement(
    "input",
    {
      type: "checkbox",
      checked: settings.includeWorkspace,
      disabled: busy,
      onChange: (event) => save({
        includeWorkspace: event.target.checked,
        vaults: lines(text),
        noteChains: lines(services),
        linkFormat: format
      })
    }
  ), "\u540C\u65F6\u5305\u542B\u5F53\u524D\u5DE5\u4F5C\u533A"), /* @__PURE__ */ import_react.default.createElement(
    "form",
    {
      className: "wlc-paths",
      onSubmit: (event) => {
        event.preventDefault();
        save({
          includeWorkspace: settings.includeWorkspace,
          vaults: lines(text),
          noteChains: lines(services),
          linkFormat: format
        }).then((saved) => {
          if (saved) setDirty(false);
        });
      }
    },
    /* @__PURE__ */ import_react.default.createElement(
      "textarea",
      {
        value: text,
        rows: 4,
        spellCheck: false,
        "aria-label": "Obsidian \u4ED3\u5E93\u8DEF\u5F84",
        placeholder: "D:\\Notes\\\u5DE5\u4F5C\nD:\\Notes\\\u751F\u6D3B",
        onChange: (event) => {
          setDirty(true);
          setText(event.target.value);
        }
      }
    ),
    /* @__PURE__ */ import_react.default.createElement(
      "textarea",
      {
        value: services,
        rows: 3,
        spellCheck: false,
        "aria-label": "NoteChain \u670D\u52A1\u5730\u5740",
        placeholder: "http://192.168.1.8:3000/mcp",
        onChange: (event) => {
          setDirty(true);
          setServices(event.target.value);
        }
      }
    ),
    /* @__PURE__ */ import_react.default.createElement("label", { className: "wlc-format-label", htmlFor: "wlc-link-format" }, "NoteChain \u63D2\u5165\u683C\u5F0F"),
    /* @__PURE__ */ import_react.default.createElement(
      "input",
      {
        id: "wlc-link-format",
        value: format,
        spellCheck: false,
        "aria-label": "\u63D2\u5165\u683C\u5F0F",
        placeholder: DEFAULT_LINK_FORMAT,
        onChange: (event) => {
          setDirty(true);
          setFormat(event.target.value);
        }
      }
    ),
    /* @__PURE__ */ import_react.default.createElement("p", { className: "wlc-settings-lead" }, "\u53EA\u4F5C\u7528\u4E8E NoteChain \u7B14\u8BB0\u3002", /* @__PURE__ */ import_react.default.createElement("code", null, "${name}"), " \u662F\u7B14\u8BB0\u540D\uFF0C", /* @__PURE__ */ import_react.default.createElement("code", null, "${mcp}"), " \u662F MCP \u5730\u5740\u3002\u672C\u673A\u548C\u5DE5\u4F5C\u533A\u7B14\u8BB0\u4ECD\u63D2\u5165 ", /* @__PURE__ */ import_react.default.createElement("code", null, "[[\u7B14\u8BB0\u540D]]"), "\u3002"),
    /* @__PURE__ */ import_react.default.createElement("button", { type: "submit", disabled: busy }, "\u4FDD\u5B58")
  ), unused.length > 0 ? /* @__PURE__ */ import_react.default.createElement("div", { className: "wlc-discovered" }, /* @__PURE__ */ import_react.default.createElement("span", null, "\u672C\u673A Obsidian \u91CC\u8FD8\u6709\u8FD9\u4E9B\u5E93"), unused.map((path) => /* @__PURE__ */ import_react.default.createElement(
    "button",
    {
      key: path,
      type: "button",
      disabled: busy,
      onClick: () => {
        setDirty(true);
        setText((current) => current.trim().length === 0 ? path : `${current.replace(/\s+$/u, "")}
${path}`);
      }
    },
    "\u586B\u5165 ",
    path
  ))) : null, error ? /* @__PURE__ */ import_react.default.createElement("p", { className: "wlc-settings-error" }, error) : null);
}
function normalize(payload) {
  return {
    includeWorkspace: payload?.includeWorkspace !== false,
    vaults: Array.isArray(payload?.vaults) ? payload.vaults.filter((item) => typeof item === "string") : [],
    noteChains: Array.isArray(payload?.noteChains) ? payload.noteChains.filter((item) => typeof item === "string") : [],
    linkFormat: typeof payload?.linkFormat === "string" && payload.linkFormat.includes("${name}") ? payload.linkFormat : DEFAULT_LINK_FORMAT,
    discovered: Array.isArray(payload?.discovered) ? payload.discovered.filter((item) => typeof item === "string") : []
  };
}
function installSettingsStyles() {
  const id = "dsh-wikilink-completion-settings";
  if (document.getElementById(id)) return void 0;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
.wlc-settings { display: flex; flex-direction: column; gap: 12px; max-width: 640px; width: 100%; }
.wlc-settings-title { margin: 0; font-size: 14px; font-weight: 600; }
.wlc-settings-lead, .wlc-settings-muted { color: var(--dsw-alias-fg-muted, rgba(246, 241, 232, 0.62)); font-size: 13px; margin: 0; }
.wlc-settings code { font-family: ui-monospace, monospace; }
.wlc-check { display: flex; gap: 8px; align-items: center; }
.wlc-paths { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.wlc-format-label { font-size: 13px; }
.wlc-paths input {
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border, rgba(255, 244, 224, 0.14));
  background: transparent;
  color: inherit;
  padding: 8px 10px;
  font: 13px/1.45 ui-monospace, "Sarasa Mono SC", monospace;
}
.wlc-paths textarea {
  width: 100%;
  box-sizing: border-box;
  resize: vertical;
  min-height: 96px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border, rgba(255, 244, 224, 0.14));
  background: transparent;
  color: inherit;
  padding: 8px 10px;
  font: 13px/1.45 ui-monospace, "Sarasa Mono SC", monospace;
}
.wlc-discovered { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.wlc-settings button {
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border, rgba(255, 244, 224, 0.14));
  background: transparent;
  color: inherit;
  padding: 6px 10px;
  align-self: flex-start;
}
.wlc-settings-error { color: var(--dsw-alias-danger, #e07a5f); font-size: 13px; margin: 0; }
`;
  document.head.appendChild(style);
  return () => style.remove();
}

// src/client/entry.jsx
var STYLE_ID = "dsh-wikilink-completion-style";
var CACHE_MS = 6e4;
var REVALIDATE_MS = 750;
var noteCache = /* @__PURE__ */ new Map();
var inflight = /* @__PURE__ */ new Map();
var cacheEpoch = 0;
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
  ctx.slots.inject(
    "settings.general.item",
    () => ctx.slots.register(
      { name: "settings.general.item", id: "wikilink-completion", order: 30 },
      () => import_react2.default.createElement(SettingsBoundary)
    )
  );
  ctx.slots.inject(
    "settings.section",
    () => ctx.slots.register(
      {
        name: "settings.section",
        id: "wikilink-completion",
        order: 48,
        label: () => "\u53CC\u94FE\u8865\u5168"
      },
      () => import_react2.default.createElement(SettingsBoundary)
    )
  );
}
function Picker({ sessionId, useInput, inputActions }) {
  const input = useInput((state) => state);
  const draft = typeof input?.draft === "string" ? input.draft : "";
  const [caret, setCaret] = (0, import_react2.useState)(draft.length);
  const [suppressed, setSuppressed] = (0, import_react2.useState)(false);
  const [active, setActive] = (0, import_react2.useState)(0);
  const [index, setIndex] = (0, import_react2.useState)(() => readCache(sessionId));
  const [reload, setReload] = (0, import_react2.useState)(0);
  (0, import_react2.useEffect)(() => {
    setSuppressed(false);
  }, [draft]);
  (0, import_react2.useEffect)(() => {
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
  (0, import_react2.useEffect)(() => {
    const refresh = () => {
      cacheEpoch += 1;
      noteCache.clear();
      inflight.clear();
      setIndex({ status: "idle", notes: [], message: "" });
      setReload((current) => current + 1);
    };
    window.addEventListener("wlc-settings-saved", refresh);
    return () => window.removeEventListener("wlc-settings-saved", refresh);
  }, []);
  (0, import_react2.useEffect)(() => {
    if (!sessionId) return void 0;
    let alive = true;
    ensureNotes(sessionId, (next) => {
      if (alive) setIndex((current) => keepNotes(current, next));
    }, true);
    return () => {
      alive = false;
    };
  }, [sessionId, reload]);
  const trigger = (0, import_react2.useMemo)(() => findOpenTrigger(draft, caret), [draft, caret]);
  const open = !suppressed && trigger !== null && input !== void 0;
  (0, import_react2.useEffect)(() => {
    if (!open || !sessionId) return void 0;
    let alive = true;
    const pull = () => {
      ensureNotes(sessionId, (next) => {
        if (alive) setIndex((current) => keepNotes(current, next));
      }, true);
    };
    pull();
    const timer = setInterval(pull, 3e3);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [open, sessionId]);
  const ranked = (0, import_react2.useMemo)(
    () => trigger ? rankNotes(index.notes, trigger.query, 8) : [],
    [index.notes, trigger]
  );
  (0, import_react2.useEffect)(() => {
    setActive(0);
  }, [trigger?.query]);
  const pick = (note) => {
    if (!trigger || typeof inputActions?.setDraft !== "function") return;
    const rendered = typeof note.insert === "string" && note.insert.trim() ? note.insert : renderInsertion("[[${name}]](from ${mcp})", note);
    inputActions.setDraft(insertRendered(draft, trigger, rendered) || replaceTrigger(draft, trigger, note.link, note.origin));
  };
  (0, import_react2.useEffect)(() => {
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
        if (hit) pick(hit.note);
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setSuppressed(true);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, ranked, active, trigger, draft, inputActions]);
  (0, import_react2.useEffect)(() => {
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
  const [box, setBox] = (0, import_react2.useState)(null);
  (0, import_react2.useEffect)(() => {
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
    /* @__PURE__ */ import_react2.default.createElement(
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
    return /* @__PURE__ */ import_react2.default.createElement("div", { className: "wlc-empty" }, "\u6B63\u5728\u8BFB\u53D6\u7B14\u8BB0\u540D\u79F0\u2026");
  }
  if (status === "error" || status === "empty") return /* @__PURE__ */ import_react2.default.createElement("div", { className: "wlc-empty" }, message);
  if (ranked.length === 0) return /* @__PURE__ */ import_react2.default.createElement("div", { className: "wlc-empty" }, message || "\u6CA1\u6709\u5339\u914D\u7684\u7B14\u8BB0");
  return /* @__PURE__ */ import_react2.default.createElement(import_react2.default.Fragment, null, ranked.map((item, index) => /* @__PURE__ */ import_react2.default.createElement(
    "button",
    {
      key: `${item.note.origin ?? ""}:${item.note.link}`,
      type: "button",
      role: "option",
      "aria-selected": index === active,
      className: "wlc-item",
      "data-active": index === active ? "true" : "false",
      onMouseDown: (event) => {
        event.preventDefault();
        onPick(item.note);
      },
      onMouseEnter: () => onHover(index)
    },
    /* @__PURE__ */ import_react2.default.createElement("span", { className: "wlc-mark" }, "[["),
    /* @__PURE__ */ import_react2.default.createElement("span", { className: "wlc-copy" }, /* @__PURE__ */ import_react2.default.createElement("span", { className: "wlc-name" }, item.note.name), /* @__PURE__ */ import_react2.default.createElement("span", { className: "wlc-meta" }, [item.note.vault, item.note.folder].filter(Boolean).join(" / ") || "\u5DE5\u4F5C\u533A", item.hint ? ` \xB7 ${item.hint}` : "", item.note.link !== item.note.name ? ` \xB7 ${item.note.link}` : ""))
  )), /* @__PURE__ */ import_react2.default.createElement("div", { className: "wlc-hint" }, "\u2191\u2193 \u9009\u62E9 \xB7 Enter \u63D2\u5165 \xB7 Esc \u5173\u95ED"));
}
function indexMessage(payload) {
  if (payload?.status === "no-workspace") {
    return "\u8FD9\u4E2A\u4F1A\u8BDD\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u533A\u3002\u53EF\u4EE5\u5728\u8BBE\u7F6E \u2192 \u53CC\u94FE\u8865\u5168\u91CC\u6DFB\u52A0 Obsidian \u4ED3\u5E93\u3002";
  }
  if (payload?.status === "no-vaults") {
    return "\u8FD8\u6CA1\u6709\u7B14\u8BB0\u6765\u6E90\u3002\u6253\u5F00\u8BBE\u7F6E \u2192 \u53CC\u94FE\u8865\u5168\uFF0C\u6DFB\u52A0 Obsidian \u4ED3\u5E93\u3002";
  }
  const warning = Array.isArray(payload?.warnings) ? payload.warnings.find((item) => typeof item === "string") : "";
  return warning || "";
}
function keepNotes(current, next) {
  if ((next.status === "loading" || next.status === "error") && current.notes.length > 0) {
    return next.status === "error" ? { ...current, message: next.message } : current;
  }
  return next;
}
function readCache(sessionId) {
  const hit = sessionId ? noteCache.get(sessionId) : void 0;
  if (!hit || Date.now() - hit.at > CACHE_MS) {
    return { status: "idle", notes: [], message: "" };
  }
  return { status: hit.status, notes: hit.notes, message: hit.message };
}
function ensureNotes(sessionId, onUpdate, revalidate = false) {
  const generation = cacheEpoch;
  const hit = sessionId ? noteCache.get(sessionId) : void 0;
  const cached = readCache(sessionId);
  const usable = cached.status === "ready" || cached.status === "empty";
  if (usable) onUpdate(cached);
  else onUpdate({ status: "loading", notes: [], message: "" });
  if (usable && !revalidate) return;
  if (usable && hit && Date.now() - hit.at < REVALIDATE_MS) return;
  let job = inflight.get(sessionId);
  if (!job) {
    const url = `/api/wikilink-completion/notes?sessionId=${encodeURIComponent(sessionId)}`;
    job = fetch(url, { headers: { accept: "application/json" } }).then(async (response) => {
      if (!response.ok) throw new Error("notes-unavailable");
      return response.json();
    }).then((payload) => {
      const notes = Array.isArray(payload?.notes) ? payload.notes.filter(isNote) : [];
      const next = {
        status: payload?.status === "no-workspace" || payload?.status === "no-vaults" ? "empty" : "ready",
        notes,
        message: indexMessage(payload)
      };
      if (generation === cacheEpoch) noteCache.set(sessionId, { at: Date.now(), ...next });
      return next;
    }).catch((error) => {
      console.error("[wikilink-completion]", error);
      return { status: "error", notes: [], message: "\u7B14\u8BB0\u540D\u79F0\u6682\u65F6\u8BFB\u4E0D\u51FA\u6765" };
    }).finally(() => {
      if (inflight.get(sessionId) === job) inflight.delete(sessionId);
    });
    inflight.set(sessionId, job);
  }
  job.then((next) => {
    if (generation === cacheEpoch) onUpdate(next);
  });
}
function isNote(value) {
  return value && typeof value === "object" && typeof value.name === "string" && typeof value.link === "string" && value.name.length > 0 && value.link.length > 0 && value.link.length < 300 && (value.origin === void 0 || typeof value.origin === "string" && value.origin.length < 120) && (value.insert === void 0 || typeof value.insert === "string" && value.insert.length < 400);
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
