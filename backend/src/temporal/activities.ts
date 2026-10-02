import { reminders, ObjectId } from "../db.js";
const set = (id: string, s: object) => reminders.updateOne({ _id: new ObjectId(id) }, { $set: s });
export const sendReminder = (id: string, attempt: number) => set(id, { status: "due", attempts: attempt, lastSentAt: new Date() }).then(() => {});
export const markStatus = (id: string, status: string) => set(id, { status, ...(status === "confirmed" ? { confirmedAt: new Date() } : {}) }).then(() => {});
// MVP: family alert is a flag the dashboard reads. Swap in email/Telegram here later.
export const notifyFamily = (id: string) => set(id, { familyNotified: true, familyNotifiedAt: new Date() }).then(() => {});
