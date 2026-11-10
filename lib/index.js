// src/host/entry.js
import { realpath as realpath3 } from "node:fs/promises";
import { basename as basename3 } from "node:path";

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
  const name2 = String(note.name ?? "").replace(/[\r\n]/gu, "").trim();
  const mcp = String(note.mcp ?? "").replace(/[\r\n]/gu, "").trim();
  let rendered = format.replaceAll("${name}", name2).replaceAll("${mcp}", mcp);
  if (!mcp) rendered = rendered.replace(/[ \t]*\(from\s*\)/gu, "");
  return rendered.trim();
}

// src/complete/index-notes.js
import { open, readdir, realpath } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";
var IGNORE = /* @__PURE__ */ new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".obsidian",
  ".dsh",
  "coverage"
]);
async function listNotes(root, options = {}) {
  const maxNotes = options.maxNotes ?? 8e3;
  const signal = options.signal;
  const resolved = await realpath(root);
  const files = [];
  const queue = [resolved];
  let truncated = false;
  while (queue.length > 0 && !truncated) {
    signal?.throwIfAborted();
    const batch = queue.splice(0, 24);
    const listings = await Promise.all(batch.map(async (dir) => {
      try {
        return { dir, entries: await readdir(dir, { withFileTypes: true }) };
      } catch {
        return { dir, entries: [] };
      }
    }));
    for (const { dir, entries } of listings) {
      for (const dirent of entries) {
        if (dirent.isSymbolicLink() || dirent.name.startsWith(".")) continue;
        const child = join(dir, dirent.name);
        if (dirent.isDirectory()) {
          if (!IGNORE.has(dirent.name)) queue.push(child);
          continue;
        }
        if (!dirent.isFile()) continue;
        const ext = extname(dirent.name).toLowerCase();
        if (ext !== ".md" && ext !== ".markdown") continue;
        const name2 = basename(dirent.name, ext);
        if (!name2 || name2.length > 180) continue;
        const rel = relative(resolved, child).split(sep).join("/");
        if (rel.startsWith("..") || rel.includes("/../")) continue;
        const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        files.push({ name: name2, folder, relative: rel, path: child });
        if (files.length >= maxNotes) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
  }
  const found = await mapPool(files, 32, async (file) => {
    const meta = await readMeta(file.path, signal);
    return { name: file.name, folder: file.folder, relative: file.relative, aliases: meta.aliases, heading: meta.heading };
  });
  return { notes: assignLinks(found), truncated };
}
async function mapPool(items, limit, run) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}
function assignLinks(files) {
  const counts = /* @__PURE__ */ new Map();
  for (const file of files) counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
  return files.map((file) => {
    const stem = file.relative.replace(/\.(?:md|markdown)$/iu, "");
    const link = (counts.get(file.name) ?? 0) > 1 ? stem : file.name;
    const aliases = [];
    for (const alias of file.aliases) pushAlias(aliases, alias, file.name, link);
    if (file.heading) pushAlias(aliases, file.heading, file.name, link);
    return {
      name: file.name,
      link,
      folder: file.folder,
      aliases,
      vault: file.vault || ""
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "zh"));
}
function pushAlias(aliases, value, name2, link) {
  const alias = value.trim();
  if (!alias || alias === name2 || alias === link || aliases.includes(alias)) return;
  if (aliases.length >= 12) return;
  aliases.push(alias);
}
async function readMeta(path, signal) {
  try {
    const text = await readHead(path, 4096, signal);
    return parseMeta(text);
  } catch {
    return { aliases: [], heading: "" };
  }
}
async function readHead(path, bytes, signal) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    const slice = buffer.subarray(0, bytesRead);
    if (slice.includes(0)) return "";
    return slice.toString("utf8");
  } finally {
    await handle.close();
    signal?.throwIfAborted();
  }
}
function parseMeta(text) {
  const aliases = [];
  let heading = "";
  const lines = text.split(/\r?\n/u);
  let inFrontmatter = lines[0]?.trim() === "---";
  let aliasList = false;
  for (let i = inFrontmatter ? 1 : 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (inFrontmatter) {
      if (line.trim() === "---") {
        inFrontmatter = false;
        aliasList = false;
        continue;
      }
      const key = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/u.exec(line);
      if (key) {
        aliasList = key[1] === "aliases" || key[1] === "alias";
        collectInline(aliases, key[1], key[2] ?? "");
        continue;
      }
      if (aliasList) {
        const item = /^\s*-\s+(.+)$/u.exec(line);
        if (item) collectScalar(aliases, item[1] ?? "");
      }
      continue;
    }
    const title = /^#\s+(.+)$/u.exec(line);
    if (title) {
      heading = cleanScalar(title[1] ?? "");
      break;
    }
    if (line.trim()) break;
  }
  return { aliases, heading };
}
function collectInline(aliases, key, raw) {
  if (key !== "aliases" && key !== "alias" && key !== "title") return;
  const value = raw.trim();
  if (!value || value === "|" || value === ">" || value === ">") return;
  if (value.startsWith("[") && value.endsWith("]")) {
    for (const part of value.slice(1, -1).split(",")) collectScalar(aliases, part);
    return;
  }
  if (key === "title") return;
  collectScalar(aliases, value);
}
function collectScalar(aliases, raw) {
  const value = cleanScalar(raw);
  if (!value || aliases.includes(value) || aliases.length >= 12) return;
  aliases.push(value);
}
function cleanScalar(raw) {
  let value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  return value.trim();
}

