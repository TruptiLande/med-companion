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

export function generateSchedule(
  pattern: string | null | undefined,
  mealTimes: MealTimes = DEFAULT_MEAL_TIMES,
): string[] {
  if (!pattern || !/^[01]-[01]-[01]$/.test(pattern) || pattern === "0-0-0") return [];

  const times = [mealTimes.breakfast, mealTimes.lunch, mealTimes.dinner];
  if (!times.every(isValidClockTime)) return [];

  return pattern.split("-").flatMap((dose, index) => dose === "1" ? [times[index]] : []);
}