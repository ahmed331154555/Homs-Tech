"use strict";
function normalizeDutchPostcode(value) {
  const compact = String(value || "").toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/(?:^|\b)([1-9][0-9]{3})\s*([A-Z]{2})(?:\b|$)/);
  return match ? match[1] + match[2] : "";
}
function normalizeCoverageAreas(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(0, 100).map((area, index) => ({
    id: String(area?.id || "area-" + (index + 1)).slice(0, 80),
    name: String(area?.name || "").trim().slice(0, 100),
    postcodes: [...new Set((Array.isArray(area?.postcodes) ? area.postcodes : []).map(normalizeDutchPostcode).filter(Boolean))].slice(0, 1000),
    active: area?.active !== false
  })).filter(area => area.name && area.postcodes.length);
}
function isPostcodeCovered(postcode, areas) {
  const normalized = normalizeDutchPostcode(postcode);
  return !!normalized && normalizeCoverageAreas(areas).some(area => area.active && area.postcodes.includes(normalized));
}
module.exports = { normalizeDutchPostcode, normalizeCoverageAreas, isPostcodeCovered };
