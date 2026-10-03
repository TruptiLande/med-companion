import express from "express";
import cors from "cors";
import multer from "multer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, Connection } from "@temporalio/client";
import { z } from "zod";
import { reminders, medications, ObjectId } from "./db.js";
import { extractMeds, explainMed, type Med } from "./gemma.js";
import { DEFAULT_MEAL_TIMES, isValidClockTime, type MealTimes } from "./schedule.js";
import { getReviewIssues, prepareMedForReview } from "./review.js";
import { getTakenTransition, TAKEABLE_REMINDER_STATUSES } from "./reminder-state.js";
import { medAgent } from "./agent.js";
import { medicationReminderWorkflow, snoozeSignal, takenSignal } from "./temporal/workflows.js";

const run = promisify(execFile);
const pythonExecutable = process.env.PYTHON_EXECUTABLE ?? "python3";
const upload = multer({ dest: "/tmp/rx" });
const temporal = new Client({ connection: await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" }) });
const DEMO = process.env.DEMO === "1";
const app = express();
app.use(cors(), express.json());

const configuredMealTimes: MealTimes = {
  breakfast: process.env.BREAKFAST_TIME ?? DEFAULT_MEAL_TIMES.breakfast,
  lunch: process.env.LUNCH_TIME ?? DEFAULT_MEAL_TIMES.lunch,
  dinner: process.env.DINNER_TIME ?? DEFAULT_MEAL_TIMES.dinner,
};
const mealTimes = Object.values(configuredMealTimes).every(isValidClockTime) ? configuredMealTimes : DEFAULT_MEAL_TIMES;

const ocrResultSchema = z.object({
  text: z.string(),
  lines: z.array(z.object({ text: z.string(), confidence: z.number().nullable() })),
  confidence: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  engine: z.enum(["paddleocr", "easyocr"]),
  needsReview: z.boolean(),
  warnings: z.array(z.string()),
});

const confirmMedSchema = z.object({
  name: z.string().trim().min(1),
  strength: z.string().trim().min(1),
  timesPerDay: z.number().int().positive().nullable(),
  frequencyPattern: z.string().nullable(),
  timing: z.string().nullable(),
  durationDays: z.number().int().min(1).max(365).nullable(),
  schedule: z.array(z.string()),
  uncertainFields: z.array(z.string()),
  caregiverVerified: z.boolean(),
  reviewState: z.enum(["ready", "do_not_schedule"]),
}).passthrough();
const confirmRequestSchema = z.object({ meds: z.array(confirmMedSchema), language: z.string().min(1) });

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a prescription image first." });
  try {
    const { stdout } = await run(pythonExecutable, ["ocr/ocr.py", req.file.path]);
    const ocr = ocrResultSchema.parse(JSON.parse(stdout));
    const sourceReliable = !ocr.needsReview && ocr.confidence >= ocr.threshold;
    const extraction = await extractMeds(ocr.text);
    const meds = extraction.meds.map((med) => prepareMedForReview(med, ocr.text, mealTimes, sourceReliable));
    const reviewState = extraction.error || !sourceReliable || !meds.length || meds.some((med) => med.reviewState === "do_not_schedule")
      ? "do_not_schedule"
      : "ready";
    res.json({
      ocrText: ocr.text,
      ocr: { confidence: ocr.confidence, threshold: ocr.threshold, engine: ocr.engine, needsReview: ocr.needsReview, warnings: ocr.warnings },
      meds,
      reviewState,
      scheduleDefaults: mealTimes,
      error: extraction.error,
    });
  } catch (error) {
    console.error("Prescription analysis failed:", error);
    res.status(500).json({ error: "Could not analyze the prescription. Check the backend terminal for details." });
  }
});

app.post("/api/confirm", async (req, res) => {
  const parsed = confirmRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Review data is incomplete or invalid. Keep the prescription in review." });
  const { meds, language } = parsed.data as { meds: Med[]; language: string };
  if (meds.length === 0) return res.status(400).json({ error: "No medicines are available to confirm. Keep the prescription in review." });
  const unverified = meds.some((med) =>
    med.reviewState !== "ready" || med.caregiverVerified !== true || getReviewIssues(med).length > 0 ||
    med.schedule.length === 0 || med.schedule.some((time) => !isValidClockTime(time)));
  if (unverified) return res.status(400).json({ error: "Resolve all critical fields and verify each medicine before scheduling." });

  const explanations: string[] = [];
  for (const med of meds) explanations.push(await explainMed(med, language));
  const out = [];
  for (const [medicationIndex, med] of meds.entries()) {
    const explanation = explanations[medicationIndex];
    const { insertedId } = await medications.insertOne({ ...med, language, confirmed: true });
    const days = med.durationDays ?? 1;
    for (let day = 0; day < days; day++) for (const [slot, time] of med.schedule.entries()) {
      const [hour, minute] = time.split(":").map(Number);
      const at = new Date();
      at.setDate(at.getDate() + day);
      at.setHours(hour, minute, 0, 0);
      const delayMs = DEMO ? 10_000 * (slot + 1) * (day + 1) : at.getTime() - Date.now();
      if (delayMs < 0) continue;
      const { insertedId: reminderId } = await reminders.insertOne({
        medicationId: insertedId,
        name: `${med.name} ${med.strength}`.trim(),
        language,
        explanation,
        scheduledAt: at,
        status: "scheduled",
        attempts: 0,
      });
      await temporal.workflow.start(medicationReminderWorkflow, {
        taskQueue: "meds",
        workflowId: `rem-${reminderId}`,
        args: [{ reminderId: String(reminderId), delayMs, retryMs: DEMO ? 60_000 : 15 * 60_000 }],
      });
    }
    out.push({ name: med.name, explanation });
  }
  res.json({ explanations: out });
});

