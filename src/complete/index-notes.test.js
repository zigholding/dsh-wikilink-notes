import assert from "node:assert/strict";
import { mkdtemp, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listNotes, parseMeta } from "./index-notes.js";

test("reads titles, aliases, and a first heading", () => {
  const meta = parseMeta(`---
title: 忽略为别名
aliases: ["周会", 例会]
---

# 周一例会

正文不该被返回。
`);
  assert.deepEqual(meta.aliases, ["周会", "例会"]);
  assert.equal(meta.heading, "周一例会");
});

test("indexes markdown names and disambiguates duplicates", async () => {
  const root = await mkdtemp(join(tmpdir(), "wlc-"));
  await mkdir(join(root, "工作"), { recursive: true });
  await mkdir(join(root, "旅行"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, "node_modules"), { recursive: true });
  await writeFile(
    join(root, "工作", "周会纪要.md"),
    "---\naliases:\n  - 周会\n---\n# 周一例会\n",
  );
  await writeFile(join(root, "旅行", "曼谷.md"), "# 曼谷街头\n");
  await writeFile(join(root, "笔记.md"), "没有前言\n");
  await writeFile(join(root, "工作", "笔记.md"), "另一篇同名\n");
  await writeFile(join(root, ".git", "隐藏.md"), "# 不索引\n");
  await writeFile(join(root, "node_modules", "依赖.md"), "# 不索引\n");
  await writeFile(join(root, "图片.png"), "nope");
  await symlink(join(root, "旅行"), join(root, "链接目录"), "dir");

  const { notes, truncated } = await listNotes(root);
  assert.equal(truncated, false);
  const byName = Object.fromEntries(notes.map((note) => [note.link, note]));
  assert.equal(byName["周会纪要"]?.aliases.includes("周会"), true);
  assert.equal(byName["周会纪要"]?.aliases.includes("周一例会"), true);
  assert.equal(byName["曼谷"]?.folder, "旅行");
  assert.ok(byName["工作/笔记"]);
  assert.ok(byName["笔记"]);
  assert.equal(notes.some((note) => note.name === "隐藏" || note.name === "依赖"), false);
  assert.equal(notes.filter((note) => note.name === "曼谷").length, 1);

  await rename(join(root, "旅行", "曼谷.md"), join(root, "旅行", "清迈.md"));
  const renamed = await listNotes(root);
  assert.equal(renamed.notes.some((note) => note.name === "曼谷"), false);
  assert.equal(renamed.notes.some((note) => note.name === "清迈" && note.folder === "旅行"), true);
  assert.equal(renamed.notes.some((note) => note.name === "周会纪要"), true);
});
