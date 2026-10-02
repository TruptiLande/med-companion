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

export function generateSchedule(
  pattern: string | null | undefined,
  mealTimes: MealTimes = DEFAULT_MEAL_TIMES,
): string[] {
  if (!pattern || !/^[01]-[01]-[01]$/.test(pattern) || pattern === "0-0-0") return [];

  const times = [mealTimes.breakfast, mealTimes.lunch, mealTimes.dinner];
  if (!times.every(isValidClockTime)) return [];

  return pattern.split("-").flatMap((dose, index) => dose === "1" ? [times[index]] : []);
}