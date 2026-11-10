/**
 * Rank note names for a `[[` query.
 * Exact and prefix matches lead; a later substring still beats a gappy
 * subsequence. Space-separated terms must all match.
 */

/**
 * @typedef {{ name: string, link: string, folder?: string, vault?: string, aliases?: string[] }} NoteRecord
 * @typedef {{ note: NoteRecord, score: number, hint: string }} RankedNote
 */

/**
 * @param {readonly NoteRecord[]} notes
 * @param {string} query
 * @param {number} [limit]
 * @returns {RankedNote[]}
 */
export function rankNotes(notes, query, limit = 8) {
  const terms = String(query).trim().split(/\s+/u).filter(Boolean);
  /** @type {RankedNote[]} */
  const ranked = [];
  for (const note of notes) {
    if (terms.length === 0) {
      ranked.push({ note, score: 1, hint: "" });
      continue;
    }
    let score = 0;
    let hint = "";
    let matched = true;
    for (const term of terms) {
      const hit = bestField(note, term);
      if (hit.score <= 0) {
        matched = false;
        break;
      }
      score += hit.score;
      if (hit.hint) hint = hit.hint;
    }
    if (matched) ranked.push({ note, score, hint });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.note.name.localeCompare(b.note.name, "zh");
  });
  const cap = Math.max(0, limit);
  return terms.length === 0 ? ranked.slice(0, cap) : ranked.slice(0, cap);
}

/**
 * @param {NoteRecord} note
 * @param {string} term
 */
function bestField(note, term) {
  let score = scoreField(note.name, term);
  let hint = "";
  const linkScore = scoreField(note.link, term);
  if (linkScore > score) score = linkScore;
  for (const alias of note.aliases ?? []) {
    const aliasScore = scoreField(alias, term);
    if (aliasScore > score) {
      score = aliasScore;
      hint = alias === note.name ? "" : alias;
    }
  }
  const folderScore = Math.min(scoreField(note.folder ?? "", term), 420);
  if (folderScore > score) score = folderScore;
  const vaultScore = Math.min(scoreField(note.vault ?? "", term), 420);
  if (vaultScore > score) score = vaultScore;
  return { score, hint };
}

/**
 * @param {string} field
 * @param {string} query
 */
export function scoreField(field, query) {
  if (!field || !query) return 0;
  const f = field.normalize("NFC").toLowerCase();
  const q = query.normalize("NFC").toLowerCase();
  if (f === q) return 1000;
  if (f.startsWith(q)) return 820;
  const at = f.indexOf(q);
  if (at >= 0) return 640 - Math.min(at, 80);
  if (q.length < 2) return 0;
  let index = 0;
  let gaps = 0;
  let previous = -2;
  for (let cursor = 0; cursor < f.length && index < q.length; cursor += 1) {
    if (f[cursor] !== q[index]) continue;
    if (previous >= 0 && cursor > previous + 1) gaps += 1;
    previous = cursor;
    index += 1;
  }
  if (index < q.length) return 0;
  return Math.max(120, 360 - gaps * 24);
}
