"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { allowLiveChat, liveChatAutomaticReply } = require("../utils/live-chat");

test("live chat greeting receives the greeting response", () => {
  assert.match(liveChatAutomaticReply("Hoi"), /Welkom bij HOMS TECH/);
  assert.match(liveChatAutomaticReply("GOEDEMORGEN"), /Welkom bij HOMS TECH/);
});

test("live chat normalizes accents and punctuation", () => {
  assert.match(liveChatAutomaticReply("Mijn batterij is kapot!"), /reparatie/);
  assert.match(liveChatAutomaticReply("Ik zoek een téléfoon"), /telefoon zoekt/);
});

test("repair intent takes priority over phone buying intent", () => {
  const reply = liveChatAutomaticReply("Ik wil mijn iPhone kopen maar het scherm is kapot");
  assert.match(reply, /reparatie/);
  assert.doesNotMatch(reply, /budget/);
});

test("phone buying intent asks for model and budget", () => {
  assert.match(liveChatAutomaticReply("Ik zoek een refurbished iPhone"), /budget/);
});

test("order and warranty questions are handed to the team", () => {
  assert.match(liveChatAutomaticReply("Wat is de status van mijn bestelling?"), /door aan ons team/);
  assert.match(liveChatAutomaticReply("Hoe werkt de garantie?"), /door aan ons team/);
});

test("empty and unclear messages receive helpful fallback responses", () => {
  assert.match(liveChatAutomaticReply("   "), /Kunt u iets meer vertellen/);
  assert.match(liveChatAutomaticReply("xyz 123"), /weet nog niet precies/);
});

test("live chat rate limit allows thirty messages and blocks the thirty-first", () => {
  const originalNow = Date.now;
  let now = 1_800_000_300_000;
  Date.now = () => now;
  const ip = "live-chat-thirty-" + now;
  try {
    for (let request = 0; request < 30; request += 1) {
      assert.equal(allowLiveChat(ip), true);
    }
    assert.equal(allowLiveChat(ip), false);
  } finally {
    Date.now = originalNow;
  }
});

test("live chat rate limit is independent per IP and expires after fifteen minutes", () => {
  const originalNow = Date.now;
  let now = 1_800_000_400_000;
  Date.now = () => now;
  const firstIp = "live-chat-first-" + now;
  const secondIp = "live-chat-second-" + now;
  try {
    for (let request = 0; request < 30; request += 1) {
      assert.equal(allowLiveChat(firstIp), true);
    }
    assert.equal(allowLiveChat(firstIp), false);
    assert.equal(allowLiveChat(secondIp), true);
    now += 15 * 60 * 1000;
    assert.equal(allowLiveChat(firstIp), true);
  } finally {
    Date.now = originalNow;
  }
});
