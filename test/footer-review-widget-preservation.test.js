"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("unified footer preserves existing review widget nodes across both renders", () => {
  const footer = read("assets/homs-site-footer.js");
  assert.match(footer, /function render\(host, settings, site, reviewWidgets = \[\]\)/);
  assert.match(footer, /reviewWidgets:\[\.\.\.host\.querySelectorAll\("\[data-review-widget\]"\)\]/);
  assert.match(footer, /originals\.forEach\(\(\{host,reviewWidgets\}\)=>render\(host,\{\},\{\},reviewWidgets\)\)/);
  assert.match(footer, /originals\.forEach\(\(\{host,reviewWidgets\}\)=>render\(host,settings,site,reviewWidgets\)\)/);
  assert.match(footer, /reviewWidgets\.forEach\(widget => host\.appendChild\(widget\)\)/);
});

test("disabled unified footer restores original markup without replacing review widget nodes", () => {
  const footer = read("assets/homs-site-footer.js");
  assert.match(footer, /placeholders=\[\.\.\.host\.querySelectorAll\("\[data-review-widget\]"\)\]/);
  assert.match(footer, /placeholders\[index\]\.replaceWith\(widget\)/);
});

test("devices and repair pages keep their review widgets inside the footer", () => {
  for (const page of ["devices.html", "repair.html"]) {
    const html = read(page);
    const footerStart = html.lastIndexOf("<footer");
    const footerEnd = html.indexOf("</footer>", footerStart);
    assert.ok(footerStart >= 0 && footerEnd > footerStart, page + " should contain a footer");
    const footer = html.slice(footerStart, footerEnd);
    assert.match(footer, /data-review-widget/, page + " review widget should remain in the footer");
  }
});


test("announcement bar disables continuous motion for reduced-motion preferences", () => {
  const script = read("assets/homs-announcement-bars.js");
  assert.match(script, /const reduceMotion = window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(script, /settings\.mode === "scroll" && !reduceMotion/);
});

test("review read-more button expands the review belonging to the clicked card", () => {
  const script = read("assets/customer-reviews-widget.js");
  assert.match(script, /data-review-more data-review-index=/);
  assert.match(script, /index=Number\(b\.dataset\.reviewIndex\),review=reviews\[index\]/);
});
