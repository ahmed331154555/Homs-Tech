"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { invoicePdfEscape } = require("../utils/invoice-pdf");

test("invoicePdfEscape escapes PDF string delimiters and backslashes", () => {
  assert.equal(invoicePdfEscape("A (test) \\ file"), "A \\(test\\) \\\\ file");
});

test("invoicePdfEscape replaces unsupported characters after NFKD normalization", () => {
  assert.equal(invoicePdfEscape("café"), "cafe?");
  assert.equal(invoicePdfEscape("Phone 📱"), "Phone ??");
});

test("invoicePdfEscape safely converts nullish and numeric values", () => {
  assert.equal(invoicePdfEscape(null), "");
  assert.equal(invoicePdfEscape(undefined), "");
  assert.equal(invoicePdfEscape(123), "123");
});
