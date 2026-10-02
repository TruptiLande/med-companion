import assert from "node:assert/strict";
import { test } from "node:test";
import { parseExtractedMeds } from "./gemma.js";

test("validates extracted fields and removes non-clock schedule values", () => {
  const result = parseExtractedMeds(JSON.stringify({
    meds: [{
      name: "Metformin",
      strength: "500 mg",
      timesPerDay: 2,
      frequencyPattern: "1-0-1",
      timing: "after food",
      durationDays: 30,
      schedule: ["09:00", "after breakfast"],
      uncertainFields: [],
    }],
  }));

  assert.equal(result.error, undefined);
  assert.deepEqual(result.meds[0].schedule, ["09:00"]);
  assert.equal(result.meds[0].frequencyPattern, "1-0-1");
});

test("preserves missing critical fields for do-not-schedule review", () => {
  const result = parseExtractedMeds(JSON.stringify({ meds: [{ name: null, strength: null }] }));

  assert.equal(result.error, undefined);
  assert.equal(result.meds[0].name, null);
  assert.equal(result.meds[0].strength, null);
  assert.deepEqual(result.meds[0].uncertainFields, []);
});

test("returns a blocking error for malformed JSON or invalid field types", () => {
  assert.ok(parseExtractedMeds("{").error);
  assert.ok(parseExtractedMeds(JSON.stringify({ meds: [{ name: 5 }] })).error);
  assert.ok(parseExtractedMeds(JSON.stringify({ meds: [{ durationDays: 500 }] })).error);
});