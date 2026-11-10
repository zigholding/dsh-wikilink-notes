import assert from "node:assert/strict";
import test from "node:test";
import { rankNotes } from "./rank.js";

const notes = [
  { name: "周会纪要", link: "周会纪要", folder: "工作", aliases: ["周会"] },
  { name: "曼谷街头美食", link: "旅行/曼谷街头美食", folder: "旅行", aliases: ["美食"] },
  { name: "曼谷笔记", link: "旅行/曼谷笔记", folder: "旅行", aliases: [] },
  { name: "阅读清单", link: "阅读清单", folder: "生活", aliases: [] },
];

test("lists note names when the query is empty", () => {
  const ranked = rankNotes(notes, "", 2);
  assert.equal(ranked.length, 2);
  assert.ok(ranked.every((item) => notes.some((note) => note.name === item.note.name)));
});

test("prefers a prefix over a later substring", () => {
  const ranked = rankNotes(notes, "曼谷");
  assert.deepEqual(
    ranked.map((item) => item.note.name),
    ["曼谷笔记", "曼谷街头美食"],
  );
});

test("matches an alias and a gappy subsequence", () => {
  assert.equal(rankNotes(notes, "周会")[0]?.note.name, "周会纪要");
  assert.equal(rankNotes(notes, "曼食")[0]?.note.name, "曼谷街头美食");
});

test("requires every space-separated term", () => {
  const ranked = rankNotes(notes, "曼谷 美食");
  assert.deepEqual(
    ranked.map((item) => item.note.name),
    ["曼谷街头美食"],
  );
});

test("returns nothing when no name matches", () => {
  assert.deepEqual(rankNotes(notes, "不存在的笔记"), []);
});
