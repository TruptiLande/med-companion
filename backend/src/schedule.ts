export type MealTimes = {
  breakfast: string;
  lunch: string;
  dinner: string;
};

export const DEFAULT_MEAL_TIMES: MealTimes = {
  breakfast: "09:00",
  lunch: "14:00",
  dinner: "21:00",
};

export const isValidClockTime = (value: string): boolean =>
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export function hasExactSourceValue(source: string, value: string): boolean {
  const parts = value.split("-").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = parts.join("[\\s‐‑‒–—−-]*");
  return new RegExp(`(^|[^0-9])${pattern}(?![0-9])`).test(source);
}

export function hasExactSourcePhrase(source: string, value: string): boolean {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const phrase = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`(^|[^A-Za-z0-9])${phrase}($|[^A-Za-z0-9])`, "i").test(source);
}

const DAILY_FREQUENCY_PHRASES: Record<number, string[]> = {
  1: ["once daily", "once a day", "one time daily", "one time a day", "one time per day", "1 time daily", "1 time a day", "1 time per day", "दिवसातून एकदा", "रोज एकदा", "दिन में एक बार", "रोज एक बार", "ஒரு நாளைக்கு ஒரு முறை", "தினமும் ஒருமுறை"],
  2: ["twice daily", "twice a day", "two times daily", "two times a day", "two times per day", "2 times daily", "2 times a day", "2 times per day", "दिवसातून दोनदा", "दिन में दो बार", "நாளுக்கு இரண்டு முறை"],
  3: ["three times daily", "three times a day", "three times per day", "3 times daily", "3 times a day", "3 times per day", "दिवसातून तीनदा", "दिन में तीन बार", "நாளுக்கு மூன்று முறை"],
};

export function hasExplicitDailyFrequency(source: string, dosesPerDay: number): boolean {
  return DAILY_FREQUENCY_PHRASES[dosesPerDay]?.some((phrase) => hasExactSourcePhrase(source, phrase)) ?? false;
}

export function mealPatternFromTiming(timing: string, dosesPerDay: number): string | null {
  const anchors = ["breakfast", "lunch", "dinner"];
  const slots = anchors.map((anchor) => new RegExp(`(^|[^A-Za-z])${anchor}($|[^A-Za-z])`, "i").test(timing));
  if (slots.filter(Boolean).length !== dosesPerDay) return null;
  return slots.map((present) => present ? "1" : "0").join("-");
}

export function generateSchedule(
  pattern: string | null | undefined,
  mealTimes: MealTimes = DEFAULT_MEAL_TIMES,
): string[] {
  if (!pattern || !/^[01]-[01]-[01]$/.test(pattern) || pattern === "0-0-0") return [];

  const times = [mealTimes.breakfast, mealTimes.lunch, mealTimes.dinner];
  if (!times.every(isValidClockTime)) return [];

  return pattern.split("-").flatMap((dose, index) => dose === "1" ? [times[index]] : []);
}