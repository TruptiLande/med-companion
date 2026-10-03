export const TAKEABLE_REMINDER_STATUSES = ["due", "missed"] as const;

export type TakenTransition = "confirm" | "already-confirmed" | "conflict" | "not-found";

export function getTakenTransition(status: string | undefined): TakenTransition {
  if (status === undefined) return "not-found";
  if (status === "confirmed") return "already-confirmed";
  if ((TAKEABLE_REMINDER_STATUSES as readonly string[]).includes(status)) return "confirm";
  return "conflict";
}