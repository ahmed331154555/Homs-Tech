"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const pages = fs.readdirSync(root).filter(name => name.endsWith(".html"));
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("no phone/WhatsApp number is hardcoded in public pages", () => {
  for (const page of pages) {
    const html = read(page).replace(/ca-pub-\d+/g, "");
    assert.doesNotMatch(html, /\+?31\s?6\d{8}|\b06\d{8}\b/, `${page} contains a hardcoded phone number`);
  }
});

test("pages do not set [data-wa]/[data-phone] links themselves", () => {
  for (const page of pages) {
    const html = read(page);
    assert.doesNotMatch(html, /querySelectorAll\(\s*["']\[data-(wa|phone)\]["']\s*\)\s*\.forEach/, `${page} fills contact buttons locally`);
  }
});

test("shared contact script is loaded before the footer and exposes the helpers", () => {
  const nav = read("assets/homs-global-nav.js");
  assert.ok(nav.indexOf("homs-contact.js") !== -1 && nav.indexOf("homs-contact.js") < nav.indexOf("homs-site-footer.js"));
  const contact = read("assets/homs-contact.js");
  assert.match(contact, /homepage\.footer|footer\.phone/);
  assert.match(contact, /\[data-wa\]/);
  assert.match(contact, /\[data-phone\]/);
});
