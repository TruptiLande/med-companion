import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { users, medications, reminders } from "../../db.js";

export const setLanguageTool = createTool({
  id: "setPreferredLanguage",
  description: "Save the user's preferred reminder language",
  inputSchema: z.object({ language: z.string() }),
  execute: async ({ language }) => {
    await users.updateOne({ name: "default" }, { $set: { language } }, { upsert: true });
    return { saved: language };
  },
});

export const getMedicationsTool = createTool({
  id: "getMedications",
  description: "List confirmed medications",
  inputSchema: z.object({}),
  execute: async () => ({
    meds: await medications.find({ confirmed: true }).project({ _id: 0 }).toArray(),
  }),
});

export const getReminderStatusTool = createTool({
  id: "getReminderStatus",
  description: "Show recent reminder statuses",
  inputSchema: z.object({}),
  execute: async () => ({
    reminders: await reminders.find().sort({ scheduledAt: -1 }).limit(10).project({ _id: 0 }).toArray(),
  }),
});
