"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

// Helper to simulate the validation logic from server.js
function validateRepairQuotePayload(b) {
  if (b.website) {
    return { isSpam: true, success: true, requestNo: 0 };
  }

  const brand = String(b.brand || "").trim().slice(0, 80);
  const model = String(b.model || "").trim().slice(0, 100);
  const issue = String(b.issue || "").trim().slice(0, 3000);
  const name = String(b.name || "").trim().slice(0, 120);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 254);
  const phone = String(b.phone || "").trim().slice(0, 40);

  if (!brand || !model || !issue || !name || !email || b.consent !== true) {
    throw new Error("Vul alle verplichte velden in en geef toestemming om contact op te nemen.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Vul een geldig e-mailadres in.");
  }

  const incomingPhotos = Array.isArray(b.photos) ? b.photos : [];
  if (incomingPhotos.length > 4) {
    throw new Error("U kunt maximaal 4 foto's toevoegen.");
  }

  const photos = [];
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
  let totalPhotoBytes = 0;
  const MAX_SINGLE_PHOTO = 2 * 1024 * 1024; // 2 MB
  const MAX_TOTAL_PHOTOS = 6 * 1024 * 1024; // 6 MB combined

  for (const photo of incomingPhotos) {
    const type = String(photo?.type || "").toLowerCase();
    const dataUrl = String(photo?.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|heic));base64,([a-z0-9+/=]+)$/i);
    if (!allowedTypes.has(type) || !match || match[1].toLowerCase() !== type) {
      throw new Error("Een foto heeft een ongeldig formaat. Alleen JPG, PNG, WEBP en HEIC zijn toegestaan.");
    }
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_SINGLE_PHOTO) {
      throw new Error("Elke foto mag maximaal 2 MB groot zijn.");
    }
    totalPhotoBytes += bytes.length;
    if (totalPhotoBytes > MAX_TOTAL_PHOTOS) {
      throw new Error("De totale grootte van alle foto's mag maximaal 6 MB zijn.");
    }
    photos.push({ name: String(photo.name || "foto").replace(/[\/\\r\\n]/g, "_").slice(0, 140), type, dataUrl });
  }

  return { isSpam: false, brand, model, issue, name, email, phone, photos };
}

function parseAndValidateOfferPrice(priceInput) {
  const sanitized = String(priceInput ?? "").trim().replace(",", ".");
  const price = Number(sanitized);
  if (!sanitized || !Number.isFinite(price) || price < 0 || price > 100000) {
    throw new Error("Vul een geldige prijs in (tussen 0 en 100.000).");
  }
  const formattedPrice = price.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rawPrice = price.toFixed(2);
  return { price, formattedPrice, rawPrice };
}

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

test("rejects unauthorized photo mime-types or executable extensions", () => {
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

test("parses both comma and dot decimal prices safely", () => {
  const withComma = parseAndValidateOfferPrice("85,50");
  assert.equal(withComma.price, 85.50);
  assert.equal(withComma.rawPrice, "85.50");
  assert.equal(withComma.formattedPrice, "85,50");

  const withDot = parseAndValidateOfferPrice("120.00");
  assert.equal(withDot.price, 120.00);
  assert.equal(withDot.rawPrice, "120.00");
  assert.equal(withDot.formattedPrice, "120,00");
});

test("rejects negative, empty or absurd offer prices", () => {
  assert.throws(() => parseAndValidateOfferPrice("-10"), /geldige prijs/);
  assert.throws(() => parseAndValidateOfferPrice(""), /geldige prijs/);
  assert.throws(() => parseAndValidateOfferPrice("geen-prijs"), /geldige prijs/);
  assert.throws(() => parseAndValidateOfferPrice("200000"), /geldige prijs/);
});
