import { proxyActivities, defineSignal, setHandler, condition, sleep } from "@temporalio/workflow";
import type * as acts from "./activities.js";
const { sendReminder, notifyFamily, markStatus } = proxyActivities<typeof acts>({ startToCloseTimeout: "1 minute", retry: { maximumAttempts: 5 } });
export const takenSignal = defineSignal("taken");
export async function medicationReminderWorkflow(a: { reminderId: string; delayMs: number; retryMs: number }) {
  let taken = false;
  setHandler(takenSignal, () => { taken = true; });
  await sleep(a.delayMs);
  for (let attempt = 1; attempt <= 2; attempt++) {
    await sendReminder(a.reminderId, attempt);
    if (await condition(() => taken, a.retryMs)) { await markStatus(a.reminderId, "confirmed"); return "confirmed"; }
  }
  await notifyFamily(a.reminderId);
  await markStatus(a.reminderId, "missed");
  return "missed";
}
