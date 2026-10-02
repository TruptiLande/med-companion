import { reminders, ObjectId } from "../db.js";

const activeReminder = { status: { $in: ["scheduled", "due"] } };

export async function sendReminder(id: string, attempt: number): Promise<boolean> {
	const result = await reminders.updateOne(
		{ _id: new ObjectId(id), ...activeReminder },
		{ $set: { status: "due", attempts: attempt, lastSentAt: new Date() }, $unset: { snoozedUntil: "" } },
	);
	return result.matchedCount === 1;
}

export async function markSnoozed(id: string, snoozeMs: number): Promise<boolean> {
	const result = await reminders.updateOne(
		{ _id: new ObjectId(id), status: "due", snoozeUsed: { $ne: true } },
		{ $set: { status: "scheduled", snoozeUsed: true, snoozedUntil: new Date(Date.now() + snoozeMs) } },
	);
	return result.matchedCount === 1;
}

export async function markStatus(id: string, status: "confirmed" | "missed"): Promise<boolean> {
	const result = await reminders.updateOne(
		{ _id: new ObjectId(id), ...activeReminder },
		{
			$set: { status, ...(status === "confirmed" ? { confirmedAt: new Date() } : {}) },
			$unset: { snoozedUntil: "" },
		},
	);
	return result.matchedCount === 1;
}

// MVP: family alert is a flag the dashboard reads. Swap in email/Telegram here later.
export const notifyFamily = (id: string) => reminders.updateOne(
	{ _id: new ObjectId(id), status: "missed" },
	{ $set: { familyNotified: true, familyNotifiedAt: new Date() } },
).then(() => {});
