"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeDutchPostcode, normalizeCoverageAreas, isPostcodeCovered, isLocationCovered } = require("../utils/repair-coverage");
test("normalizes and extracts valid Dutch postcodes", () => {
  assert.equal(normalizeDutchPostcode("3011 AA"), "3011AA");
  assert.equal(normalizeDutchPostcode("3011aa Rotterdam"), "3011AA");
  assert.equal(normalizeDutchPostcode("0123 AB"), "");
  assert.equal(normalizeDutchPostcode("1234 A"), "");
});
test("matches only explicitly configured active areas", () => {
  const areas = [{name:"Centrum",postcodes:["3011 AA","3012 AB"]},{name:"Paused",postcodes:["3013AA"],active:false}];
  assert.equal(isPostcodeCovered("3011AA Rotterdam", areas), true);
  assert.equal(isPostcodeCovered("3013 AA", areas), false);
  assert.equal(isPostcodeCovered("9999 ZZ", areas), false);
});
test("matches configured city names without requiring postcode lists", () => {
  const areas = [{name:"Rotterdam"},{name:"Den Haag",active:false}];
  assert.equal(isLocationCovered("3011 AA Rotterdam", areas), true);
  assert.equal(isLocationCovered("Den Haag", areas), false);
  assert.equal(isLocationCovered("Delft", areas), false);
});
test("ignores area records without a name", () => {
  assert.deepEqual(normalizeCoverageAreas([{name:"",postcodes:["3011AA"]}]), []);
});
