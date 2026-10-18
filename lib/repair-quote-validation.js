"use strict";

const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX_SINGLE_PHOTO = 2 * 1024 * 1024;
const MAX_TOTAL_PHOTOS = 6 * 1024 * 1024;

function validateRepairQuotePayload(payload) {
  const b = payload && typeof payload === "object" ? payload : {};
  if (b.website) return { isSpam: true };

  const brand = String(b.brand || "").trim().slice(0, 80);
  const model = String(b.model || "").trim().slice(0, 100);
  const issue = String(b.issue || "").trim().slice(0, 3000);
  const name = String(b.name || "").trim().slice(0, 120);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 254);
  const phone = String(b.phone || "").trim().slice(0, 40);

  if (!brand || !model || !issue || !name || !email || b.consent !== true) {
    return { error: "Vul alle verplichte velden in en geef toestemming om contact op te nemen." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Vul een geldig e-mailadres in." };
  }

  const incomingPhotos = Array.isArray(b.photos) ? b.photos : [];
  if (incomingPhotos.length > 4) return { error: "U kunt maximaal 4 foto's toevoegen." };

  const photos = [];
  let totalPhotoBytes = 0;
  for (const photo of incomingPhotos) {
    const type = String(photo?.type || "").toLowerCase();
    const dataUrl = String(photo?.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|heic));base64,([a-z0-9+/=]+)$/i);
    if (!ALLOWED_PHOTO_TYPES.has(type) || !match || match[1].toLowerCase() !== type) {
      return { error: "Een foto heeft een ongeldig formaat. Alleen JPG, PNG, WEBP en HEIC zijn toegestaan." };
    }
    const bytes = Buffer.from(match[2], "base64");
    if (!bytes.length || bytes.length > MAX_SINGLE_PHOTO) return { error: "Elke foto mag maximaal 2 MB groot zijn." };
    totalPhotoBytes += bytes.length;
    if (totalPhotoBytes > MAX_TOTAL_PHOTOS) return { error: "De totale grootte van alle foto's mag maximaal 6 MB zijn." };
    photos.push({
      name: String(photo.name || "foto").replace(/[\/\\\r\n]/g, "_").slice(0, 140),
      type,
      dataUrl
    });
  }
  return { isSpam: false, brand, model, issue, name, email, phone, photos };
}

function parseAndValidateOfferPrice(priceInput) {
  const sanitized = String(priceInput ?? "").trim().replace(",", ".");
  const price = Number(sanitized);
  if (!sanitized || !Number.isFinite(price) || price < 0 || price > 100000) {
    return { error: "Vul een geldige prijs in (tussen 0 en 100.000)." };
  }
  return {
    price,
    formattedPrice: price.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    rawPrice: price.toFixed(2)
  };
}

module.exports = { validateRepairQuotePayload, parseAndValidateOfferPrice };
