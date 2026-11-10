/**
 * Vault settings live in `$DSH_HOME/wikilink-completion.json`.
 * A vault is an absolute directory that contains `.obsidian`.
 */
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { normalizeFormat } from "../complete/format.js";
import { normalizeServiceUrl } from "./notechain.js";

export const MAX_VAULTS = 16;

export const DEFAULT_SETTINGS = Object.freeze({
  includeWorkspace: true,
  vaults: Object.freeze([]),
  noteChains: Object.freeze([]),
  linkFormat: "[[${name}]](from ${mcp})",
});

/**
 * @param {string} [home]
 */
export function settingsFile(home = dshHome()) {
  return join(home, "wikilink-completion.json");
}

export function dshHome() {
  const configured = process.env.DSH_HOME?.trim();
  return configured || join(homedir(), ".dsh");
}

/**
 * @param {string} file
 */
export async function readSettings(file) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    return normalizeSettings(parsed);
  } catch {
    return { includeWorkspace: true, vaults: [], noteChains: [], linkFormat: normalizeFormat("") };
  }
}

/**
 * @param {string} file
 * @param {{ includeWorkspace?: boolean, vaults?: string[] }} settings
 */
export async function writeSettings(file, settings) {
  const normalized = normalizeSettings(settings);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return normalized;
}

/**
 * @param {unknown} value
 */
export function normalizeSettings(value) {
  const record = value && typeof value === "object" ? value : {};
  const includeWorkspace = record.includeWorkspace !== false;
  const seen = new Set();
  /** @type {string[]} */
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
  const seenServices = new Set();
  /** @type {string[]} */
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

/**
 * @param {string} input
 */
export function cleanPath(input) {
  let value = String(input).replaceAll("\0", "").trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  if (value.length > 1 && !/^[A-Za-z]:[\\/]?$/u.test(value)) {
    value = value.replace(/[\\/]+$/u, "");
  }
  if (/^[A-Za-z]:$/u.test(value)) value += "\\";
  return value;
}

/**
 * @param {string} input
 */
export async function inspectVault(input) {
  const path = cleanPath(input);
  if (!path) return { ok: false, error: "先填写仓库路径" };
  if (!isAbsolute(path)) return { ok: false, error: "请填写绝对路径" };
  let resolved;
  try {
    resolved = await realpath(path);
  } catch {
    return { ok: false, error: "找不到这个目录" };
  }
  let info;
  try {
    info = await stat(resolved);
  } catch {
    return { ok: false, error: "找不到这个目录" };
  }
  if (!info.isDirectory()) return { ok: false, error: "这不是文件夹" };
  try {
    const marker = await stat(join(resolved, ".obsidian"));
    if (!marker.isDirectory()) throw new Error("missing");
  } catch {
    return { ok: false, error: "这里没有 .obsidian，不是 Obsidian 仓库" };
  }
  return { ok: true, path: resolved, name: basename(resolved) };
}

/**
 * @param {string} configPath
 */
export async function discoverVaults(configPath) {
  let text;
  try {
    text = await readFile(configPath, "utf8");
  } catch {
    return [];
  }
  /** @type {string[]} */
  const found = [];
  for (const path of parseObsidianConfig(text)) {
    const inspected = await inspectVault(path);
    if (inspected.ok && !found.includes(inspected.path)) found.push(inspected.path);
  }
  return found;
}

/**
 * @param {string} text
 */
export function parseObsidianConfig(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const vaults = parsed?.vaults;
  if (!vaults || typeof vaults !== "object") return [];
  /** @type {string[]} */
  const paths = [];
  for (const value of Object.values(vaults)) {
    if (value && typeof value === "object" && typeof value.path === "string") paths.push(value.path);
  }
  return paths;
}

export function obsidianConfigPath() {
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "obsidian", "obsidian.json");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "obsidian", "obsidian.json");
  }
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "obsidian", "obsidian.json");
}
