"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {validateSamFwUrl,parseSamFwFirmwarePage}=require("../lib/samfw-import");

test("accepts only HTTPS SamFW firmware detail pages",()=>{
  assert.equal(validateSamFwUrl("https://samfw.com/firmware/SM-G990U3/XAA/G990U3UEU").pathname,"/firmware/SM-G990U3/XAA/G990U3UEU");
  assert.throws(()=>validateSamFwUrl("https://example.com/firmware/SM-G990U3/XAA/build"));
  assert.throws(()=>validateSamFwUrl("http://samfw.com/firmware/SM-G990U3/XAA/build"));
  assert.throws(()=>validateSamFwUrl("https://samfw.com.evil.test/firmware/SM-G990U3/XAA/build"));
  assert.throws(()=>validateSamFwUrl("https://samfw.com/"));
});

test("parses model, region, build and approximate size without inventing a direct link",()=>{
  const url="https://samfw.com/firmware/SM-G990U3/XAA/G990U3UEU";
  const html='<html><head><title>Download Samsung Galaxy S21 FE SM-G990U3 - XAA - G990U3UEU | Samfw</title><meta name="description" content="Official firmware for device"></head><body><h1>Firmware</h1><p>SIZE 7.71 GB</p></body></html>';
  const result=parseSamFwFirmwarePage(html,url);
  assert.match(result.name,/SM-G990U3/);
  assert.equal(result.fileSize,Math.round(7.71*1024**3));
  assert.equal(result.sourceUrl,url);
  assert.ok(result.tags.includes("XAA"));
  assert.equal("downloadUrl" in result,false);
});
