/**
 * Host half: list markdown note names for the session workspace and for the
 * Obsidian vaults saved in the plugin settings. Vault paths are checked on
 * this side; the browser cannot choose an arbitrary directory at query time.
 */
import { realpath } from "node:fs/promises";
import { basename } from "node:path";
import { listNotes } from "../complete/index-notes.js";
import { qualifyNames } from "../complete/sources.js";
import {
  discoverVaults,
  inspectVault,
  obsidianConfigPath,
  readSettings,
  settingsFile,
  writeSettings,
} from "./store.js";

export const name = "dsh-wikilink-completion";
export const inject = ["webServer", "sessions"];

const CACHE_MS = 60_000;
const cache = new Map();
const pending = new Map();

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {{ maxNotes?: number }} [config]
 */
export function apply(ctx, config = {}) {
  const maxNotes = clampLimit(config.maxNotes);
  const file = settingsFile();
  ctx.effect(() => {
    const notes = ctx.webServer.register({
      kind: "exact",
      path: "/api/wikilink-completion/notes",
      handler: (req, res) => handleNotes(ctx, req, res, maxNotes, file),
    });
    const settings = ctx.webServer.register({
      kind: "exact",
      path: "/api/wikilink-completion/settings",
      handler: (req, res) => handleSettings(ctx, req, res, file),
    });
    return () => {
      if (typeof notes === "function") notes();
      if (typeof settings === "function") settings();
    };
  }, "wikilink-completion: routes");
}

/**
 * @param {number | undefined} value
 */
function clampLimit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 8000;
  return Math.min(20000, Math.max(1, Math.floor(parsed)));
}

/**
 * @param {any} ctx
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {number} maxNotes
 */
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

/**
 * @param {any} ctx
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {string} file
 */
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
    send(res, 400, { error: "请求读不了" });
    return;
  }
  const draft = {
    includeWorkspace: payload?.includeWorkspace !== false,
    vaults: Array.isArray(payload?.vaults) ? payload.vaults : [],
  };
  if (draft.vaults.length > 16) {
    send(res, 400, { error: "最多添加 16 个仓库" });
    return;
  }
  /** @type {string[]} */
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

/**
 * @param {{ includeWorkspace: boolean, vaults: string[] }} settings
 * @param {string | null} cwd
 * @param {number} maxNotes
 */
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
      if (oldest !== undefined) cache.delete(oldest);
    }
    return value;
  }).finally(() => {
    if (pending.get(key) === job) pending.delete(key);
  });
  pending.set(key, job);
  return job;
}

/**
 * @param {{ includeWorkspace: boolean, vaults: string[] }} settings
 * @param {string | null} cwd
 * @param {number} maxNotes
 */
export async function collectNotes(settings, cwd, maxNotes) {
  /** @type {Array<{ vault: string, root: string }>} */
  const sources = [];
  const seen = new Set();
  const warnings = [];
  for (const path of settings.vaults) {
    try {
      const root = await realpath(path);
      if (seen.has(root)) continue;
      seen.add(root);
      sources.push({ vault: basename(root), root });
    } catch {
      warnings.push(`读不到仓库 ${path}`);
    }
  }
  if (settings.includeWorkspace && cwd) {
    try {
      const root = await realpath(cwd);
      if (!seen.has(root)) sources.push({ vault: "", root });
    } catch {
      warnings.push("当前工作区读不到");
    }
  }
  if (sources.length === 0) {
    return {
      notes: [],
      truncated: false,
      warnings,
      status: settings.includeWorkspace ? "no-workspace" : "no-vaults",
      includeWorkspace: settings.includeWorkspace,
      vaults: settings.vaults,
    };
  }
  /** @type {Array<{ name: string, link: string, folder: string, aliases: string[], vault: string }>} */
  const notes = [];
  let truncated = false;
  for (const source of sources) {
    const label = source.vault || "工作区";
    try {
      const listed = await listNotes(source.root, { maxNotes: Math.max(1, maxNotes - notes.length) });
      for (const note of listed.notes) notes.push({ ...note, vault: source.vault || note.vault || "" });
      if (listed.truncated || notes.length >= maxNotes) {
        truncated = true;
        break;
      }
    } catch {
      warnings.push(`读不到${label}里的笔记`);
    }
  }
  return {
    notes: qualifyNames(notes),
    truncated,
    warnings,
    status: "ready",
    includeWorkspace: settings.includeWorkspace,
    vaults: settings.vaults,
  };
}

/**
 * @param {import("node:http").IncomingMessage} req
 */
async function readBody(req) {
  /** @type {Buffer[]} */
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 65_536) throw new Error("too-large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * @param {any} ctx
 * @param {string} sessionId
 */
function sessionCwd(ctx, sessionId) {
  const session = ctx.sessions?.get?.(sessionId);
  const cwd = session?.header?.cwd || session?.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) return null;
  return cwd;
}

/**
 * @param {string | undefined} url
 */
function readSessionId(url) {
  try {
    const sessionId = new URL(url ?? "/", "http://localhost").searchParams.get("sessionId");
    if (sessionId === null || !/^[\w.-]{1,200}$/u.test(sessionId)) return null;
    return sessionId;
  } catch {
    return null;
  }
}

/**
 * Loopback, or a host the web runtime already trusts.
 * @param {any} ctx
 * @param {import("node:http").IncomingMessage} req
 */
function isTrusted(ctx, req) {
  const remote = String(req.socket?.remoteAddress ?? "");
  if (remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1") return true;
  const host = String(req.headers.host ?? "");
  const trusted = ctx.get?.("webRuntime")?.trustedHosts;
  if (!Array.isArray(trusted)) return false;
  return trusted.some((candidate) => host === candidate || host.startsWith(`${candidate}:`));
}

/**
 * @param {import("node:http").ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 */
function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}
