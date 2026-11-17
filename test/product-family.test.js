"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  productBaseModel,
  getProductFamilyRecords,
} = require("../utils/product-family");

test("product family matching groups storage and color variants but not other models", () => {
  const phones = [
    { name: "iPhone 15 Pro 128GB Black" },
    { name: "iPhone 15 Pro 256GB Black" },
    { name: "iPhone 15 Pro 128GB Blue" },
    { name: "iPhone 15" },
    { name: "iPhone 16 Pro 128GB Black" },
  ];

  assert.equal(productBaseModel(phones[0]), "iphone 15 pro");
  assert.deepEqual(
    getProductFamilyRecords(phones, 1).map((item) => item.index),
    [0, 1, 2],
  );
});

test("product family matching honors explicit catalog family and direct color", () => {
  const phones = [
    {
      name: "iPhone 15 Pro 128GB",
      catalogFamily: "iPhone 15 Pro",
      color: "Black",
    },
    {
      name: "iPhone 15 Pro 256GB",
      catalogFamily: "iPhone 15 Pro",
      color: "Blue",
    },
    { name: "iPhone 14 128GB", catalogFamily: "iPhone 14", color: "Black" },
  ];

  assert.deepEqual(
    getProductFamilyRecords(phones, 0).map((item) => item.index),
    [0, 1],
  );
});

test("product family matching safely handles invalid indexes and records", () => {
  assert.deepEqual(getProductFamilyRecords([], 0), []);
  assert.deepEqual(getProductFamilyRecords([null], 0), []);
  assert.deepEqual(getProductFamilyRecords([{ name: "iPhone 15" }], -1), []);
});
