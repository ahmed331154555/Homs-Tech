"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRepairQuotePayload, parseAndValidateOfferPrice } = require("../lib/repair-quote-validation");

const validPayload = (overrides = {}) => ({
  brand: " Apple ",
  model: "iPhone 14 Pro",
  issue: "Gebroken scherm",
  name: "Jan Jansen",
  email: "JAN@example.com",
  phone: "0612345678",
  consent: true,
  ...overrides
});

test("validates and normalizes a repair quote payload", () => {
  const result = validateRepairQuotePayload(validPayload());
  assert.equal(result.isSpam, false);
  assert.equal(result.brand, "Apple");
  assert.equal(result.email, "jan@example.com");
  assert.deepEqual(result.photos, []);
});

test("flags honeypot payloads without processing them", () => {
  assert.deepEqual(validateRepairQuotePayload(validPayload({ website: "spam.example" })), { isSpam: true });
});

test("rejects missing required fields or consent", () => {
  assert.match(validateRepairQuotePayload(validPayload({ consent: false })).error, /verplichte velden/);
  assert.match(validateRepairQuotePayload(validPayload({ model: "" })).error, /verplichte velden/);
});

test("rejects invalid email addresses", () => {
  assert.match(validateRepairQuotePayload(validPayload({ email: "not-an-email" })).error, /geldig e-mailadres/);
});

test("accepts up to four valid photos and sanitizes filenames", () => {
  const dataUrl = "data:image/jpeg;base64," + Buffer.from("test-image").toString("base64");
  const result = validateRepairQuotePayload(validPayload({ photos: [{ name: "../screen\n.jpg", type: "image/jpeg", dataUrl }] }));
  assert.equal(result.photos.length, 1);
  assert.equal(result.photos[0].name.includes("\n"), false);
});

test("rejects more than four photos", () => {
  const dataUrl = "data:image/jpeg;base64," + Buffer.from("test").toString("base64");
  const photos = Array.from({ length: 5 }, () => ({ name: "x.jpg", type: "image/jpeg", dataUrl }));
  assert.match(validateRepairQuotePayload(validPayload({ photos })).error, /maximaal 4 foto's/);
});

test("rejects invalid photo types and data URLs", () => {
  const result = validateRepairQuotePayload(validPayload({ photos: [{ name: "x.exe", type: "application/octet-stream", dataUrl: "data:application/octet-stream;base64,AAAA" }] }));
  assert.match(result.error, /ongeldig formaat/);
});

test("enforces per-photo size limit", () => {
  const dataUrl = "data:image/jpeg;base64," + Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64");
  const result = validateRepairQuotePayload(validPayload({ photos: [{ name: "large.jpg", type: "image/jpeg", dataUrl }] }));
  assert.match(result.error, /maximaal 2 MB/);
});

test("enforces combined photo size limit", () => {
  const dataUrl = "data:image/jpeg;base64," + Buffer.alloc(Math.floor(1.7 * 1024 * 1024)).toString("base64");
  const photos = Array.from({ length: 4 }, (_, i) => ({ name: "photo" + i + ".jpg", type: "image/jpeg", dataUrl }));
  assert.match(validateRepairQuotePayload(validPayload({ photos })).error, /totale grootte.*6 MB/);
});

test("parses comma and dot decimal offer prices", () => {
  assert.equal(parseAndValidateOfferPrice("85,50").rawPrice, "85.50");
  assert.equal(parseAndValidateOfferPrice("120.00").formattedPrice, "120,00");
});

test("rejects invalid offer prices", () => {
  for (const value of ["", "-10", "geen-prijs", "100001"]) {
    assert.ok(parseAndValidateOfferPrice(value).error);
  }
});
