"use strict";

// Builds sitemap.xml from the static pages plus the public catalogue, so product
// pages (which are only reachable through JavaScript-rendered cards) are
// discoverable by search engines.

const BASE_URL = "https://homs-tech.nl";
const MAX_URLS = 5000;

const STATIC_PAGES = [
  "/",
  "/devices.html",
  "/shop.html",
  "/services.html",
  "/prices.html",
  "/repair.html",
  "/uw-toestel-verkopen.html",
  "/reviews.html",
  "/about.html",
  "/contact.html",
  "/privacybeleid.html",
];

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSitemapUrls({
  phones = [],
  shopProducts = [],
  shopEnabled = true,
  hasServices = false,
} = {}) {
  const urls = [];
  for (const path of STATIC_PAGES) {
    if (path === "/shop.html" && !shopEnabled) continue;
    if (path === "/services.html" && !hasServices) continue;
    urls.push(BASE_URL + path);
  }

  (Array.isArray(phones) ? phones : []).forEach((phone, index) => {
    if (!phone || typeof phone !== "object" || phone.active === false) return;
    if (!String(phone.name || phone.model || "").trim()) return;
    urls.push(`${BASE_URL}/product.html?type=phone&id=${index}`);
  });

  if (shopEnabled) {
    for (const product of Array.isArray(shopProducts) ? shopProducts : []) {
      if (!product || typeof product !== "object" || product.active === false) {
        continue;
      }
      const id = String(product.id || "").trim();
      if (!id || id.length > 160) continue;
      urls.push(`${BASE_URL}/shop.html?product=${encodeURIComponent(id)}`);
    }
  }
  return urls.slice(0, MAX_URLS);
}

function buildSitemapXml(options) {
  const body = buildSitemapUrls(options)
    .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`)
    .join("\n");
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body +
    "\n</urlset>\n"
  );
}

module.exports = { buildSitemapUrls, buildSitemapXml, STATIC_PAGES, BASE_URL };
