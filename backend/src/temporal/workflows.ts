import { proxyActivities, defineSignal, setHandler, condition, sleep } from "@temporalio/workflow";
import type * as acts from "./activities.js";
const { sendReminder, markSnoozed, notifyFamily, markStatus } = proxyActivities<typeof acts>({ startToCloseTimeout: "1 minute", retry: { maximumAttempts: 5 } });
export const takenSignal = defineSignal("taken");
export const snoozeSignal = defineSignal("snooze");
const SNOOZE_MS = 10 * 60_000;

export async function medicationReminderWorkflow(a: { reminderId: string; delayMs: number; retryMs: number }) {
  let taken = false;
  let snoozeRequested = false;
  let snoozeUsed = false;
  let finished = false;
  setHandler(takenSignal, () => { if (!finished) taken = true; });
  setHandler(snoozeSignal, () => { if (!finished && !snoozeUsed) snoozeRequested = true; });
  await sleep(a.delayMs);

  let attempt = 0;
  while (attempt < 2) {
    if (taken) {
      finished = true;
      return await markStatus(a.reminderId, "confirmed") ? "confirmed" : "already-finished";
    }
    attempt++;
    if (!(await sendReminder(a.reminderId, attempt))) { finished = true; return "already-finished"; }

    await condition(() => taken || snoozeRequested, a.retryMs);
    if (taken) {
      finished = true;
      return await markStatus(a.reminderId, "confirmed") ? "confirmed" : "already-finished";
    }
    if (snoozeRequested && !snoozeUsed) {
      snoozeUsed = true;
      snoozeRequested = false;
      if (!(await markSnoozed(a.reminderId, SNOOZE_MS))) { finished = true; return "already-finished"; }
      if (await condition(() => taken, SNOOZE_MS)) {
        finished = true;
        return await markStatus(a.reminderId, "confirmed") ? "confirmed" : "already-finished";
      }
      attempt--;
    }
  }

  finished = true;
  const markedMissed = await markStatus(a.reminderId, "missed");
  if (!markedMissed) return "already-finished";
  await notifyFamily(a.reminderId);
  return "missed";
}
