/**
 * Read note names from a workspace directory.
 * The walk stays inside the real path of `root`, skips symlinks and hidden
 * directories, and returns titles only — never file bodies.
 */
import { opendir, open, realpath } from "node:fs/promises";
import { basename, extname, join, relative, sep } from "node:path";

const IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".obsidian",
  ".dsh",
  "coverage",
]);

/**
 * @param {string} root
 * @param {{ maxNotes?: number, signal?: AbortSignal }} [options]
 */
export async function listNotes(root, options = {}) {
  const maxNotes = options.maxNotes ?? 8000;
  const signal = options.signal;
  const resolved = await realpath(root);
  /** @type {Array<{ name: string, folder: string, relative: string, aliases: string[], heading: string }>} */
  const found = [];
  const queue = [resolved];
  let truncated = false;

  while (queue.length > 0 && !truncated) {
    signal?.throwIfAborted();
    const dir = queue.shift();
    if (dir === undefined) break;
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      continue;
    }
    try {
      for (;;) {
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
        const name = basename(dirent.name, extname(dirent.name));
        if (!name || name.length > 180) continue;
        const rel = relative(resolved, child).split(sep).join("/");
        if (rel.startsWith("..") || rel.includes("/../")) continue;
        const folder = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        const meta = await readMeta(child, signal);
        found.push({ name, folder, relative: rel, aliases: meta.aliases, heading: meta.heading });
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

/**
 * @param {Array<{ name: string, folder: string, relative: string, aliases: string[], heading: string }>} files
 */
export function assignLinks(files) {
  const counts = new Map();
  for (const file of files) counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
  return files
    .map((file) => {
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
        vault: file.vault || "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "zh"));
}

/**
 * @param {string[]} aliases
 * @param {string} value
 * @param {string} name
 * @param {string} link
 */
function pushAlias(aliases, value, name, link) {
  const alias = value.trim();
  if (!alias || alias === name || alias === link || aliases.includes(alias)) return;
  if (aliases.length >= 12) return;
  aliases.push(alias);
}

/**
 * @param {string} path
 * @param {AbortSignal | undefined} signal
 */
async function readMeta(path, signal) {
  try {
    const text = await readHead(path, 4096, signal);
    return parseMeta(text);
  } catch {
    return { aliases: [], heading: "" };
  }
}

/**
 * @param {string} path
 * @param {number} bytes
 * @param {AbortSignal | undefined} signal
 */
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

/**
 * Read a title and aliases from a small frontmatter / first-heading slice.
 * @param {string} text
 */
export function parseMeta(text) {
  /** @type {string[]} */
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

/**
 * @param {string[]} aliases
 * @param {string} key
 * @param {string} raw
 */
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

/**
 * @param {string[]} aliases
 * @param {string} raw
 */
function collectScalar(aliases, raw) {
  const value = cleanScalar(raw);
  if (!value || aliases.includes(value) || aliases.length >= 12) return;
  aliases.push(value);
}

/** @param {string} raw */
function cleanScalar(raw) {
  let value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return value.trim();
}
