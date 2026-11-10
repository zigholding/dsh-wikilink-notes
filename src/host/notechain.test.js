import assert from "node:assert/strict";
import test from "node:test";
import { normalizeServiceUrl, notesFromDatacoreText, queryNoteChain } from "./notechain.js";

test("normalizes a NoteChain origin to its /mcp address", () => {
  const parsed = normalizeServiceUrl("http://192.168.1.8:3000/");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.url, "http://192.168.1.8:3000/mcp");
  assert.equal(parsed.label, "192.168.1.8:3000");
  assert.equal(normalizeServiceUrl("http://192.168.1.8:3000/mcp/call_tool").url, "http://192.168.1.8:3000/mcp");
  assert.equal(normalizeServiceUrl("http://192.168.1.8:3000/sse").ok, false);
  assert.equal(normalizeServiceUrl("file:///tmp/notes").ok, false);
});

test("reads page names out of a datacore payload", () => {
  const text = JSON.stringify({
    content: [{
      type: "text",
      text: JSON.stringify([
        { $path: "工作/周会纪要.md", $name: "周会纪要", aliases: ["周会"] },
        { $path: "旅行/曼谷.md", $name: "曼谷" },
      ]),
    }],
  });
  const notes = notesFromDatacoreText(text);
  const meeting = notes.find((note) => note.name === "周会纪要");
  assert.equal(meeting?.folder, "工作");
  assert.deepEqual(meeting?.aliases, ["周会"]);
  assert.equal(notes.find((note) => note.name === "曼谷")?.folder, "旅行");
});

test("calls obsidian_query_by_datacore and ignores tool metadata", async () => {
  /** @type {string} */
  let sent = "";
  const notes = await queryNoteChain("http://10.0.0.8:3000/mcp", {
    limit: 20,
    request: async (target, body) => {
      sent = `${target} ${body}`;
      return JSON.stringify({
        tools: [{ name: "obsidian_query_by_datacore", inputSchema: {} }],
        content: [{ type: "text", text: "[[日记/今日]]\n[[阅读清单]]" }],
      });
    },
  });
  assert.match(sent, /^http:\/\/10\.0\.0\.8:3000\/mcp\/call_tool /u);
  assert.match(sent, /"name":"obsidian_query_by_datacore"/u);
  assert.match(sent, /"query":"@page"/u);
  assert.equal(notes.find((note) => note.name === "今日")?.folder, "日记");
  assert.equal(notes.find((note) => note.name === "阅读清单")?.link, "阅读清单");
});
