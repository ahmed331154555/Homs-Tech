"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("product page inline scripts are valid JavaScript", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "product.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());

  assert.ok(scripts.length > 0, "product.html should contain its product renderer");
  scripts.forEach((source, index) => {
    assert.doesNotThrow(
      () => new vm.Script(source, { filename: "product.html:inline-script-" + index }),
      "product.html inline script " + index + " must parse"
    );
  });
});
