import assert from "node:assert/strict";
import test from "node:test";
import { checkFormat, formatLink, renderInsertion } from "./format.js";

test("writes the filename and the NoteChain address", () => {
  assert.equal(
    formatLink("[[${name}]](from ${mcp})", { name: "周会纪要", mcp: "192.168.1.8:3000" }),
    "[[周会纪要]](from 192.168.1.8:3000)",
  );
});

test("drops an empty from-clause for a local note", () => {
  assert.equal(
    formatLink("[[${name}]](from ${mcp})", { name: "周会纪要", mcp: "" }),
    "[[周会纪要]]",
  );
});

test("keeps a custom arrangement of the two tokens", () => {
  assert.equal(
    formatLink("${mcp} :: ${name}", { name: "周会纪要", mcp: "10.0.0.8:3000" }),
    "10.0.0.8:3000 :: 周会纪要",
  );
});

test("leaves a local note as a plain wikilink even when the template is custom", () => {
  assert.equal(
    renderInsertion("${mcp}/${name}", { name: "周会纪要", link: "日记/周会纪要", mcp: "" }),
    "[[日记/周会纪要]]",
  );
});

test("applies the template only when the note comes from NoteChain", () => {
  assert.equal(
    renderInsertion("${mcp} :: ${name}", { name: "周会纪要", link: "周会纪要", mcp: "192.168.1.8:3000" }),
    "192.168.1.8:3000 :: 周会纪要",
  );
});

test("requires the filename token", () => {
  assert.equal(checkFormat("[[${mcp}]]").ok, false);
  assert.equal(checkFormat("[[${name}]]").format, "[[${name}]]");
});
