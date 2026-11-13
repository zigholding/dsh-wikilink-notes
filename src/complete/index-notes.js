/**
 * Read note names from a workspace directory.
 * The walk stays inside the real path of `root`, skips symlinks and hidden
 * directories, and returns titles only — never file bodies.
 */
import { open, readdir, realpath, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

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

/** @type {Map<string, DirNode>} */
const trees = new Map();
/** @type {Map<string, Promise<void>>} */
const chains = new Map();

/**
 * Cached file bodies, keyed by filename inside one directory.
 * Listings are read again on every refresh so a rename shows up immediately.
 * Frontmatter is reread only when the file's mtime or size changed.
 * @typedef {{
 *   files: Map<string, FileRecord>,
 *   subdirs: Map<string, DirNode>,
 * }} DirNode
 * @typedef {{
 *   name: string,
 *   folder: string,
 *   relative: string,
 *   path: string,
 *   mtimeMs: number,
 *   size: number,
 *   aliases: string[],
 *   heading: string,
 * }} FileRecord
 */

/**
 * @param {string} root
 * @param {{ maxNotes?: number, signal?: AbortSignal }} [options]
 */
export async function listNotes(root, options = {}) {
  const resolved = await realpath(root);
  const previous = chains.get(resolved) ?? Promise.resolve();
  const job = previous.catch(() => {}).then(() => scanRoot(resolved, options));
  chains.set(resolved, job.then(() => {}, () => {}));
  return job;
}

/**
 * @param {string} resolved
 * @param {{ maxNotes?: number, signal?: AbortSignal }} options
 */
async function scanRoot(resolved, options) {
  const maxNotes = options.maxNotes ?? 8000;
  const scanned = await readDirNode(resolved, "", trees.get(resolved), options.signal, maxNotes);
  if (scanned.truncated) trees.delete(resolved);
  else trees.set(resolved, scanned.node);
  /** @type {FileRecord[]} */
  const records = [];
  flatten(scanned.node, records);
  return { notes: assignLinks(records), truncated: scanned.truncated };
}

/**
 * @param {string} dir
 * @param {string} relativeDir
 * @param {DirNode | undefined} cached
 * @param {AbortSignal | undefined} signal
 * @param {number} maxNotes
 * @returns {Promise<{ node: DirNode, count: number, truncated: boolean }>}
 */
async function readDirNode(dir, relativeDir, cached, signal, maxNotes) {
  signal?.throwIfAborted();
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return emptyNode();
  }
  /** @type {string[]} */
  const fileNames = [];
  /** @type {string[]} */
  const dirNames = [];
  for (const dirent of entries) {
    if (dirent.isSymbolicLink() || dirent.name.startsWith(".")) continue;
    if (dirent.isDirectory()) {
      if (!IGNORE.has(dirent.name)) dirNames.push(dirent.name);
      continue;
    }
    if (!dirent.isFile()) continue;
    const ext = extname(dirent.name).toLowerCase();
    if (ext !== ".md" && ext !== ".markdown") continue;
    fileNames.push(dirent.name);
  }

  let truncated = false;
  /** @type {string[]} */
  const selected = [];
  for (const name of fileNames) {
    if (selected.length >= maxNotes) {
      truncated = true;
      break;
    }
    selected.push(name);
  }
  const loaded = await mapPool(selected, 32, async (name) => loadFile(dir, relativeDir, name, cached, signal));
  /** @type {Map<string, FileRecord>} */
  const files = new Map();
  for (const record of loaded) {
    if (record) files.set(basename(record.path), record);
  }

  /** @type {Map<string, DirNode>} */
  const subdirs = new Map();
  let count = files.size;
  for (const name of dirNames) {
    if (count >= maxNotes) {
      truncated = true;
      break;
    }
    const next = await readDirNode(join(dir, name), joinRel(relativeDir, name), cached?.subdirs.get(name), signal, maxNotes - count);
    subdirs.set(name, next.node);
    count += next.count;
    if (next.truncated) truncated = true;
  }
  return { node: { files, subdirs }, count, truncated };
}

/** @returns {{ node: DirNode, count: number, truncated: boolean }} */
function emptyNode() {
  return { node: { files: new Map(), subdirs: new Map() }, count: 0, truncated: false };
}

/**
 * @param {string} dir
 * @param {string} relativeDir
 * @param {string} filename
 * @param {DirNode | undefined} cached
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<FileRecord | null>}
 */
async function loadFile(dir, relativeDir, filename, cached, signal) {
  const ext = extname(filename).toLowerCase();
  const name = basename(filename, ext);
  if (!name || name.length > 180) return null;
  const path = join(dir, filename);
  const rel = joinRel(relativeDir, filename);
  if (rel.startsWith("..") || rel.includes("/../")) return null;
  const folder = relativeDir;
  let info;
  try {
    info = await stat(path);
  } catch {
    return null;
  }
  const mtimeMs = Math.round(info.mtimeMs);
  const previous = cached?.files.get(filename);
  if (previous && previous.mtimeMs === mtimeMs && previous.size === info.size && previous.relative === rel) {
    return previous;
  }
  const meta = await readMeta(path, signal);
  return {
    name,
    folder,
    relative: rel,
    path,
    mtimeMs,
    size: info.size,
    aliases: meta.aliases,
    heading: meta.heading,
  };
}

/** @param {DirNode} node @param {FileRecord[]} out */
function flatten(node, out) {
  for (const file of node.files.values()) out.push(file);
  for (const child of node.subdirs.values()) flatten(child, out);
}

/** @param {string} dir @param {string} name */
function joinRel(dir, name) {
  return dir ? `${dir}/${name}` : name;
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} run
 */
async function mapPool(items, limit, run) {
  /** @type {R[]} */
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
