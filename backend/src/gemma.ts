import { z } from "zod";
import { isValidClockTime } from "./schedule.js";

const chat = async (system: string, user: string, json = false): Promise<string> => {
  const r = await fetch(`${process.env.OLLAMA_URL ?? "http://localhost:11434"}/api/chat`, {
    method: "POST",
    body: JSON.stringify({ model: process.env.GEMMA_MODEL ?? "gemma3:4b", stream: false, format: json ? "json" : undefined, options: { temperature: 0 },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
  });
  return (await r.json()).message.content;
};
const uncertainFieldSchema = z.enum(["name", "strength", "frequencyPattern", "timing"]);
const extractedMedSchema = z.object({
  name: z.string().trim().min(1).nullable().default(null),
  strength: z.string().trim().min(1).nullable().default(null),
  timesPerDay: z.number().int().positive().nullable().default(null),
  frequencyPattern: z.string().trim().nullable().default(null),
  timing: z.string().trim().nullable().default(null),
  durationDays: z.number().int().min(1).max(365).nullable().default(null),
  schedule: z.array(z.string()).default([]),
  uncertainFields: z.array(uncertainFieldSchema).default([]),
});

export type Med = z.infer<typeof extractedMedSchema> & {
  caregiverVerified?: boolean;
  reviewState?: "ready" | "do_not_schedule";
  reviewIssues?: string[];
};

export type ExtractionResult = { meds: Med[]; error?: string };
const RULE = "Use ONLY what is written. Never invent, infer or change doses. Use null when unclear.";
export function parseExtractedMeds(output: string): ExtractionResult {
  let value: unknown;
  try { value = JSON.parse(output); } catch { return { meds: [], error: "Medicine extraction returned invalid JSON." }; }
  const result = z.object({ meds: z.array(extractedMedSchema) }).safeParse(value);
  if (!result.success) return { meds: [], error: "Medicine extraction was incomplete or had invalid fields. Review the prescription manually." };
  return { meds: result.data.meds.map((med) => ({
    ...med,
    schedule: med.schedule.filter(isValidClockTime),
  })) };
}

export async function extractMeds(ocrText: string): Promise<ExtractionResult> {
  const out = await chat(`You read prescription OCR text. ${RULE} Reply as JSON {"meds":[{"name":string|null,"strength":string|null,"timesPerDay":number|null,"frequencyPattern":string|null,"timing":string|null,"durationDays":number|null,"schedule":string[],"uncertainFields":string[]}]}. Preserve numeric frequency notation exactly as frequencyPattern when printed (for example 1-0-1). Include schedule times only when exact 24-hour clock times are printed; never infer clock times from breakfast, bedtime, frequency or routine words. Put unclear critical field names in uncertainFields. Use null when unclear and an empty schedule when no exact time is printed.`, ocrText, true);
  return parseExtractedMeds(out);
}
export const explainMed = (m: Med, language: string) =>
  chat(`Explain this medicine to an elderly person in simple ${language}, 2 short sentences: what to take, how often, when. ${RULE} If anything is null, say: please check this with your doctor or pharmacist.`, JSON.stringify(m));
