import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MEAL_TIMES, generateSchedule, hasExactSourcePhrase, hasExactSourceValue } from "./schedule.js";

test("maps explicit three-slot frequency patterns to configured times", () => {
  assert.deepEqual(generateSchedule("1-0-0"), ["09:00"]);
  assert.deepEqual(generateSchedule("0-1-0"), ["14:00"]);
  assert.deepEqual(generateSchedule("0-0-1"), ["21:00"]);
  assert.deepEqual(generateSchedule("1-0-1"), ["09:00", "21:00"]);
  assert.deepEqual(generateSchedule("1-1-1"), ["09:00", "14:00", "21:00"]);
});

test("supports caregiver-configured meal times", () => {
  assert.deepEqual(generateSchedule("1-0-1", {
    breakfast: "08:15",
    lunch: "13:10",
    dinner: "20:45",
  }), ["08:15", "20:45"]);
});

test("does not guess schedules for missing, ambiguous, or invalid patterns", () => {
  for (const pattern of [null, undefined, "", "twice daily", "1-2-0", "0-0-0", "1-0"]) {
    assert.deepEqual(generateSchedule(pattern), [], String(pattern));
  }
  assert.deepEqual(generateSchedule("1-0-1", { ...DEFAULT_MEAL_TIMES, dinner: "bedtime" }), []);
});

test("requires exact numeric evidence rather than matching inside other values", () => {
  assert.equal(hasExactSourceValue("Directions: 1-0-1 after food", "1-0-1"), true);
  assert.equal(hasExactSourceValue("Directions: 1 - 0 - 1 after food", "1-0-1"), true);
  assert.equal(hasExactSourceValue("Directions: 1 tablet after breakfast", "1-0-1"), false);
  assert.equal(hasExactSourceValue("Take at 09:00", "09:00"), true);
  assert.equal(hasExactSourceValue("Take at 19:00", "09:00"), false);
});

test("matches critical medicine phrases case-insensitively with token boundaries", () => {
  assert.equal(hasExactSourcePhrase("Metformin 500 mg after breakfast", "Metformin"), true);
  assert.equal(hasExactSourcePhrase("Metformin 500 mg after breakfast", "500 mg"), true);
  assert.equal(hasExactSourcePhrase("Metformin 500 mg", "Metfornin"), false);
  assert.equal(hasExactSourcePhrase("Amlo 5 mg", "Amlodipine"), false);
});