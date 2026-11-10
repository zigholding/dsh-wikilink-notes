// src/complete/index-notes.js
import { opendir, open, realpath } from "node:fs/promises";
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
  const found = [];
  const queue = [resolved];
  let truncated = false;
  while (queue.length > 0 && !truncated) {
    signal?.throwIfAborted();
    const dir = queue.shift();
    if (dir === void 0) break;
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      continue;
    }
    try {
      for (; ; ) {
        const dirent = await handle.read();
        if (dirent === null) break;
        signal?.throwIfAborted();
        if (dirent.isSymbolicLink()) continue;
        if (dirent.name.startsWith(".")) continue;
        const child = join(dir, dirent.name);
        if (dirent.isDirectory()) {
          if (IGNORE.has(dirent.name)) continue;
          queue.push(child);
          continue;
        }
        if (!dirent.isFile()) continue;
        const ext = extname(dirent.name).toLowerCase();
        if (ext !== ".md" && ext !== ".markdown") continue;
        const name2 = basename(dirent.name, extname(dirent.name));
        if (!name2 || name2.length > 180) continue;
        const rel = relative(resolved, child).split(sep).join("/");
        if (rel.startsWith("..") || rel.includes("/../")) continue;
        const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        const meta = await readMeta(child, signal);
        found.push({ name: name2, folder, relative: rel, aliases: meta.aliases, heading: meta.heading });
        if (found.length >= maxNotes) {
          truncated = true;
          break;
        }
      }
    } finally {
      await handle.close();
    }
  }
  return { notes: assignLinks(found), truncated };
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
      aliases
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

// src/host/entry.js
var name = "dsh-wikilink-completion";
var inject = ["webServer", "sessions"];
var CACHE_MS = 15e3;
var cache = /* @__PURE__ */ new Map();
function apply(ctx, config = {}) {
  const maxNotes = clampLimit(config.maxNotes);
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: "exact",
      path: "/api/wikilink-completion/notes",
      handler: (req, res) => handleNotes(ctx, req, res, maxNotes)
    });
    return () => {
      if (typeof dispose === "function") dispose();
    };
  }, "wikilink-completion: notes route");
}
function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8e3;
  return Math.min(2e4, Math.max(1, Math.floor(parsed)));
}
async function handleNotes(ctx, req, res, maxNotes) {
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
  const cwd = sessionCwd(ctx, sessionId);
  if (cwd === null) {
    send(res, 200, { notes: [], truncated: false, status: "no-workspace" });
    return;
  }
  try {
    const indexed = await cachedNotes(cwd, maxNotes);
    send(res, 200, { notes: indexed.notes, truncated: indexed.truncated, status: "ready" });
  } catch (error) {
    ctx.logger?.warn?.(error);
    send(res, 500, { error: "index-failed" });
  }
}
async function cachedNotes(cwd, maxNotes) {
  const hit = cache.get(cwd);
  const now = Date.now();
  if (hit && hit.maxNotes === maxNotes && now - hit.at < CACHE_MS) return hit.value;
  const value = await listNotes(cwd, { maxNotes });
  cache.set(cwd, { at: now, maxNotes, value });
  if (cache.size > 40) {
    const oldest = cache.keys().next().value;
    if (oldest !== void 0) cache.delete(oldest);
  }
  return value;
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
  inject,
  name
};
