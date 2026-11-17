"use strict";

const BASE_URL = (process.env.HOMS_BASE_URL || "https://homs-tech.nl").replace(
  /\/$/,
  "",
);
const TIMEOUT_MS = 20000;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, expectedType) {
  const started = Date.now();
  const maxAttempts = 9;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(new URL(path, BASE_URL), {
        redirect: "follow",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": "HOMS-TECH-production-smoke/1.0" },
      });
      const elapsedMs = Date.now() - started;
      const contentType = response.headers.get("content-type") || "";
      const retryableStatus =
        [502, 503, 504].includes(response.status) ||
        (expectedType === "image/" && response.status === 404);

      if (retryableStatus && attempt < maxAttempts) {
        console.warn(
          `RETRY ${response.status} ${path} attempt ${attempt}/${maxAttempts}`,
        );
        await delay(4000);
        continue;
      }
      if (!response.ok) {
        throw new Error(`${path}: HTTP ${response.status}`);
      }
      if (expectedType && !contentType.toLowerCase().includes(expectedType)) {
        throw new Error(`${path}: unexpected content-type ${contentType}`);
      }
      const body = await response.text();
      if (!body.trim()) throw new Error(`${path}: empty response body`);
      console.log(`PASS ${response.status} ${path} ${elapsedMs}ms`);
      if (elapsedMs > 5000) console.warn(`SLOW ${path}: ${elapsedMs}ms`);
      return { response, body, elapsedMs };
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      console.warn(
        `RETRY ${path} attempt ${attempt}/${maxAttempts}: ${error.message}`,
      );
      await delay(4000);
    }
  }

  throw lastError || new Error(`${path}: request failed`);
}

async function requestJson(path) {
  const { body } = await request(path, "application/json");
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${path}: response is not valid JSON`);
  }
}

async function verifyImage(path, expectedPrefix) {
  if (typeof path !== "string" || !path.startsWith(expectedPrefix)) return;
  const { response, body } = await request(path, "image/");
  if (!body.length) throw new Error(`${path}: empty image`);
  if (Number(response.headers.get("content-length") || 0) > 5 * 1024 * 1024) {
    throw new Error(`${path}: image exceeds 5 MiB`);
  }
}

async function main() {
  const pages = [
    "/",
    "/about.html",
    "/devices.html",
    "/shop.html",
    "/repair.html",
    "/prices.html",
    "/checkout.html",
    "/admin/index.html",
  ];
  for (const page of pages) await request(page, "text/html");

  const [devices, shop, repair, footer] = await Promise.all([
    requestJson("/api/site?view=devices"),
    requestJson("/api/site?view=shop"),
    requestJson("/api/site?view=repair"),
    requestJson("/api/site?view=footer"),
  ]);

  if (!Array.isArray(devices.phones)) {
    throw new Error("devices API: phones must be an array");
  }
  if (!Array.isArray(shop.shopProducts)) {
    throw new Error("shop API: shopProducts must be an array");
  }
  if (!Array.isArray(repair.services)) {
    throw new Error("repair API: services must be an array");
  }
  if (!footer || typeof footer !== "object") {
    throw new Error("footer API: expected a JSON object");
  }
  console.log(
    `CATALOG devices=${devices.phones.length} shop=${shop.shopProducts.length} repairServices=${repair.services.length}`,
  );

  for (const view of ["home", "about", "prices", "cart"]) {
    const payload = await requestJson(`/api/site?view=${view}`);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error(`${view} API: expected a JSON object`);
    }
    if (view === "cart" && !Array.isArray(payload.shopProducts)) {
      throw new Error("cart API: shopProducts must be an array");
    }
  }

  const productIndex = devices.phones.findIndex(
    (item) => item && item.active !== false,
  );
  if (productIndex >= 0) {
    const productPayload = await requestJson(`/api/product/${productIndex}`);
    if (!productPayload || !productPayload.product) {
      throw new Error("public product API: missing product payload");
    }
  }

  const phone = devices.phones.find((item) => item && item.id != null);
  if (phone) {
    const candidates = [
      phone.image,
      ...(Array.isArray(phone.images) ? phone.images : []),
      ...Object.values(phone.colorImages || {}),
      ...Object.values(phone.colorGalleryImages || {}).flat(),
    ];
    const imagePath = candidates.find(
      (value) =>
        typeof value === "string" && value.startsWith("/api/devices/image/"),
    );
    if (imagePath) await verifyImage(imagePath, "/api/devices/image/");
  }

  const product = shop.shopProducts.find((item) => item && item.images?.length);
  const shopImage = product?.images?.find(
    (value) =>
      typeof value === "string" && value.startsWith("/api/shop/image/"),
  );
  if (shopImage) await verifyImage(shopImage, "/api/shop/image/");

  console.log("PRODUCTION SMOKE CHECK PASSED");
}

main().catch((error) => {
  console.error("PRODUCTION SMOKE CHECK FAILED:", error.message);
  process.exitCode = 1;
});
