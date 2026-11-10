/**
 * Read note names from a NoteChain MCP service.
 * The browser never chooses the address at query time; only a saved http(s)
 * service is called, and only `obsidian_query_by_datacore` is invoked.
 */
import http from "node:http";
import https from "node:https";
import { assignLinks } from "../complete/index-notes.js";

const MAX_BODY = 2_000_000;
const TIMEOUT_MS = 8_000;

/**
 * @param {string} input
 * @returns {{ ok: true, url: string, label: string } | { ok: false, error: string }}
 */
export function normalizeServiceUrl(input) {
  const raw = String(input).replaceAll("\0", "").trim();
  if (!raw) return { ok: false, error: "先填写 NoteChain 地址" };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "地址不是有效的网址" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "只支持 http 或 https" };
  }
  if (url.username || url.password) return { ok: false, error: "不要把账号写进地址" };
  if (!url.hostname || url.hostname === "169.254.169.254" || url.hostname === "metadata.google.internal") {
    return { ok: false, error: "这个地址不能用" };
  }
  let path = url.pathname.replace(/\/+$/u, "");
  if (path.endsWith("/sse")) return { ok: false, error: "请填写 /mcp 地址，不要用 /sse" };
  if (path.endsWith("/call_tool")) path = path.slice(0, -"/call_tool".length);
  if (path.endsWith("/list_tools")) path = path.slice(0, -"/list_tools".length);
  path = path.replace(/\/+$/u, "");
  if (!path.endsWith("/mcp")) path = `${path}/mcp`;
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return { ok: true, url: url.toString(), label: serviceLabel(url) };
}

/**
 * @param {URL | string} url
 */
export function serviceLabel(url) {
  const parsed = typeof url === "string" ? new URL(url) : url;
  const port = parsed.port ? `:${parsed.port}` : "";
  const host = parsed.hostname.includes(":") ? `[${parsed.hostname}]` : parsed.hostname;
  return `${host}${port}`;
}

/**
 * @param {string} serviceUrl
 * @param {{ limit: number, request?: typeof postJson }} options
 */
export async function queryNoteChain(serviceUrl, options) {
  const target = new URL(serviceUrl);
  target.pathname = `${target.pathname.replace(/\/$/u, "")}/call_tool`;
  const body = JSON.stringify({
    name: "obsidian_query_by_datacore",
    arguments: {
      query: "@page",
      limit: options.limit,
    },
  });
  const request = options.request ?? postJson;
  const text = await request(target, body);
  return notesFromDatacoreText(text).slice(0, options.limit);
}

/**
 * @param {string} text
 */
export function notesFromDatacoreText(text) {
  /** @type {Array<{ name: string, folder: string, relative: string, aliases: string[], heading: string }>} */
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
      throw new Error(message || "NoteChain 查询失败");
    }
    for (const block of value.content) {
      if (typeof block?.text === "string") collect(parseMaybe(block.text), files, 0);
    }
    return assignLinks(files);
  }
  collect(value, files, 0);
  return assignLinks(files);
}

/**
 * @param {string} text
 */
function parseMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {unknown} value
 * @param {Array<{ name: string, folder: string, relative: string, aliases: string[], heading: string }>} files
 * @param {number} depth
 */
function collect(value, files, depth) {
  if (value == null || depth > 8 || files.length >= 2000) return;
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

/**
 * @param {Record<string, unknown>} value
 */
function fileFromRecord(value) {
  if ("inputSchema" in value || "mcp_tool" in value) return null;
  const path = firstString(value, ["$path", "path", "file", "filename"]);
  const name = firstString(value, ["$name", "basename", "name", "title"]);
  if (!path && !name) return null;
  const cleanedPath = (path || name).replaceAll("\\", "/").replace(/^\/+|\/+$/gu, "");
  if (!cleanedPath || cleanedPath.includes("..")) return null;
  const withoutExt = cleanedPath.replace(/\.md$/iu, "");
  const slash = withoutExt.lastIndexOf("/");
  const base = slash >= 0 ? withoutExt.slice(slash + 1) : withoutExt;
  if (!base || base.length > 180) return null;
  const folder = slash >= 0 ? withoutExt.slice(0, slash) : "";
  /** @type {string[]} */
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
    heading: "",
  };
}

/**
 * @param {Record<string, unknown>} value
 * @param {string[]} keys
 */
function firstString(value, keys) {
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return "";
}

/**
 * @param {string} text
 * @param {Array<{ name: string, folder: string, relative: string, aliases: string[], heading: string }>} files
 */
function collectPlain(text, files) {
  const pattern = /\[\[([^\]|#\n]{1,180})\]\]/gu;
  for (const match of text.matchAll(pattern)) {
    const file = fileFromRecord({ path: match[1] ?? "" });
    if (file) files.push(file);
    if (files.length >= 2000) return;
  }
}

/**
 * @param {URL} target
 * @param {string} body
 */
export function postJson(target, body) {
  return postOnce(target, body, true).catch((error) => {
    const code = error && typeof error === "object" ? error.code : "";
    if (target.protocol === "https:" && isCertificateError(code)) return postOnce(target, body, false);
    throw error;
  });
}

/**
 * @param {string | undefined} code
 */
function isCertificateError(code) {
  return code === "DEPTH_ZERO_SELF_SIGNED_CERT"
    || code === "SELF_SIGNED_CERT_IN_CHAIN"
    || code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
    || code === "CERT_HAS_EXPIRED";
}

/**
 * @param {URL} target
 * @param {string} body
 * @param {boolean} rejectUnauthorized
 */
function postOnce(target, body, rejectUnauthorized) {
  const lib = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(target, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
      },
      rejectUnauthorized,
      timeout: TIMEOUT_MS,
    }, (res) => {
      if ((res.statusCode ?? 0) >= 300 && (res.statusCode ?? 0) < 400) {
        res.resume();
        reject(new Error("地址发生了跳转，请填写最终的 NoteChain 地址"));
        return;
      }
      /** @type {Buffer[]} */
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > MAX_BODY) {
          req.destroy(new Error("NoteChain 返回的内容太大"));
          return;
        }
        chunks.push(buffer);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode ?? 0) < 200 || (res.statusCode ?? 0) >= 300) {
          reject(new Error(`NoteChain 返回 ${res.statusCode ?? 0}`));
          return;
        }
        resolve(text);
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("NoteChain 没有在 8 秒内响应"));
    });
    req.on("error", reject);
    req.end(body);
  });
}
