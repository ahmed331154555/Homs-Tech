"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml } = require("../utils/html");

test("escapeHtml escapes HTML-sensitive characters", () => {
  assert.equal(
    escapeHtml(`<&>"'`),
    "&lt;&amp;&gt;&quot;&#039;"
  );
});

test("escapeHtml escapes ampersands before adding entities", () => {
  assert.equal(escapeHtml("&lt; &amp;"), "&amp;lt; &amp;amp;");
});

test("escapeHtml preserves the existing empty-value behavior", () => {
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(""), "");
  assert.equal(escapeHtml(0), "");
  assert.equal(escapeHtml(false), "");
});

test("escapeHtml converts other values to strings", () => {
  assert.equal(escapeHtml(123), "123");
});
