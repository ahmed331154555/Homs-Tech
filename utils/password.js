"use strict";

const crypto = require("crypto");

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");

    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);

      resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    const parts = String(storedHash || "").split(":");

    if (parts.length !== 2) {
      return resolve(false);
    }

    const salt = parts[0];
    const storedKey = Buffer.from(parts[1], "hex");

    crypto.scrypt(password, salt, 64, (error, derivedKey) => {
      if (error) return reject(error);

      if (storedKey.length !== derivedKey.length) {
        return resolve(false);
      }

      resolve(crypto.timingSafeEqual(storedKey, derivedKey));
    });
  });
}

module.exports = { hashPassword, verifyPassword };
