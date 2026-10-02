import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_MEAL_TIMES, generateSchedule } from "./schedule.js";

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