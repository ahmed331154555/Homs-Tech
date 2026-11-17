"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const navigation = fs.readFileSync(
  path.resolve(__dirname, "../assets/homs-global-nav.js"),
  "utf8"
);

test("navigation drawer shared group selectors are defined once", () => {
  const selectors = [
    "#homsMenuDrawer .homs-menu-label{",
    "#homsMenuDrawer .homs-menu-group{",
    "#homsMenuDrawer .homs-menu-group+.homs-menu-group{"
  ];

  for (const selector of selectors) {
    assert.equal(
      navigation.split(selector).length - 1,
      1,
      selector + " should have one rule"
    );
  }
});
