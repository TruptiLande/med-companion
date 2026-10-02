import assert from "node:assert/strict";
import { test } from "node:test";
import type { Med } from "./gemma.js";
import { prepareMedForReview } from "./review.js";

const medicine = (overrides: Partial<Med> = {}): Med => ({
  name: "TestMed",
  strength: "5 mg",
  timesPerDay: 1,
  frequencyPattern: null,
  timing: "after food",
  durationDays: 30,
  schedule: [],
  uncertainFields: [],
  ...overrides,
});

test("does not schedule a model-invented pattern or clock time", () => {
  const result = prepareMedForReview(medicine({
    frequencyPattern: "1-0-1",
    schedule: ["09:00", "21:00"],
  }), "TestMed 5 mg; 1 tablet once daily after breakfast; 30 days");

  assert.equal(result.reviewState, "do_not_schedule");
  assert.deepEqual(result.schedule, []);
  assert.ok(result.reviewIssues?.includes("frequencyPattern"));
  assert.ok(result.reviewIssues?.includes("schedule"));
});

test("generates only a source-verified pattern when critical fields are present", () => {
  const result = prepareMedForReview(medicine({ timesPerDay: 2, frequencyPattern: "1-0-1" }), "TestMed 5 mg; 1-0-1 after food; 30 days");

  assert.equal(result.reviewState, "ready");
  assert.deepEqual(result.schedule, ["09:00", "21:00"]);
  assert.equal(result.scheduleOrigin, "generated");
  assert.equal(result.caregiverVerified, false);
});

test("does not generate while a critical field is missing or uncertain", () => {
  const missing = prepareMedForReview(medicine({ strength: null, frequencyPattern: "1-0-1" }), "TestMed 1-0-1");
  const uncertain = prepareMedForReview(medicine({ frequencyPattern: "1-0-1", uncertainFields: ["timing"] }), "TestMed 5 mg 1-0-1");

  assert.equal(missing.reviewState, "do_not_schedule");
  assert.deepEqual(missing.schedule, []);
  assert.equal(uncertain.reviewState, "do_not_schedule");
  assert.deepEqual(uncertain.schedule, []);
});

test("accepts exact printed clock times as review evidence", () => {
  const result = prepareMedForReview(medicine({ schedule: ["09:00"] }), "TestMed 5 mg once daily at 09:00");

  assert.equal(result.reviewState, "ready");
  assert.deepEqual(result.schedule, ["09:00"]);
  assert.equal(result.scheduleOrigin, "prescription");
});

test("low-confidence OCR suppresses schedules until caregiver review", () => {
  const result = prepareMedForReview(medicine({
    frequencyPattern: "1-0-1",
    schedule: ["09:00"],
  }), "TestMed 5 mg 1-0-1 at 09:00", undefined, false);

  assert.equal(result.reviewState, "do_not_schedule");
  assert.equal(result.ocrNeedsReview, true);
  assert.deepEqual(result.schedule, []);
});

test("keeps conflicting frequency fields in do-not-schedule review", () => {
  const result = prepareMedForReview(
    medicine({ timesPerDay: 1, frequencyPattern: "1-0-1" }),
    "TestMed 5 mg 1-0-1 after food",
  );

  assert.equal(result.reviewState, "do_not_schedule");
  assert.equal(result.frequencyPattern, "1-0-1");
  assert.ok(result.reviewIssues?.includes("frequencyPattern"));
  assert.deepEqual(result.schedule, []);
});

test("requires extracted name and strength to appear in OCR source", () => {
  const result = prepareMedForReview(
    medicine({ name: "Metfornin", strength: "500 mg", timesPerDay: 2, frequencyPattern: "1-0-1" }),
    "Metformin 500 mg 1-0-1 after food",
  );

  assert.equal(result.reviewState, "do_not_schedule");
  assert.ok(result.reviewIssues?.includes("name"));
  assert.deepEqual(result.schedule, []);
});