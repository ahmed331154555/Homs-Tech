"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.resolve(__dirname, "../assets/homs-admin.css"), "utf8");

test("buyback admin title styling is defined once", () => {
  const rule = "#page-buyback .buyback-option-card .card-title{font-size:16px!important;font-weight:800!important;margin-bottom:6px!important}";
  assert.equal(css.split(rule).length - 1, 1);
});

test("buyback mobile option-row override is defined once", () => {
  const rule = "@media(max-width:700px){#page-buyback .buyback-option-row{grid-template-columns:1fr!important}#page-buyback .buyback-option-row label{margin-top:0!important}}";
  assert.equal(css.split(rule).length - 1, 1);
});


test("phone folder native disclosure marker reset is defined once", () => {
  const rule = ".phone-folder>summary::-webkit-details-marker{display:none}";
  assert.equal(css.split(rule).length - 1, 1);
});

test("phone order detail last-row border override is defined once", () => {
  const rule = "#orderDetailsModal.phone-order-detail-overlay .ht-phone-info-line:last-child{border-bottom:0!important}";
  assert.equal(css.split(rule).length - 1, 1);
});
