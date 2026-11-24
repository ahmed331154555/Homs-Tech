"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pages = ["admin/index.html", "shop.html", "uw-toestel-verkopen.html"];

for (const page of pages) {
  test(page + " gives every button an explicit non-submit type", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "..", page), "utf8");
    const buttons = [...html.matchAll(/<button\b([^>]*)>/gi)];

    assert.ok(buttons.length > 0, "Expected buttons in " + page);
    for (const [, attributes] of buttons) {
      assert.match(
        attributes,
        /\btype\s*=\s*["']button["']/i,
        'Button is missing type="button" in ' +
          page +
          ": " +
          attributes.slice(0, 160),
      );
    }
  });
}

test("critical admin navigation and save actions remain wired", () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, "..", "admin/index.html"),
    "utf8",
  );

  assert.match(html, /data-page="general"[^>]*onclick="showPage\('general'\)"/);
  assert.match(html, /id="saveBtn"[^>]*onclick="save\(\)"/);
  assert.match(html, /id="logoutBtn"[^>]*onclick="logout\(\)"/);
});

test("generated admin action buttons also declare a non-submit type", () => {
  const script = fs.readFileSync(
    path.resolve(__dirname, "..", "assets/homs-admin.js"),
    "utf8",
  );
  const buttons = [...script.matchAll(/<button\b([^>]*)>/gi)];

  assert.ok(buttons.length > 0, "Expected generated admin button markup");
  for (const [, attributes] of buttons) {
    assert.match(
      attributes,
      /\btype\s*=\s*["']button["']/i,
      'Generated admin button is missing type="button": ' +
        attributes.slice(0, 160),
    );
  }
});
