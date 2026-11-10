import assert from "node:assert/strict";
import test from "node:test";
import { qualifyNames } from "./sources.js";

test("leaves a unique name unqualified", () => {
  const [note] = qualifyNames([{ name: "周会纪要", link: "周会纪要", vault: "工作" }]);
  assert.equal(note.link, "周会纪要");
});

test("labels a workspace note when it collides with a vault note", () => {
  const notes = qualifyNames([
    { name: "周会纪要", link: "周会纪要", vault: "" },
    { name: "周会纪要", link: "周会纪要", vault: "工作" },
  ]);
  assert.deepEqual(
    notes.map((note) => note.link),
    ["工作区/周会纪要", "工作/周会纪要"],
  );
});

test("prefixes the vault when the same name comes from two libraries", () => {
  const notes = qualifyNames([
    { name: "周会纪要", link: "周会纪要", vault: "工作" },
    { name: "周会纪要", link: "档案/周会纪要", vault: "生活" },
  ]);
  assert.deepEqual(
    notes.map((note) => note.link),
    ["工作/周会纪要", "生活/档案/周会纪要"],
  );
});
