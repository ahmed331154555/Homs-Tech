"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adminJs = fs.readFileSync(path.resolve(__dirname, "../assets/homs-admin.js"), "utf8");

test("admin live chat polling pauses while the tab is hidden", () => {
  assert.match(adminJs, /function stopLiveChatPolling\(\)[\s\S]*?clearInterval\(liveChatRefreshTimer\)/);
  assert.match(adminJs, /function startLiveChatPolling\(\)[\s\S]*?if\(currentPage!=="live-chat"\|\|document\.hidden\)return/);
  assert.match(adminJs, /document\.addEventListener\("visibilitychange",[\s\S]*?if\(document\.hidden\)stopLiveChatPolling\(\)/);
});

test("admin live chat polling does not overlap refresh requests", () => {
  assert.match(adminJs, /liveChatRefreshInFlight=false/);
  assert.match(adminJs, /if\(!list\|\|currentPage!=="live-chat"\|\|document\.hidden\|\|liveChatRefreshInFlight\)return/);
  assert.match(adminJs, /finally\{liveChatRefreshInFlight=false;\}/);
});

test("leaving the live chat page stops its polling timer", () => {
  assert.match(adminJs, /if\(currentPage==="live-chat"&&page!=="live-chat"\)stopLiveChatPolling\(\)/);
  assert.match(adminJs, /if\(page==="live-chat"\)startLiveChatPolling\(\)/);
});
