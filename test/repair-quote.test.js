"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validateRepairQuotePayload } = require("../utils/repair-quote");
const { validateBuybackOfferedPrice } = require("../utils/buyback-order");


test("accepts valid repair quote request with photos and consent", () => {
  const dummyBase64 = Buffer.from("small test image content").toString("base64");
  const payload = {
    brand: "Apple",
    model: "iPhone 14 Pro",
    issue: "Gebroken scherm na val",
    name: "Jan Jansen",
    email: "jan@example.com",
    phone: "0612345678",
    consent: true,
    photos: [
      { name: "scherm.jpg", type: "image/jpeg", dataUrl: `data:image/jpeg;base64,${dummyBase64}` }
    ]
  };

  const res = validateRepairQuotePayload(payload);
  assert.equal(res.isSpam, false);
  assert.equal(res.brand, "Apple");
  assert.equal(res.model, "iPhone 14 Pro");
  assert.equal(res.photos.length, 1);
});

test("silently flags honeypot spam without processing", () => {
  const payload = {
    website: "http://spam-bot.example",
    brand: "Apple",
    model: "iPhone",
    issue: "Spam",
    name: "Bot",
    email: "bot@example.com",
    consent: true
  };
  const res = validateRepairQuotePayload(payload);
  assert.equal(res.isSpam, true);
});

test("rejects request missing consent or required fields", () => {
  assert.throws(() => validateRepairQuotePayload({
    brand: "Apple",
    model: "iPhone",
    issue: "Stuk",
    name: "Jan",
    email: "jan@example.com",
    consent: false
  }), /Vul alle verplichte velden in/);
});

test("rejects invalid email formats", () => {
  assert.throws(() => validateRepairQuotePayload({
    brand: "Samsung",
    model: "Galaxy S22",
    issue: "Accu loopt snel leeg",
    name: "Piet",
    email: "not-an-email",
    consent: true
  }), /Vul een geldig e-mailadres in/);
});

test("enforces maximum 4 photos limit", () => {
  const dummy = Buffer.from("data").toString("base64");
  const photos = Array(5).fill({
    name: "img.jpg",
    type: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,${dummy}`
  });
  assert.throws(() => validateRepairQuotePayload({
    brand: "Apple",
    model: "iPhone 12",
    issue: "Glas gebarsten",
    name: "Klaas",
    email: "klaas@example.com",
    consent: true,
    photos
  }), /maximaal 4 foto's/);
});

test("rejects unsupported photo MIME types", () => {
  const dummy = Buffer.from("data").toString("base64");
  assert.throws(() => validateRepairQuotePayload({
    brand: "Apple",
    model: "iPhone 12",
    issue: "Glas gebarsten",
    name: "Klaas",
    email: "klaas@example.com",
    consent: true,
    photos: [{ name: "hack.exe", type: "application/octet-stream", dataUrl: `data:application/octet-stream;base64,${dummy}` }]
  }), /ongeldig formaat/);
});

test("rejects malformed Base64 padding without decoding a temporary Buffer", () => {
  assert.throws(() => validateRepairQuotePayload({
    brand: "Apple",
    model: "iPhone 12",
    issue: "Glas gebarsten",
    name: "Klaas",
    email: "klaas@example.com",
    consent: true,
    photos: [{ name: "img.jpg", type: "image/jpeg", dataUrl: "data:image/jpeg;base64,AA=" }]
  }), /ongeldig formaat/);
});

test("enforces total photo payload budget (max 6 MB combined)", () => {
  // 4 photos of 1.8 MB each: each is under 2 MB, but total is 7.2 MB (> 6 MB)
  const singleBuffer = Buffer.alloc(Math.round(1.8 * 1024 * 1024));
  const singleBase64 = singleBuffer.toString("base64");
  const photos = [
    { name: "photo1.jpg", type: "image/jpeg", dataUrl: `data:image/jpeg;base64,${singleBase64}` },
    { name: "photo2.jpg", type: "image/jpeg", dataUrl: `data:image/jpeg;base64,${singleBase64}` },
    { name: "photo3.jpg", type: "image/jpeg", dataUrl: `data:image/jpeg;base64,${singleBase64}` },
    { name: "photo4.jpg", type: "image/jpeg", dataUrl: `data:image/jpeg;base64,${singleBase64}` }
  ];
  assert.throws(() => validateRepairQuotePayload({
    brand: "Apple",
    model: "iPhone 13",
    issue: "Schade",
    name: "Jan",
    email: "jan@example.com",
    consent: true,
    photos
  }), /maximaal 6 MB zijn/);
});


test("validates buyback offered prices using the production validator", () => {
  assert.equal(validateBuybackOfferedPrice(85.5), 85.5);
  assert.equal(validateBuybackOfferedPrice("120.00"), 120);
  assert.equal(validateBuybackOfferedPrice(0), 0);
  assert.throws(() => validateBuybackOfferedPrice("-10"), /Ongeldige prijs/);
  assert.throws(() => validateBuybackOfferedPrice("not-a-price"), /Ongeldige prijs/);
});
