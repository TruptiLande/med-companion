import assert from "node:assert/strict";
import { test } from "node:test";
import { getTakenTransition } from "./reminder-state.js";

test("allows explicit confirmation for due and missed reminders", () => {
  assert.equal(getTakenTransition("due"), "confirm");
  assert.equal(getTakenTransition("missed"), "confirm");
});

test("keeps repeated confirmation idempotent and rejects inactive states", () => {
  assert.equal(getTakenTransition("confirmed"), "already-confirmed");
  assert.equal(getTakenTransition("scheduled"), "conflict");
  assert.equal(getTakenTransition(undefined), "not-found");
});