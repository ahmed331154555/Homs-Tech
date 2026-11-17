"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const navigation = fs.readFileSync(
  path.resolve(__dirname, "../assets/homs-global-nav.js"),
  "utf8"
);

test("navigation drawer base CSS rules are not duplicated", () => {
  const rules = [
    "#homsMenuDrawer .homs-menu-label{padding:18px 22px 8px;color:#687d90;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}",
    "#homsMenuDrawer .homs-menu-group{padding:0 18px 10px}",
    "#homsMenuDrawer .homs-menu-group+.homs-menu-group{border-top:1px solid #edf1f5}"
  ];

  for (const rule of rules) {
    assert.equal(
      navigation.split(rule).length - 1,
      1,
      rule + " should be defined once"
    );
  }
});
