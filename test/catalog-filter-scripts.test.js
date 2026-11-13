"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function inlineScripts(fileName) {
  const html = fs.readFileSync(path.join(__dirname, "..", fileName), "utf8");
  return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
}

for (const page of ["devices.html", "shop.html"]) {
  test(page + " catalog filter scripts parse and include accessible controls", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", page), "utf8");
    const scripts = inlineScripts(page);
    assert.ok(scripts.length > 0, page + " should include its catalog renderer");
    scripts.forEach((source, index) => {
      assert.doesNotThrow(
        () => new vm.Script(source, { filename: page + ":inline-script-" + index }),
        page + " inline script " + index + " must parse"
      );
    });
    assert.match(html, /aria-live="polite"/);
    assert.match(html, /Wis filters|Wis alle filters/);
    assert.match(html, /Prijs: laag naar hoog/);
    assert.match(html, /Alleen op voorraad/);
  });
}

test("phone catalog exposes brand, storage, color and condition filters", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "devices.html"), "utf8");
  for (const id of ["filterBrand", "filterStorage", "filterColor", "filterCondition", "filterMinPrice", "filterMaxPrice", "filterInStock", "devicesSort"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});

test("Shop catalog exposes category, brand, quality and stock filters", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "shop.html"), "utf8");
  for (const id of ["category", "shopBrand", "shopQuality", "shopMinPrice", "shopMaxPrice", "shopInStock", "shopSort"]) {
    assert.match(html, new RegExp('id="' + id + '"'));
  }
});
