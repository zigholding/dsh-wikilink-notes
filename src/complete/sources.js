/**
 * When the same note name exists in more than one library, prefix the link
 * with the library name so the inserted wikilink stays unambiguous.
 * @param {Array<{ name: string, link: string, vault?: string }>} notes
 */
export function qualifyNames(notes) {
  const counts = new Map();
  for (const note of notes) counts.set(note.name, (counts.get(note.name) ?? 0) + 1);
  return notes.map((note) => {
    if ((counts.get(note.name) ?? 0) <= 1) return note;
    const vault = note.vault?.trim() || "工作区";
    const prefix = `${vault}/`;
    if (note.link.startsWith(prefix)) return { ...note, vault };
    return { ...note, vault, link: `${vault}/${note.link}` };
  });
}
