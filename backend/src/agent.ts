import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import { createOllama } from "ollama-ai-provider";
import { z } from "zod";
import { users, medications, reminders } from "./db.js";
const ollama = createOllama({ baseURL: `${process.env.OLLAMA_URL ?? "http://localhost:11434"}/api` });
const setLanguage = createTool({ id: "setPreferredLanguage", description: "Save the user's preferred reminder language", inputSchema: z.object({ language: z.string() }),
  execute: async ({ context }: any) => { await users.updateOne({ name: "default" }, { $set: { language: context.language } }, { upsert: true }); return { saved: context.language }; } });
const getMeds = createTool({ id: "getMedications", description: "List confirmed medications", inputSchema: z.object({}),
  execute: async () => ({ meds: await medications.find({ confirmed: true }).project({ _id: 0 }).toArray() }) });
const getStatus = createTool({ id: "getReminderStatus", description: "Show recent reminder statuses", inputSchema: z.object({}),
  execute: async () => ({ reminders: await reminders.find().sort({ scheduledAt: -1 }).limit(10).project({ _id: 0 }).toArray() }) });
export const medAgent = new Agent({
  name: "Medication Assistant",
  instructions: "You help older adults and their families with an already-confirmed medication schedule. Answer in the user's language. Never prescribe, change doses or give clinical advice; refer those questions to a doctor or pharmacist.",
  model: ollama(process.env.GEMMA_MODEL ?? "gemma3:4b") as any,
  tools: { setLanguage, getMeds, getStatus },
});
