"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { base64ByteLength } = require("../utils/base64");

test("calculates decoded byte length without decoding Base64", () => {
  assert.equal(base64ByteLength("YQ=="), 1);
  assert.equal(base64ByteLength("YWI="), 2);
  assert.equal(base64ByteLength("YWJj"), 3);
  assert.equal(base64ByteLength("YWI"), 2);
  assert.equal(base64ByteLength("YWJjZA"), 4);
});

test("rejects empty, malformed and invalidly padded Base64", () => {
  for (const value of ["", "A", "AA=", "A===", "YW=J", "YWJj$"]) {
    assert.equal(base64ByteLength(value), null, value);
  }
});