// src/complete/sources.js
function qualifyNames(notes) {
  const counts = /* @__PURE__ */ new Map();
  for (const note of notes) {
    if (note.origin) continue;
    counts.set(note.name, (counts.get(note.name) ?? 0) + 1);
  }
  return notes.map((note) => {
    if (note.origin) return note;
    if ((counts.get(note.name) ?? 0) <= 1) return note;
    const vault = note.vault?.trim() || "\u5DE5\u4F5C\u533A";
    const prefix = `${vault}/`;
    if (note.link.startsWith(prefix)) return { ...note, vault };
    return { ...note, vault, link: `${vault}/${note.link}` };
  });
}

// src/host/notechain.js
import http from "node:http";
import https from "node:https";
var MAX_BODY = 2e6;
var TIMEOUT_MS = 8e3;
function normalizeServiceUrl(input) {
  const raw = String(input).replaceAll("\0", "").trim();
  if (!raw) return { ok: false, error: "\u5148\u586B\u5199 NoteChain \u5730\u5740" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "\u5730\u5740\u4E0D\u662F\u6709\u6548\u7684\u7F51\u5740" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "\u53EA\u652F\u6301 http \u6216 https" };
  }
  if (url.username || url.password) return { ok: false, error: "\u4E0D\u8981\u628A\u8D26\u53F7\u5199\u8FDB\u5730\u5740" };
  if (!url.hostname || url.hostname === "169.254.169.254" || url.hostname === "metadata.google.internal") {
    return { ok: false, error: "\u8FD9\u4E2A\u5730\u5740\u4E0D\u80FD\u7528" };
  }
  let path = url.pathname.replace(/\/+$/u, "");
  if (path.endsWith("/sse")) return { ok: false, error: "\u8BF7\u586B\u5199 /mcp \u5730\u5740\uFF0C\u4E0D\u8981\u7528 /sse" };
  if (path.endsWith("/call_tool")) path = path.slice(0, -"/call_tool".length);
  if (path.endsWith("/list_tools")) path = path.slice(0, -"/list_tools".length);
  path = path.replace(/\/+$/u, "");
  if (!path.endsWith("/mcp")) path = `${path}/mcp`;
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return { ok: true, url: url.toString(), label: serviceLabel(url) };
}
function serviceLabel(url) {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const port = parsed.port ? `:${parsed.port}` : "";
  const host = parsed.hostname.includes(":") ? `[${parsed.hostname}]` : parsed.hostname;
  return `${host}${port}`;
}
async function queryNoteChain(serviceUrl, options) {
  const target = new URL(serviceUrl);
  target.pathname = `${target.pathname.replace(/\/$/u, "")}/call_tool`;
  const body = JSON.stringify({
    name: "obsidian_query_by_datacore",
    arguments: {
      query: "@page",
      limit: options.limit
    }
  });
  const request = options.request ?? postJson;
  const text = await request(target, body);
  return notesFromDatacoreText(text).slice(0, options.limit);
}
function notesFromDatacoreText(text) {
  const files = [];
  let value = text;
  if (typeof text === "string") {
    const trimmed = text.trim();
    if (!trimmed) return [];
    try {
      value = JSON.parse(trimmed);
    } catch {
      collectPlain(trimmed, files);
      return assignLinks(files);
    }
  }
  if (value && typeof value === "object" && Array.isArray(value.content)) {
    if (value.isError) {
      const message = value.content.map((block) => block?.text).filter((item) => typeof item === "string").join(" ");
      throw new Error(message || "NoteChain \u67E5\u8BE2\u5931\u8D25");
    }
    for (const block of value.content) {
      if (typeof block?.text === "string") collect(parseMaybe(block.text), files, 0);
    }
    return assignLinks(files);
  }
  collect(value, files, 0);
  return assignLinks(files);
}
function parseMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function collect(value, files, depth) {
  if (value == null || depth > 8 || files.length >= 2e3) return;
  if (typeof value === "string") {
    collectPlain(value, files);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collect(item, files, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const file = fileFromRecord(value);
  if (file) {
    files.push(file);
    return;
  }
  for (const child of Object.values(value)) collect(child, files, depth + 1);
}
function fileFromRecord(value) {
  if ("inputSchema" in value || "mcp_tool" in value) return null;
  const path = firstString(value, ["$path", "path", "file", "filename"]);
  const name2 = firstString(value, ["$name", "basename", "name", "title"]);
  if (!path && !name2) return null;
  const cleanedPath = (path || name2).replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  if (!cleanedPath || cleanedPath.includes("..")) return null;
  const withoutExt = cleanedPath.replace(/\.md$/iu, "");
  const slash = withoutExt.lastIndexOf("/");
  const base = slash >= 0 ? withoutExt.slice(slash + 1) : withoutExt;
  if (!base || base.length > 180) return null;
  const folder = slash >= 0 ? withoutExt.slice(0, slash) : "";
  const aliases = [];
  const rawAliases = value.aliases ?? value.alias;
  if (Array.isArray(rawAliases)) {
    for (const alias of rawAliases) {
      if (typeof alias === "string" && alias.trim() && alias.trim() !== base) aliases.push(alias.trim());
    }
  }
  return {
    name: base,
    folder,
    relative: `${withoutExt}.md`,
    aliases,
    heading: ""
  };
}
function firstString(value, keys) {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return "";
}
function collectPlain(text, files) {
  const pattern = /\[\[([^\]|#\n]{1,180})\]\]/gu;
  for (const match of text.matchAll(pattern)) {
    const file = fileFromRecord({ path: match[1] ?? "" });
    if (file) files.push(file);
    if (files.length >= 2e3) return;
  }
}
function postJson(target, body) {
  return postOnce(target, body, true).catch((error) => {
    const code = error && typeof error === "object" ? error.code : "";
    if (target.protocol === "https:" && isCertificateError(code)) return postOnce(target, body, false);
    throw error;
  });
}
function isCertificateError(code) {
  return code === "DEPTH_ZERO_SELF_SIGNED_CERT" || code === "SELF_SIGNED_CERT_IN_CHAIN" || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || code === "CERT_HAS_EXPIRED";
}
function postOnce(target, body, rejectUnauthorized) {
  const lib = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      },
      rejectUnauthorized,
      timeout: TIMEOUT_MS
    }, (res) => {
      if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
        res.resume();
        reject(new Error("\u5730\u5740\u53D1\u751F\u4E86\u8DF3\u8F6C\uFF0C\u8BF7\u586B\u5199\u6700\u7EC8\u7684 NoteChain \u5730\u5740"));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY) {
          req.destroy(new Error("NoteChain \u8FD4\u56DE\u7684\u5185\u5BB9\u592A\u5927"));
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new Error(`NoteChain \u8FD4\u56DE ${res.statusCode ?? 0}`));
          return;
        }
        resolve(text);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("NoteChain \u6CA1\u6709\u5728 8 \u79D2\u5185\u54CD\u5E94"));
    });
    req.on("error", reject);
    req.end(body);
  });
}