app.get("/api/reminders", async (_req, res) => res.json(await reminders.aggregate([
  { $addFields: { _actionPriority: { $cond: [{ $eq: ["$status", "due"] }, 0, 1] } } },
  { $sort: { _actionPriority: 1, scheduledAt: 1 } },
  { $limit: 50 },
  { $project: { _actionPriority: 0 } },
]).toArray()));

app.post("/api/reminders/:id/taken", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid reminder ID." });
  try {
    const reminderId = new ObjectId(req.params.id);
    const reminder = await reminders.findOne({ _id: reminderId });
    const transition = getTakenTransition(reminder?.status);
    if (transition === "not-found") return res.status(404).json({ error: "Reminder not found." });
    if (transition === "already-confirmed") return res.json({ ok: true, status: "confirmed" });
    if (transition === "conflict") return res.status(409).json({ error: "This reminder is no longer active. Refresh the reminder list." });

    const claim = await reminders.updateOne(
      { _id: reminderId, status: { $in: TAKEABLE_REMINDER_STATUSES } },
      { $set: { status: "confirmed", confirmedAt: new Date() } },
    );
    if (claim.matchedCount === 0) {
      const latest = await reminders.findOne({ _id: reminderId });
      const latestTransition = getTakenTransition(latest?.status);
      if (latestTransition === "not-found") return res.status(404).json({ error: "Reminder not found." });
      if (latestTransition === "already-confirmed") return res.json({ ok: true, status: "confirmed" });
      return res.status(409).json({ error: "This reminder is no longer active. Refresh the reminder list." });
    }
    if (reminder?.status === "due") {
      try {
        await temporal.workflow.getHandle(`rem-${req.params.id}`).signal(takenSignal);
      } catch (signalError) {
        if ((signalError as { name?: string }).name !== "WorkflowNotFoundError") console.error("Taken signal delivery failed after confirmation:", signalError);
      }
    }
    return res.json({ ok: true, status: "confirmed" });
  } catch (error) {
    if ((error as { name?: string }).name === "WorkflowNotFoundError") return res.status(409).json({ error: "This reminder has already ended. Refresh the reminder list." });
    console.error("Could not confirm reminder:", error);
    res.status(500).json({ error: "Could not confirm this reminder. Please try again." });
  }
});

app.post("/api/reminders/:id/snooze", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid reminder ID." });
  try {
    const reminder = await reminders.findOne({ _id: new ObjectId(req.params.id) });
    if (!reminder) return res.status(404).json({ error: "Reminder not found." });
    if (reminder.status !== "due") return res.status(409).json({ error: "This reminder is no longer active. Refresh the reminder list." });
    await temporal.workflow.getHandle(`rem-${req.params.id}`).signal(snoozeSignal);
    res.json({ ok: true, snoozeMinutes: 10 });
  } catch (error) {
    if ((error as { name?: string }).name === "WorkflowNotFoundError") return res.status(409).json({ error: "This reminder has already ended. Refresh the reminder list." });
    console.error("Could not snooze reminder:", error);
    res.status(500).json({ error: "Could not snooze this reminder. Please try again." });
  }
});

app.post("/api/tts", async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== "string" || !text.trim()) return res.status(400).end();
  const key = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return res.status(204).end();
  const languageCodes: Record<string, string> = { Marathi: "mr", Hindi: "hi", Tamil: "ta", English: "en" };
  try {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", language_code: languageCodes[req.body.language] ?? "en" }),
    });
    if (!response.ok) return res.status(502).end();
    res.type("audio/mpeg").send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error("ElevenLabs request failed:", error);
    res.status(502).end();
  }
});

app.post("/api/agent", async (req, res) => res.json({ reply: (await medAgent.generate(req.body.message)).text }));
app.listen(3001, () => console.log("API on :3001"));
