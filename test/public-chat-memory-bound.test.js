"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const chat = fs.readFileSync(
  path.resolve(__dirname, "../assets/homs-ai-chat.js"),
  "utf8",
);

test("customer live chat bounds rendered messages and deduplication IDs", () => {
  assert.match(chat, /const MAX_RENDERED_MESSAGES = 300;/);
  assert.match(
    chat,
    /while \(messages\.children\.length > MAX_RENDERED_MESSAGES\)/,
  );
  assert.match(chat, /if \(id\) element\.dataset\.messageId = id;/);
  assert.match(
    chat,
    /const oldestId = oldest\.dataset\.messageId;\s*if \(oldestId\) seen\.delete\(oldestId\);/,
  );
});

test("customer live chat keeps polling disabled when hidden or closed", () => {
  assert.match(
    chat,
    /if \(!panel\.classList\.contains\("open"\) \|\| document\.hidden \|\| timer\) return;/,
  );
  assert.match(
    chat,
    /if \(document\.hidden\) stopPolling\(\);\s*else startPolling\(\);/,
  );
});

test("customer live chat evicts the ID belonging to the removed DOM message", () => {
  assert.match(chat, /const oldest = messages\.firstElementChild;/);
  assert.match(chat, /const oldestId = oldest\.dataset\.messageId;/);
  assert.match(chat, /if \(oldestId\) seen\.delete\(oldestId\);/);
  assert.doesNotMatch(chat, /renderedMessageIds/);
});

test("customer live chat tolerates responses without a messages array", () => {
  assert.match(
    chat,
    /if \(Array\.isArray\(data\.messages\)\) data\.messages\.forEach\(add\);/,
  );
});