// src/host/store.js
import { mkdir, readFile, realpath as realpath2, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename as basename2, dirname, isAbsolute, join as join2 } from "node:path";
var MAX_VAULTS = 16;
var DEFAULT_SETTINGS = Object.freeze({
  includeWorkspace: true,
  vaults: Object.freeze([]),
  noteChains: Object.freeze([]),
  linkFormat: "[[${name}]](from ${mcp})"
});
function settingsFile(home = dshHome()) {
  return join2(home, "wikilink-completion.json");
}
function dshHome() {
  const configured = process.env.DSH_HOME?.trim();
  return configured || join2(homedir(), ".dsh");
}
async function readSettings(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return normalizeSettings(parsed);
  } catch {
    return { includeWorkspace: true, vaults: [], noteChains: [], linkFormat: normalizeFormat("") };
  }
}
async function writeSettings(file, settings) {
  const normalized = normalizeSettings(settings);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}
`, "utf8");
  await rename(temporary, file);
  return normalized;
}
function normalizeSettings(value) {
  const record = value && typeof value === "object" ? value : {};
  const includeWorkspace = record.includeWorkspace !== false;
  const seen = /* @__PURE__ */ new Set();
  const vaults = [];
  const raw = Array.isArray(record.vaults) ? record.vaults : [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const path = cleanPath(item);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    vaults.push(path);
    if (vaults.length >= MAX_VAULTS) break;
  }
  const seenServices = /* @__PURE__ */ new Set();
  const noteChains = [];
  const services = Array.isArray(record.noteChains) ? record.noteChains : [];
  for (const item of services) {
    if (typeof item !== "string") continue;
    const parsed = normalizeServiceUrl(item);
    if (!parsed.ok || seenServices.has(parsed.url)) continue;
    seenServices.add(parsed.url);
    noteChains.push(parsed.url);
    if (noteChains.length >= 8) break;
  }
  return { includeWorkspace, vaults, noteChains, linkFormat: normalizeFormat(record.linkFormat) };
}
function cleanPath(input) {
  let value = String(input).replaceAll("\0", "").trim();
  if (value.startsWith('"') && value.endsWith('"') || value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1).trim();
  }
  if (value.length > 1 && !/^[A-Za-z]:[\\/]?$/u.test(value)) {
    value = value.replace(/[\\/]+$/u, "");
  }
  if (/^[A-Za-z]:$/u.test(value)) value += "\\";
  return value;
}
async function inspectVault(input) {
  const path = cleanPath(input);
  if (!path) return { ok: false, error: "\u5148\u586B\u5199\u4ED3\u5E93\u8DEF\u5F84" };
  if (!isAbsolute(path)) return { ok: false, error: "\u8BF7\u586B\u5199\u7EDD\u5BF9\u8DEF\u5F84" };
  let resolved;
  try {
    resolved = await realpath2(path);
  } catch {
    return { ok: false, error: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u76EE\u5F55" };
  }
  let info;
  try {
    info = await stat(resolved);
  } catch {
    return { ok: false, error: "\u627E\u4E0D\u5230\u8FD9\u4E2A\u76EE\u5F55" };
  }
  if (!info.isDirectory()) return { ok: false, error: "\u8FD9\u4E0D\u662F\u6587\u4EF6\u5939" };
  try {
    const marker = await stat(join2(resolved, ".obsidian"));
    if (!marker.isDirectory()) throw new Error("missing");
  } catch {
    return { ok: false, error: "\u8FD9\u91CC\u6CA1\u6709 .obsidian\uFF0C\u4E0D\u662F Obsidian \u4ED3\u5E93" };
  }
  return { ok: true, path: resolved, name: basename2(resolved) };
}
async function discoverVaults(configPath) {
  let text;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    return [];
  }
  const found = [];
  for (const path of parseObsidianConfig(text)) {
    const inspected = await inspectVault(path);
    if (inspected.ok && !found.includes(inspected.path)) found.push(inspected.path);
  }
  return found;
}
function parseObsidianConfig(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const vaults = parsed?.vaults;
  if (!vaults || typeof vaults !== "object") return [];
  const paths = [];
  for (const value of Object.values(vaults)) {
    if (value && typeof value === "object" && typeof value.path === "string") paths.push(value.path);
  }
  return paths;
}
function obsidianConfigPath() {
  if (process.platform === "win32") {
    return join2(process.env.APPDATA || join2(homedir(), "AppData", "Roaming"), "obsidian", "obsidian.json");
  }
  if (process.platform === "darwin") {
    return join2(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  }
  return join2(process.env.XDG_CONFIG_HOME || join2(homedir(), ".config"), "obsidian", "obsidian.json");
}

// src/host/entry.js
var name = "dsh-wikilink-completion";
var inject = ["webServer", "sessions"];
var CACHE_MS = 6e4;
var cache = /* @__PURE__ */ new Map();
var pending = /* @__PURE__ */ new Map();
function apply(ctx, config = {}) {
  const maxNotes = clampLimit(config.maxNotes);
  const file = settingsFile();
  ctx.effect(() => {
    const notes = ctx.webServer.register({
      kind: "exact",
      path: "/api/wikilink-completion/notes",
      handler: (req, res) => handleNotes(ctx, req, res, maxNotes, file)
    });
    const settings = ctx.webServer.register({
      kind: "exact",
      path: "/api/wikilink-completion/settings",
      handler: (req, res) => handleSettings(ctx, req, res, file)
    });
    return () => {
      if (typeof notes === "function") notes();
      if (typeof settings === "function") settings();
    };
  }, "wikilink-completion: routes");
}
function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8e3;
  return Math.min(2e4, Math.max(1, Math.floor(parsed)));
}
async function handleNotes(ctx, req, res, maxNotes, file) {
  if (req.method !== "GET") {
    send(res, 405, { error: "method-not-allowed" });
    return;
  }
  if (!isTrusted(ctx, req)) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  const sessionId = readSessionId(req.url);
  if (sessionId === null) {
    send(res, 400, { error: "expected-session" });
    return;
  }
  try {
    const settings = await readSettings(file);
    const indexed = await cachedNotes(settings, sessionCwd(ctx, sessionId), maxNotes);
    send(res, 200, indexed);
  } catch (error) {
    ctx.logger?.warn?.(error);
    send(res, 500, { error: "index-failed" });
  }
}
async function handleSettings(ctx, req, res, file) {
  if (!isTrusted(ctx, req)) {
    send(res, 403, { error: "forbidden" });
    return;
  }
  if (req.method === "GET") {
    const settings = await readSettings(file);
    const discovered = await discoverVaults(obsidianConfigPath());
    send(res, 200, { ...settings, discovered });
    return;
  }
  if (req.method !== "PUT") {
    send(res, 405, { error: "method-not-allowed" });
    return;
  }
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch {
    send(res, 400, { error: "\u8BF7\u6C42\u8BFB\u4E0D\u4E86" });
    return;
  }
  const draft = {
    includeWorkspace: payload?.includeWorkspace !== false,
    vaults: Array.isArray(payload?.vaults) ? payload.vaults : [],
    noteChains: Array.isArray(payload?.noteChains) ? payload.noteChains : [],
    linkFormat: payload?.linkFormat
  };
  const format = checkFormat(draft.linkFormat);
  if (!format.ok) {
    send(res, 400, { error: format.error });
    return;
  }
  if (draft.vaults.length > 16) {
    send(res, 400, { error: "\u6700\u591A\u6DFB\u52A0 16 \u4E2A\u4ED3\u5E93" });
    return;
  }
  if (draft.noteChains.length > 8) {
    send(res, 400, { error: "\u6700\u591A\u6DFB\u52A0 8 \u4E2A NoteChain \u670D\u52A1" });
    return;
  }
  const vaults = [];
  for (const item of draft.vaults) {
    const inspected = await inspectVault(item);
    if (!inspected.ok) {
      send(res, 400, { error: `${item}: ${inspected.error}` });
      return;
    }
    if (!vaults.includes(inspected.path)) vaults.push(inspected.path);
  }
  const noteChains = [];
  for (const item of draft.noteChains) {
    const parsed = normalizeServiceUrl(item);
    if (!parsed.ok) {
      send(res, 400, { error: `${item}: ${parsed.error}` });
      return;
    }
    if (!noteChains.includes(parsed.url)) noteChains.push(parsed.url);
  }
  const saved = await writeSettings(file, {
    includeWorkspace: draft.includeWorkspace,
    vaults,
    noteChains,
    linkFormat: format.format
  });
  cache.clear();
  send(res, 200, { ...saved, discovered: await discoverVaults(obsidianConfigPath()) });
}
async function cachedNotes(settings, cwd, maxNotes) {
  const key = JSON.stringify({ settings, cwd, maxNotes });
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const running = pending.get(key);
  if (running) return running;
  const job = collectNotes(settings, cwd, maxNotes).then((value) => {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 40) {
      const oldest = cache.keys().next().value;
      if (oldest !== void 0) cache.delete(oldest);
    }
    return value;
  }).finally(() => {
    if (pending.get(key) === job) pending.delete(key);
  });
  pending.set(key, job);
  return job;
}
async function collectNotes(settings, cwd, maxNotes) {
  const sources = [];
  const seen = /* @__PURE__ */ new Set();
  const warnings = [];
  for (const path of settings.vaults ?? []) {
    try {
      const root = await realpath3(path);
      if (seen.has(root)) continue;
      seen.add(root);
      sources.push({ vault: basename3(root), root });
    } catch {
      warnings.push(`\u8BFB\u4E0D\u5230\u4ED3\u5E93 ${path}`);
    }
  }
  if (settings.includeWorkspace && cwd) {
    try {
      const root = await realpath3(cwd);
      if (!seen.has(root)) sources.push({ vault: "", root });
    } catch {
      warnings.push("\u5F53\u524D\u5DE5\u4F5C\u533A\u8BFB\u4E0D\u5230");
    }
  }
  const services = Array.isArray(settings.noteChains) ? settings.noteChains : [];
  if (sources.length === 0 && services.length === 0) {
    return {
      notes: [],
      truncated: false,
      warnings,
      status: settings.includeWorkspace ? "no-workspace" : "no-vaults",
      includeWorkspace: settings.includeWorkspace,
      vaults: settings.vaults,
      noteChains: services
    };
  }
  const notes = [];
  let truncated = false;
  for (const source of sources) {
    const label = source.vault || "\u5DE5\u4F5C\u533A";
    try {
      const listed = await listNotes(source.root, { maxNotes: Math.max(1, maxNotes - notes.length) });
      for (const note of listed.notes) notes.push({ ...note, vault: source.vault || note.vault || "" });
      if (listed.truncated || notes.length >= maxNotes) {
        truncated = true;
        break;
      }
    } catch {
      warnings.push(`\u8BFB\u4E0D\u5230${label}\u91CC\u7684\u7B14\u8BB0`);
    }
  }
  for (const service of services) {
    const label = serviceLabel(service);
    if (notes.length >= maxNotes) {
      truncated = true;
      break;
    }
    try {
      const listed = await queryNoteChain(service, { limit: Math.max(1, maxNotes - notes.length) });
      for (const note of listed) notes.push({ ...note, vault: label, origin: label });
    } catch (error) {
      const message = error instanceof Error ? error.message : "\u67E5\u8BE2\u5931\u8D25";
      warnings.push(`${label}\uFF1A${message}`);
    }
  }
  return {
    notes: qualifyNames(notes).map((note) => ({
      ...note,
      insert: formatLink(settings.linkFormat, { name: note.name, mcp: note.origin || "" })
    })),
    truncated,
    warnings,
    status: "ready",
    includeWorkspace: settings.includeWorkspace,
    vaults: settings.vaults,
    noteChains: services
  };
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 65536) throw new Error("too-large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function sessionCwd(ctx, sessionId) {
  const session = ctx.sessions?.get?.(sessionId);
  const cwd = session?.header?.cwd || session?.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  return cwd;
}
function readSessionId(url) {
  try {
    const sessionId = new URL(url ?? "/", "http://localhost").searchParams.get("sessionId");
    if (sessionId === null || !/^[\w.-]{1,200}$/u.test(sessionId)) return null;
    return sessionId;
  } catch {
    return null;
  }
}
function isTrusted(ctx, req) {
  const remote = String(req.socket?.remoteAddress ?? "");
  if (remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1") return true;
  const host = String(req.headers.host ?? "");
  const trusted = ctx.get?.("webRuntime")?.trustedHosts;
  if (!Array.isArray(trusted)) return false;
  return trusted.some((candidate) => host === candidate || host.startsWith(`${candidate}:`));
}
function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}
export {
  apply,
  collectNotes,
  inject,
  name
};
