"use strict";

/**
 * Returns the decoded byte length for a syntactically valid Base64 string.
 * Returns null for malformed input. Does not allocate a decoded Buffer.
 */
function base64ByteLength(value) {
  if (typeof value !== "string" || value.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return null;
  }

  const firstPadding = value.indexOf("=");
  const padding = firstPadding === -1 ? 0 : value.length - firstPadding;
  const dataLength = value.length - padding;

  if (padding > 0 && value.length % 4 !== 0) return null;
  if (padding === 2 && dataLength % 4 !== 2) return null;
  if (padding === 1 && dataLength % 4 !== 3) return null;
  if (padding === 0 && dataLength % 4 === 1) return null;

  const byteLength = Math.floor(dataLength * 3 / 4);
  return byteLength > 0 ? byteLength : null;
}

module.exports = { base64ByteLength };
