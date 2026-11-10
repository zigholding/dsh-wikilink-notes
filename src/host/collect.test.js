import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { collectNotes } from "./entry.js";

test("merges the workspace with several Obsidian vaults", async () => {
  const root = join(tmpdir(), `wlc-merge-${Date.now()}`);
  const workspace = join(root, "session");
  const work = join(root, "工作");
  const life = join(root, "生活");
  await mkdir(workspace, { recursive: true });
  await mkdir(join(work, ".obsidian"), { recursive: true });
  await mkdir(join(life, ".obsidian"), { recursive: true });
  await writeFile(join(workspace, "笔记.md"), "# 工作区\n");
  await writeFile(join(work, "笔记.md"), "# 工作\n");
  await writeFile(join(work, "周会纪要.md"), "---\naliases: [周会]\n---\n# 周一例会\n");
  await writeFile(join(life, "阅读清单.md"), "# 书\n");

  const indexed = await collectNotes(
    { includeWorkspace: true, vaults: [work, life] },
    workspace,
    100,
  );
  assert.equal(indexed.status, "ready");
  const byName = Object.fromEntries(indexed.notes.map((note) => [note.link, note.name]));
  assert.equal(byName["工作区/笔记"], "笔记");
  assert.equal(byName["工作/笔记"], "笔记");
  assert.equal(byName["周会纪要"], "周会纪要");
  assert.equal(byName["阅读清单"], "阅读清单");

  const closed = await collectNotes({ includeWorkspace: false, vaults: [] }, workspace, 100);
  assert.equal(closed.status, "no-vaults");
  assert.deepEqual(closed.notes, []);
});
