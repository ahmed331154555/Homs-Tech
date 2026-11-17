"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const footer = fs.readFileSync(path.join(root, "assets", "homs-site-footer.js"), "utf8");

test("shared footer requests its compact settings view instead of the full site document", () => {
  assert.match(footer, /fetch\(["']\/api\/site\?view=footer["']/);
  assert.doesNotMatch(footer, /fetch\(["']\/api\/site["']/);
});

test("footer API selects only footer and contact fields", () => {
  const start = server.indexOf('if(view==="footer"){');
  const end = server.indexOf('if(view==="repair"){', start);
  assert.notEqual(start, -1, "compact footer view must exist");
  assert.ok(end > start, "footer view must be placed before other site views");
  const route = server.slice(start, end);
  for (const field of ["data->'homepage'->'footer'", "data->>'areas'", "data->>'phone'", "data->>'whatsapp'"]) {
    assert.ok(route.includes(field), "footer view should select " + field);
  }
  assert.doesNotMatch(route, /SELECT\s+data\s+FROM\s+site_settings/i);
});

test("contact and checkout pages request compact settings and stock payloads", () => {
  const contact = fs.readFileSync(path.join(root, "contact.html"), "utf8");
  const checkout = fs.readFileSync(path.join(root, "checkout.html"), "utf8");
  assert.match(contact, /fetch\(["']\/api\/site\?view=footer["']/);
  assert.doesNotMatch(contact, /fetch\(["']\/api\/site["']/);
  assert.match(checkout, /fetch\(["']\/api\/site\?view=cart["']/);
  assert.doesNotMatch(checkout, /fetch\(["']\/api\/site["']/);
});

test("live chat polling pauses in hidden tabs and avoids overlapping refreshes", () => {
  const chat = fs.readFileSync(path.join(root, "assets", "homs-ai-chat.js"), "utf8");
  assert.match(chat, /document\.addEventListener\(["']visibilitychange["']/);
  assert.match(chat, /if \(document\.hidden\) stopPolling\(\);/);
  assert.match(chat, /if \(!panel\.classList\.contains\("open"\) \|\| document\.hidden \|\| timer\) return;/);
  assert.match(chat, /if \(!token \|\| refreshing\) return;/);
});
