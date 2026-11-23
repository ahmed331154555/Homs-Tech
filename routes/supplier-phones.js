"use strict";

const { getSupplierProducts } = require("../services/suppliers");

function registerSupplierPhonesRoutes(app, dependencies = {}) {
  const loadProducts = dependencies.getSupplierProducts || getSupplierProducts;

  app.get("/api/supplier-phones", async (req, res) => {
    const supplier = String(req.query.supplier || "")
      .trim()
      .toLowerCase();
    if (supplier && !["forza", "mobico"].includes(supplier)) {
      return res.status(400).json({ error: "Ongeldige leverancier." });
    }

    try {
      const result = await loadProducts({ supplier: supplier || undefined });
      const query = String(req.query.q || "")
        .trim()
        .toLowerCase();
      const brand = String(req.query.brand || "")
        .trim()
        .toLowerCase();
      const products = result.products.filter((product) => {
        const searchable = [
          product.name,
          product.brand,
          product.model,
          product.sku,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return (
          (!query || searchable.includes(query)) &&
          (!brand || String(product.brand || "").toLowerCase() === brand)
        );
      });

      res.set("Cache-Control", "no-store");
      return res.json({
        products,
        suppliers: result.suppliers.map(
          ({ supplier: name, configured, error }) => ({
            name,
            configured,
            ...(error ? { error } : {}),
          }),
        ),
        count: products.length,
      });
    } catch (error) {
      console.error("[SUPPLIER PHONES] Feed failed:", error);
      return res
        .status(503)
        .json({
          error: "Leveranciersproducten zijn tijdelijk niet beschikbaar.",
        });
    }
  });
}

module.exports = { registerSupplierPhonesRoutes };
