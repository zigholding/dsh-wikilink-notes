// src/host/entry.js
import { realpath as realpath3 } from "node:fs/promises";
import { basename as basename3 } from "node:path";

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
  for (const note of notes) counts.set(note.name, (counts.get(note.name) ?? 0) + 1);
  return notes.map((note) => {
    if ((counts.get(note.name) ?? 0) <= 1) return note;
    const vault = note.vault?.trim() || "\u5DE5\u4F5C\u533A";
    const prefix = `${vault}/`;
    if (note.link.startsWith(prefix)) return { ...note, vault };
    return { ...note, vault, link: `${vault}/${note.link}` };
  });
}

// src/host/store.js
import { mkdir, readFile, realpath as realpath2, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename as basename2, dirname, isAbsolute, join as join2 } from "node:path";
var MAX_VAULTS = 16;
var DEFAULT_SETTINGS = Object.freeze({
  includeWorkspace: true,
  vaults: Object.freeze([])
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
    return { includeWorkspace: true, vaults: [] };
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
  return { includeWorkspace, vaults };
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
    vaults: Array.isArray(payload?.vaults) ? payload.vaults : []
  };
  if (draft.vaults.length > 16) {
    send(res, 400, { error: "\u6700\u591A\u6DFB\u52A0 16 \u4E2A\u4ED3\u5E93" });
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
  const saved = await writeSettings(file, { includeWorkspace: draft.includeWorkspace, vaults });
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
  for (const path of settings.vaults) {
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
  if (sources.length === 0) {
    return {
      notes: [],
      truncated: false,
      warnings,
      status: settings.includeWorkspace ? "no-workspace" : "no-vaults",
      includeWorkspace: settings.includeWorkspace,
      vaults: settings.vaults
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
  return {
    notes: qualifyNames(notes),
    truncated,
    warnings,
    status: "ready",
    includeWorkspace: settings.includeWorkspace,
    vaults: settings.vaults
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
