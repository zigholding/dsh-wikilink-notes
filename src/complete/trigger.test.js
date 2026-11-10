import assert from "node:assert/strict";
import test from "node:test";
import { findOpenTrigger, replaceTrigger } from "./trigger.js";

test("opens on a bare double bracket", () => {
  const hit = findOpenTrigger("请看 [[");
  assert.deepEqual(hit, { start: 3, end: 5, query: "", fullwidth: false });
});

test("uses the query between the brackets and the caret", () => {
  const text = "总结 [[曼谷";
  const hit = findOpenTrigger(text);
  assert.equal(hit?.query, "曼谷");
  assert.equal(replaceTrigger(text, hit, "曼谷街头美食"), "总结 [[曼谷街头美食]]");
});

test("accepts a fullwidth opener and still inserts ascii brackets", () => {
  const hit = findOpenTrigger("【【周会", 4);
  assert.equal(hit?.fullwidth, true);
  assert.equal(replaceTrigger("【【周会", hit, "周会纪要"), "[[周会纪要]]");
});

test("ignores a link that is already closed", () => {
  assert.equal(findOpenTrigger("已有 [[周会纪要]] 然后继续"), null);
});

test("stays open when the caret sits inside an auto-closed pair", () => {
  const text = "[[周会]]";
  const hit = findOpenTrigger(text, 4);
  assert.equal(hit?.query, "周会");
  assert.equal(hit?.end, 6);
  assert.equal(replaceTrigger(text, hit, "周会纪要"), "[[周会纪要]]");
});

test("does not open inside a fenced code block", () => {
  assert.equal(findOpenTrigger("```\n[[笔记\n```", 8), null);
});

test("does not treat a heading or alias marker as a note query", () => {
  assert.equal(findOpenTrigger("[[笔记#标题", 7), null);
  assert.equal(findOpenTrigger("[[笔记|别名", 7), null);
});

test("keeps text that follows the caret", () => {
  const text = "先 [[周 再写";
  const hit = findOpenTrigger(text, 5);
  assert.equal(replaceTrigger(text, hit, "周会纪要"), "先 [[周会纪要]] 再写");
});
