import express from "express";
import cors from "cors";
import multer from "multer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client, Connection } from "@temporalio/client";
import { reminders, medications, ObjectId } from "./db.js";
import { extractMeds, explainMed, type Med } from "./gemma.js";
import { DEFAULT_MEAL_TIMES, generateSchedule, isValidClockTime, type MealTimes } from "./schedule.js";
import { medAgent } from "./agent.js";
import { medicationReminderWorkflow, takenSignal } from "./temporal/workflows.js";

const run = promisify(execFile);
const pythonExecutable = process.env.PYTHON_EXECUTABLE ?? "python3";
const upload = multer({ dest: "/tmp/rx" });
const temporal = new Client({ connection: await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233" }) });
const DEMO = process.env.DEMO === "1";
const app = express();
app.use(cors(), express.json());
const mealTimes: MealTimes = {
  breakfast: process.env.BREAKFAST_TIME ?? DEFAULT_MEAL_TIMES.breakfast,
  lunch: process.env.LUNCH_TIME ?? DEFAULT_MEAL_TIMES.lunch,
  dinner: process.env.DINNER_TIME ?? DEFAULT_MEAL_TIMES.dinner,
};

const getReviewIssues = (med: Med): string[] => {
  const issues = [...med.uncertainFields];
  if (!med.name?.trim() && !issues.includes("name")) issues.push("name");
  if (!med.strength?.trim() && !issues.includes("strength")) issues.push("strength");
  if (med.timesPerDay == null && !med.frequencyPattern && !issues.includes("frequency")) issues.push("frequency");
  if (!med.schedule.length && !issues.includes("schedule")) issues.push("schedule");
  return issues;
};

app.post("/api/analyze", upload.single("image"), async (req, res) => {
  try {
    const { stdout } = await run(pythonExecutable, ["ocr/ocr.py", req.file!.path]);
    const extraction = await extractMeds(stdout);
    const meds = extraction.meds.map((m) => {
      const printedSchedule = m.schedule.filter(isValidClockTime);
      const generatedSchedule = printedSchedule.length ? [] : generateSchedule(m.frequencyPattern, mealTimes);
      const schedule = printedSchedule.length ? printedSchedule : generatedSchedule;
      const reviewIssues = getReviewIssues({ ...m, schedule });
      return {
        ...m,
        durationDays: m.durationDays ?? 1,
        durationDefaulted: m.durationDays == null,
        schedule,
        scheduleOrigin: printedSchedule.length ? "prescription" as const : generatedSchedule.length ? "generated" as const : "caregiver" as const,
        reviewIssues,
        reviewState: reviewIssues.length ? "do_not_schedule" as const : "ready" as const,
        caregiverVerified: false,
      };
    });
    const reviewState = extraction.error || !meds.length || meds.some((m) => m.reviewState === "do_not_schedule")
      ? "do_not_schedule"
      : "ready";
    res.json({ ocrText: stdout, meds, reviewState, scheduleDefaults: mealTimes, error: extraction.error });
  } catch (e) { console.error("Prescription analysis failed:", e); res.status(500).json({ error: "Could not read the prescription. Check the backend terminal for details." }); }
});

app.post("/api/confirm", async (req, res) => {
  const { meds, language } = req.body as { meds: Med[]; language: string };
  if (!Array.isArray(meds) || meds.length === 0)
    return res.status(400).json({ error: "No medicines are available to confirm. Keep the prescription in review." });
  const unverified = meds.some((m) =>
    m.reviewState !== "ready" || m.caregiverVerified !== true || getReviewIssues(m).length > 0 ||
    !Array.isArray(m.schedule) || m.schedule.length === 0 || m.schedule.some((time) => !isValidClockTime(time)));
  if (unverified)
    return res.status(400).json({ error: "Resolve all critical fields and verify each medicine before scheduling." });
  if (meds.some((m) => m.durationDays != null && (!Number.isInteger(m.durationDays) || m.durationDays < 1 || m.durationDays > 365)))
    return res.status(400).json({ error: "Duration must be between 1 and 365 days." });
  const explanations: string[] = [];
  for (const m of meds) explanations.push(await explainMed(m, language));
  const out = [];
  for (const [medicationIndex, m] of meds.entries()) {
    const explanation = explanations[medicationIndex];
    const { insertedId } = await medications.insertOne({ ...m, language, confirmed: true });
    const days = m.durationDays ?? 1;
    for (let d = 0; d < days; d++) for (const [i, t] of (m.schedule ?? []).entries()) {
      const [h, min] = t.split(":").map(Number);
      const at = new Date(); at.setDate(at.getDate() + d); at.setHours(h, min, 0, 0);
      const delayMs = DEMO ? 10_000 * (i + 1) * (d + 1) : at.getTime() - Date.now();
      if (delayMs < 0) continue;
      const r = await reminders.insertOne({ medicationId: insertedId, name: `${m.name} ${m.strength ?? ""}`.trim(), language, explanation, scheduledAt: at, status: "scheduled", attempts: 0 });
      await temporal.workflow.start(medicationReminderWorkflow, { taskQueue: "meds", workflowId: `rem-${r.insertedId}`,
        args: [{ reminderId: String(r.insertedId), delayMs, retryMs: DEMO ? 60_000 : 15 * 60_000 }] });
    }
    out.push({ name: m.name, explanation });
  }
  res.json({ explanations: out });
});

app.get("/api/reminders", async (_q, res) => res.json(await reminders.aggregate([
  { $addFields: { _actionPriority: { $cond: [{ $eq: ["$status", "due"] }, 0, 1] } } },
  { $sort: { _actionPriority: 1, scheduledAt: 1 } },
  { $limit: 50 },
  { $project: { _actionPriority: 0 } },
]).toArray()));
app.post("/api/reminders/:id/taken", async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid reminder ID." });
  try {
    const reminder = await reminders.findOne({ _id: new ObjectId(req.params.id) });
    if (!reminder) return res.status(404).json({ error: "Reminder not found." });
    if (reminder.status === "confirmed") return res.json({ ok: true, status: "confirmed" });
    if (reminder.status !== "due") return res.status(409).json({ error: "This reminder is no longer active. Refresh the reminder list." });
    await temporal.workflow.getHandle(`rem-${req.params.id}`).signal(takenSignal);
    res.json({ ok: true });
  } catch (e) {
    if ((e as { name?: string }).name === "WorkflowNotFoundError")
      return res.status(409).json({ error: "This reminder has already ended. Refresh the reminder list." });
    console.error("Could not confirm reminder:", e);
    res.status(500).json({ error: "Could not confirm this reminder. Please try again." });
  }
});

app.post("/api/tts", async (req, res) => {
  const key = process.env.ELEVENLABS_API_KEY, voice = process.env.ELEVENLABS_VOICE_ID;
  if (!key || !voice) return res.status(204).end(); // UI falls back to text
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, { method: "POST", headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ text: req.body.text, model_id: "eleven_multilingual_v2" }) });
  if (!r.ok) return res.status(502).end();
  res.type("audio/mpeg").send(Buffer.from(await r.arrayBuffer()));
});

app.post("/api/agent", async (req, res) => res.json({ reply: (await medAgent.generate(req.body.message)).text }));
app.listen(3001, () => console.log("API on :3001"));
