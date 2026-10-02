import type { Med } from "./gemma.js";
import { DEFAULT_MEAL_TIMES, generateSchedule, hasExactSourcePhrase, hasExactSourceValue, isValidClockTime, type MealTimes } from "./schedule.js";

export function getReviewIssues(med: Med): string[] {
  const issues = [...med.uncertainFields];
  if (!med.name?.trim() && !issues.includes("name")) issues.push("name");
  if (!med.strength?.trim() && !issues.includes("strength")) issues.push("strength");
  if (med.timesPerDay == null && !med.frequencyPattern && !issues.includes("frequency")) issues.push("frequency");
  if (!med.schedule.length && !issues.includes("schedule")) issues.push("schedule");
  return issues;
}

export function prepareMedForReview(
  med: Med,
  ocrText: string,
  mealTimes: MealTimes = DEFAULT_MEAL_TIMES,
  sourceReliable = true,
): Med {
  const nameVerified = Boolean(sourceReliable && med.name && hasExactSourcePhrase(ocrText, med.name));
  const strengthVerified = Boolean(sourceReliable && med.strength && hasExactSourcePhrase(ocrText, med.strength));
  const patternInSource = Boolean(sourceReliable && med.frequencyPattern && hasExactSourceValue(ocrText, med.frequencyPattern));
  const patternFrequency = med.frequencyPattern?.split("-").filter((slot) => slot === "1").length;
  const frequencyMismatch = patternInSource && med.timesPerDay != null && patternFrequency !== med.timesPerDay;
  const patternVerified = patternInSource && !frequencyMismatch;
  const printedSchedule = sourceReliable ? med.schedule.filter((time) => isValidClockTime(time) && hasExactSourceValue(ocrText, time)) : [];
  const uncertainFields = [...med.uncertainFields];
  if (med.name && !nameVerified && !uncertainFields.includes("name")) uncertainFields.push("name");
  if (med.strength && !strengthVerified && !uncertainFields.includes("strength")) uncertainFields.push("strength");
  if (med.frequencyPattern && (!patternInSource || frequencyMismatch) && !uncertainFields.includes("frequencyPattern")) uncertainFields.push("frequencyPattern");
  if (med.schedule.some((time) => isValidClockTime(time) && (!sourceReliable || !hasExactSourceValue(ocrText, time))) && !uncertainFields.includes("schedule")) uncertainFields.push("schedule");

  const frequencyPattern = patternInSource ? med.frequencyPattern : null;
  const hasMissingCriticalField = !nameVerified || !strengthVerified || (med.timesPerDay == null && !patternVerified);
  const canGenerateSchedule = patternVerified && !hasMissingCriticalField && uncertainFields.length === 0;
  const generatedSchedule = printedSchedule.length || !canGenerateSchedule ? [] : generateSchedule(frequencyPattern, mealTimes);
  const schedule = printedSchedule.length ? printedSchedule : generatedSchedule;
  const reviewMed: Med = {
    ...med,
    frequencyPattern,
    durationDays: med.durationDays ?? 1,
    durationDefaulted: med.durationDays == null,
    ocrNeedsReview: !sourceReliable,
    schedule,
    scheduleOrigin: printedSchedule.length ? "prescription" : generatedSchedule.length ? "generated" : "caregiver",
    uncertainFields,
    caregiverVerified: false,
  };
  const reviewIssues = getReviewIssues(reviewMed);
  return { ...reviewMed, reviewIssues, reviewState: reviewIssues.length ? "do_not_schedule" : "ready" };
}