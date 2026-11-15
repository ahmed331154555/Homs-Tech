"use strict";

function validateRepairQuotePayload(b = {}) {
  if (b.website) return { isSpam: true };

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
  const MAX_SINGLE_PHOTO = 2 * 1024 * 1024;
  const MAX_TOTAL_PHOTOS = 6 * 1024 * 1024;

  for (const photo of incomingPhotos) {
    const type = String(photo?.type || "").toLowerCase();
    const dataUrl = String(photo?.dataUrl || "");
    const match = dataUrl.match(/^data:(image\/(?:jpeg|png|webp|heic));base64,([a-z0-9+/]+={0,2})$/i);
    if (!allowedTypes.has(type) || !match || match[1].toLowerCase() !== type) {
      throw new Error("Een foto heeft een ongeldig formaat. Alleen JPG, PNG, WEBP en HEIC zijn toegestaan.");
    }

    // Estimate decoded bytes from Base64 length instead of allocating a temporary
    // Buffer for every uploaded photo. Browser-generated data URLs are padded;
    // unpadded Base64 remains accepted when its length is valid.
    const encoded = match[2];
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    if ((padding && encoded.length % 4 !== 0) || (!padding && encoded.length % 4 === 1)) {
      throw new Error("Een foto heeft een ongeldig formaat. Alleen JPG, PNG, WEBP en HEIC zijn toegestaan.");
    }
    const photoBytes = Math.floor(encoded.length * 3 / 4) - padding;
    if (photoBytes <= 0 || photoBytes > MAX_SINGLE_PHOTO) {
      throw new Error("Elke foto mag maximaal 2 MB groot zijn.");
    }
    totalPhotoBytes += photoBytes;
    if (totalPhotoBytes > MAX_TOTAL_PHOTOS) {
      throw new Error("De totale grootte van alle foto's mag maximaal 6 MB zijn.");
    }
    photos.push({ name: String(photo.name || "foto").replace(/[\/\\r\\n]/g, "_").slice(0, 140), type, dataUrl });
  }

  return { isSpam: false, brand, model, issue, name, email, phone, photos };
}

module.exports = { validateRepairQuotePayload };
