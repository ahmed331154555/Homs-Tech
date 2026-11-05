"use strict";

const crypto = require("crypto");

function paypalEncryptionKey() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("JWT_SECRET ontbreekt op de server; PayPal-gegevens kunnen niet veilig worden opgeslagen.");
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptPayPalSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", paypalEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  return { iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), data: encrypted.toString("hex") };
}

function decryptPayPalSecret(value) {
  if (!value || !value.iv || !value.tag || !value.data) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", paypalEncryptionKey(), Buffer.from(value.iv, "hex"));
  decipher.setAuthTag(Buffer.from(value.tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(value.data, "hex")), decipher.final()]).toString("utf8");
}

function getPayPalBaseUrl(mode = "sandbox") {
  return String(mode).toLowerCase() === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

module.exports = {
  paypalEncryptionKey,
  encryptPayPalSecret,
  decryptPayPalSecret,
  getPayPalBaseUrl
};
