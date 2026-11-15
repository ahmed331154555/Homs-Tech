"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const adminHtml = fs.readFileSync(path.join(root, "admin/index.html"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "assets/homs-admin.js"), "utf8");

test("admin navigation and pages use permissions that can be assigned", () => {
  assert.match(adminJs, /buyback:"site\.save"/);
  assert.doesNotMatch(adminJs, /buyback:"buyback\.view"/);
  assert.match(adminHtml, /data-page="buyback" data-permission="site\.save"/);
  assert.match(adminHtml, /id="page-buyback" data-permission="site\.save"/);
});

test("customer management is hidden unless the administrator can view customers", () => {
  assert.match(adminHtml, /data-page="customers" data-permission="customers\.view"/);
  assert.match(adminHtml, /id="page-customers" data-permission="customers\.view"/);
});

test("view-only admin navigation is gated by its corresponding permission", () => {
  for (const [page, permission] of [
    ["general", "general.view"],
    ["services", "services.view"],
    ["phones", "phones.view"],
    ["why", "why.view"]
  ]) {
    assert.match(adminHtml, new RegExp('data-page="' + page + '"[^>]*data-permission="' + permission.replace(".", "\\.") + '"'));
  }
});
