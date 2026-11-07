"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { allowLiveChat, liveChatFirstReply } = require("../utils/live-chat");

test("live chat first reply thanks the customer and promises a team member follow-up", () => {
  const reply = liveChatFirstReply();
  assert.match(reply, /Bedankt voor uw bericht/);
  assert.match(reply, /medewerker.*HOMS TECH-team/);
  assert.match(reply, /via deze chat/);
});

test("live chat first reply is fixed and does not depend on the customer's message", () => {
  assert.equal(liveChatFirstReply("Hoi"), liveChatFirstReply("Ik wil een iPhone kopen"));
  assert.equal(liveChatFirstReply("Hallo"), liveChatFirstReply("Mijn scherm is kapot"));
});

test("live chat rate limit allows thirty messages and blocks the thirty-first", () => {
  const originalNow = Date.now;
  let now = 1_800_000_300_000;
  Date.now = () => now;
  const ip = "live-chat-thirty-" + now;
  try {
    for (let request = 0; request < 30; request += 1) assert.equal(allowLiveChat(ip), true);
    assert.equal(allowLiveChat(ip), false);
  } finally { Date.now = originalNow; }
});

test("live chat rate limit is independent per IP and expires after fifteen minutes", () => {
  const originalNow = Date.now;
  let now = 1_800_000_400_000;
  Date.now = () => now;
  const firstIp = "live-chat-first-" + now;
  const secondIp = "live-chat-second-" + now;
  try {
    for (let request = 0; request < 30; request += 1) assert.equal(allowLiveChat(firstIp), true);
    assert.equal(allowLiveChat(firstIp), false);
    assert.equal(allowLiveChat(secondIp), true);
    now += 15 * 60 * 1000;
    assert.equal(allowLiveChat(firstIp), true);
  } finally { Date.now = originalNow; }
});
