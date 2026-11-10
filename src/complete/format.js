/** How a chosen note is written into the composer. */
export const DEFAULT_LINK_FORMAT = "[[${name}]](from ${mcp})";

/**
 * @param {unknown} value
 * @returns {{ ok: true, format: string } | { ok: false, error: string }}
 */
export function checkFormat(value) {
  if (value === undefined || value === null || value === "") {
    return { ok: true, format: DEFAULT_LINK_FORMAT };
  }
  const format = String(value).replaceAll("\0", "").trim();
  if (!format) return { ok: true, format: DEFAULT_LINK_FORMAT };
  if (format.length > 200) return { ok: false, error: "插入格式太长" };
  if (/[\r\n]/u.test(format)) return { ok: false, error: "插入格式不能换行" };
  if (!format.includes("${name}")) return { ok: false, error: "插入格式里要有 ${name}" };
  return { ok: true, format };
}

/** @param {unknown} value */
export function normalizeFormat(value) {
  const checked = checkFormat(value);
  return checked.ok ? checked.format : DEFAULT_LINK_FORMAT;
}

/**
 * @param {unknown} template
 * @param {{ name?: string, mcp?: string }} note
 */
export function formatLink(template, note) {
  const format = normalizeFormat(template);
  const name = String(note.name ?? "").replace(/[\r\n]/gu, "").trim();
  const mcp = String(note.mcp ?? "").replace(/[\r\n]/gu, "").trim();
  let rendered = format.replaceAll("${name}", name).replaceAll("${mcp}", mcp);
  if (!mcp) rendered = rendered.replace(/[ \t]*\(from\s*\)/gu, "");
  return rendered.trim();
}
