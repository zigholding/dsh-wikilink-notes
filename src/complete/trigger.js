/**
 * Detect an unclosed `[[` (or fullwidth `【【`) immediately before the caret
 * and splice a chosen note link back into the draft.
 */

const OPENERS = ["[[", "【【"];

/**
 * @param {string} text
 * @param {number} [caret]
 * @returns {{ start: number, end: number, query: string, fullwidth: boolean } | null}
 */
export function findOpenTrigger(text, caret = text.length) {
  if (typeof text !== "string") return null;
  const safeCaret = clamp(caret, 0, text.length);
  const head = text.slice(0, safeCaret);
  let at = head.length;
  while (at > 0) {
    const open = lastOpener(head, at);
    if (open === null) return null;
    const query = head.slice(open.index + 2);
    if (query.includes("\n") || query.includes("\r")) {
      at = open.index;
      continue;
    }
    if (isClosedBeforeCaret(text, open.index, safeCaret)) {
      at = open.index;
      continue;
    }
    if (/[\]】|#|^]/u.test(query)) return null;
    if (query.length > 80) return null;
    if (fenceIsOpen(head.slice(0, open.index))) return null;
    return {
      start: open.index,
      end: safeCaret + closingSpan(text, safeCaret),
      query,
      fullwidth: open.fullwidth,
    };
  }
  return null;
}

/**
 * Replace the open trigger with a closed wikilink.
 * @param {string} text
 * @param {{ start: number, end: number }} trigger
 * @param {string} link
 * @param {string} [origin] NoteChain host, inserted after the wikilink.
 */
export function replaceTrigger(text, trigger, link, origin = "") {
  const safe = sanitizeLink(link);
  const from = sanitizeOrigin(origin);
  const suffix = from ? `(from ${from})` : "";
  return `${text.slice(0, trigger.start)}[[${safe}]]${suffix}${text.slice(trigger.end)}`;
}

/** @param {string} link */
export function sanitizeLink(link) {
  return String(link).replace(/[\[\]\n\r]/g, "").trim();
}

/** @param {string} origin */
function sanitizeOrigin(origin) {
  return String(origin).replace(/[()[\]\n\r]/g, "").trim();
}

/**
 * @param {string} head
 * @param {number} before
 */
function lastOpener(head, before) {
  let best = null;
  for (const token of OPENERS) {
    const index = head.lastIndexOf(token, before - 1);
    if (index < 0) continue;
    if (best === null || index > best.index) {
      best = { index, fullwidth: token === "【【" };
    }
  }
  return best;
}

/**
 * A trigger is already finished when a closing pair sits between it and the caret.
 * @param {string} text
 * @param {number} open
 * @param {number} caret
 */
function isClosedBeforeCaret(text, open, caret) {
  const between = text.slice(open + 2, caret);
  return between.includes("]]") || between.includes("】】");
}

/**
 * Swallow a closing pair the input method already inserted after the caret.
 * @param {string} text
 * @param {number} caret
 */
function closingSpan(text, caret) {
  if (text.startsWith("]]", caret) || text.startsWith("】】", caret)) return 2;
  return 0;
}

/** @param {string} before */
function fenceIsOpen(before) {
  const fences = before.match(/```/g);
  return fences !== null && fences.length % 2 === 1;
}

/** @param {number} value @param {number} min @param {number} max */
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return max;
  return Math.min(max, Math.max(min, value));
}
