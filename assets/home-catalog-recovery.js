(function () {
  "use strict";

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const clean = (value) => String(value == null ? "" : value).trim();
  const money = (value) => {
    const raw = clean(value).replace(/^€\s*/, "");
    return raw ? "€ " + raw : "";
  };
  const firstImage = (value) => {
    if (typeof value === "string") return clean(value);
    if (Array.isArray(value)) return value.map(firstImage).find(Boolean) || "";
    if (value && typeof value === "object")
      return Object.values(value).map(firstImage).find(Boolean) || "";
    return "";
  };
  const safeText = (value) => clean(value).replace(/[&<>"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"
  })[char]);

  async function fetchCatalog() {
    for (const view of ["product", "devices"]) {
      try {
        const response = await fetch("/api/site?view=" + view, {
          headers: { Accept: "application/json" },
          cache: "no-store"
        });
        if (!response.ok) continue;
        const payload = await response.json();
        const phones = Array.isArray(payload && payload.phones)
          ? payload.phones.filter((phone) => phone && typeof phone === "object")
          : [];
        if (phones.length) return phones;
      } catch (error) {
        console.warn("[HOMEPAGE RECOVERY] " + view + " catalog request failed.", error);
      }
    }
    return [];
  }

  function renderFallback(box, phones) {
    if (!box || box.querySelector(".product")) return;
    const cards = [];
    phones.slice(-12).reverse().forEach((phone, index) => {
      const rows = Array.isArray(phone.variantPrices)
        ? phone.variantPrices.filter((row) => row && row.active !== false)
        : [];
      const variant = rows.find((row) => clean(row.color) && clean(row.storage)) || rows[0] || {};
      const color = clean(variant.color || phone.color || phone.kleur);
      const storage = clean(variant.storage || phone.storage || phone.geheugen);
      const image = firstImage(
        (color && phone.colorGalleryImages && phone.colorGalleryImages[color]) ||
        (color && phone.colorImages && phone.colorImages[color]) ||
        phone.image || phone.imageUrl || phone.images
      );
      const price = variant.price || phone.salePrice || phone.sellPrice || phone.price || phone.verkoopprijs;
      const stockValue = Number(variant.stock ?? phone.stock);
      const stockKnown = Number.isFinite(stockValue);
      const stockLabel = stockKnown
        ? (stockValue > 0 ? "Op voorraad" : "Uitverkocht")
        : "Beschikbaarheid opvragen";

      const card = document.createElement("article");
      card.className = "product";
      card.style.cssText = "flex:0 0 78vw;width:78vw;min-width:78vw;max-width:330px;display:flex;flex-direction:column;gap:0;background:transparent;border:0;box-shadow:none;cursor:pointer";
      const picture = document.createElement("div");
      picture.className = "product-img";
      picture.style.cssText = "width:100%;aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;background:var(--bg,#f7f7f4);overflow:hidden";
      if (image) {
        const img = document.createElement("img");
        img.src = image;
        img.alt = clean(phone.name || phone.title || "HOMS TECH apparaat");
        img.loading = index < 3 ? "eager" : "lazy";
        img.decoding = "async";
        img.style.cssText = "width:100%;height:100%;object-fit:contain;object-position:center";
        picture.appendChild(img);
      }
      const body = document.createElement("div");
      body.className = "product-body";
      body.style.cssText = "display:flex;flex-direction:column;align-items:flex-start;gap:5px;padding:13px 0 0";
      body.innerHTML =
        "<h3>" + safeText(phone.name || phone.title || "Apparaat") + "</h3>" +
        "<div class='meta'>" + [color, storage].filter(Boolean).map(safeText).join(" | ") + "</div>" +
        (price ? "<div class='price'>" + safeText(money(price)) + "</div>" : "") +
        "<div class='product-stock'><span class='stock-dot'></span>" + stockLabel + "</div>";
      const productId = phone._index ?? phone.id ?? index;
      card.addEventListener("click", () => {
        const params = new URLSearchParams({ type: "phone", id: String(productId) });
        if (storage) params.set("storage", storage);
        if (color) params.set("color", color);
        window.location.href = "product.html?" + params.toString();
      });
      card.append(picture, body);
      cards.push(card);
    });
    if (!cards.length) return;
    box.classList.remove("auto-moving");
    box.style.display = "flex";
    box.style.visibility = "visible";
    box.style.overflowX = "auto";
    box.style.minHeight = "240px";
    box.replaceChildren(...cards);
    console.info("[HOMEPAGE RECOVERY] Rendered " + cards.length + " product cards from the public catalog.");
  }

  async function recover() {
    const box = document.getElementById("products");
    if (!box) return;
    // Give the normal homepage loader time to render before using the independent fallback.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (box.querySelector(".product")) return;
      await wait(150);
    }
    if (box.querySelector(".product")) return;
    const phones = await fetchCatalog();
    if (box.querySelector(".product")) return;
    renderFallback(box, phones);
    if (!box.querySelector(".product")) {
      box.style.display = "flex";
      box.style.visibility = "visible";
      box.style.minHeight = "72px";
      box.innerHTML = "<p role='status' style='padding:18px 0;color:#667784'>Apparaten tijdelijk niet beschikbaar. Bekijk alle apparaten.</p>";
      console.error("[HOMEPAGE RECOVERY] Both homepage rendering and public catalog fallback returned no products.");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", recover, { once: true });
  } else {
    recover();
  }
})();
