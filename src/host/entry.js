/**
 * Host half: list markdown note names for the session workspace.
 * The browser asks with a session id; the directory always comes from the
 * session header, never from the request.
 */
import { listNotes } from "../complete/index-notes.js";

export const name = "dsh-wikilink-completion";
export const inject = ["webServer", "sessions"];

const CACHE_MS = 15_000;
const cache = new Map();

/**
 * @param {import("@deepseek-ai/cordis").Context} ctx
 * @param {{ maxNotes?: number }} [config]
 */
export function apply(ctx, config = {}) {
  const maxNotes = clampLimit(config.maxNotes);
  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: "exact",
      path: "/api/wikilink-completion/notes",
      handler: (req, res) => handleNotes(ctx, req, res, maxNotes),
    });
    return () => {
      if (typeof dispose === "function") dispose();
    };
  }, "wikilink-completion: notes route");
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

/**
 * @param {string} cwd
 * @param {number} maxNotes
 */
async function cachedNotes(cwd, maxNotes) {
  const hit = cache.get(cwd);
  const now = Date.now();
  if (hit && hit.maxNotes === maxNotes && now - hit.at < CACHE_MS) return hit.value;
  const value = await listNotes(cwd, { maxNotes });
  cache.set(cwd, { at: now, maxNotes, value });
  if (cache.size > 40) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
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
