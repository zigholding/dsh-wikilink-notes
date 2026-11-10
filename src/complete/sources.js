/**
 * When the same note name exists in more than one library, prefix the link
 * with the library name so the inserted wikilink stays unambiguous.
 * Remote NoteChain notes keep a plain wikilink; the host is written after it.
 * @param {Array<{ name: string, link: string, vault?: string, origin?: string }>} notes
 */
export function qualifyNames(notes) {
  const counts = new Map();
  for (const note of notes) {
    if (note.origin) continue;
    counts.set(note.name, (counts.get(note.name) ?? 0) + 1);
  }
  return notes.map((note) => {
    if (note.origin) return note;
    if ((counts.get(note.name) ?? 0) <= 1) return note;
    const vault = note.vault?.trim() || "工作区";
    const prefix = `${vault}/`;
    if (note.link.startsWith(prefix)) return { ...note, vault };
    return { ...note, vault, link: `${vault}/${note.link}` };
  });
}
