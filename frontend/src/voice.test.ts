import assert from "node:assert/strict";
import { test } from "node:test";
import { isTakenPhrase } from "./voice.js";

test("matches spoken taken confirmations in selected languages", () => {
  assert.equal(isTakenPhrase("मी घेतली।", "Marathi"), true);
  assert.equal(isTakenPhrase("me ghetli", "Marathi"), true);
  assert.equal(isTakenPhrase("I took it.", "English"), true);
  assert.equal(isTakenPhrase("मैंने दवा ले ली", "Hindi"), true);
  assert.equal(isTakenPhrase("நான் எடுத்தேன்", "Tamil"), true);
  assert.equal(isTakenPhrase("मी घेतली", "Hindi"), true);
});

test("does not treat unrelated or uncertain speech as confirmation", () => {
  assert.equal(isTakenPhrase("I will take it later", "English"), false);
  assert.equal(isTakenPhrase("maybe I took it", "English"), false);
  assert.equal(isTakenPhrase("मी घेतली आहे", "Hindi"), false);
});