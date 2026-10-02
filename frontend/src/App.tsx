import { useEffect, useRef, useState } from "react";
type MealTimes = { breakfast: string; lunch: string; dinner: string };
type Med = {
  name: string | null;
  strength: string | null;
  timesPerDay: number | null;
  frequencyPattern: string | null;
  timing: string | null;
  durationDays: number | null;
  durationDefaulted?: boolean;
  schedule: string[];
  scheduleOrigin: "prescription" | "generated" | "caregiver";
  uncertainFields: string[];
  reviewIssues: string[];
  reviewState: "ready" | "do_not_schedule";
  caregiverVerified: boolean;
};
type Rem = { _id: string; name: string; explanation: string; language?: string; status: string; attempts: number; familyNotified?: boolean; scheduledAt: string };
type OcrInfo = { confidence: number; threshold: number; engine: string; needsReview: boolean; warnings: string[] };
const LANGS = ["Marathi", "Hindi", "Tamil", "English"];
const DEFAULT_MEAL_TIMES: MealTimes = { breakfast: "09:00", lunch: "14:00", dinner: "21:00" };
const validClockTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

const scheduleFromPattern = (pattern: string | null, mealTimes: MealTimes) => {
  if (!pattern || !/^[01]-[01]-[01]$/.test(pattern) || pattern === "0-0-0") return [];
  const times = [mealTimes.breakfast, mealTimes.lunch, mealTimes.dinner];
  if (!times.every(validClockTime)) return [];
  return pattern.split("-").flatMap((dose, index) => dose === "1" ? [times[index]] : []);
};

const reviewIssuesFor = (med: Med) => {
  const issues = [...(med.uncertainFields ?? [])];
  if (!med.name?.trim() && !issues.includes("name")) issues.push("name");
  if (!med.strength?.trim() && !issues.includes("strength")) issues.push("strength");
  if (med.timesPerDay == null && !med.frequencyPattern && !issues.includes("frequency")) issues.push("frequency");
  if (!med.schedule?.length || med.schedule.some((time) => !validClockTime(time))) {
    if (!issues.includes("schedule")) issues.push("schedule");
  }
  return issues;
};

export default function App() {
  const [tab, setTab] = useState<"setup" | "reminders" | "family">("setup");
  const [lang, setLang] = useState("Marathi");
  const [meds, setMeds] = useState<Med[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [rems, setRems] = useState<Rem[]>([]);
  const [ocrText, setOcrText] = useState("");
  const [ocrInfo, setOcrInfo] = useState<OcrInfo | null>(null);
  const [prescriptionImage, setPrescriptionImage] = useState("");
  const [mealTimes, setMealTimes] = useState<MealTimes>(DEFAULT_MEAL_TIMES);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const autoSpoken = useRef(new Set<string>());

  useEffect(() => { const t = setInterval(() => fetch("/api/reminders").then((r) => r.json()).then(setRems).catch(() => {}), 3000); return () => clearInterval(t); }, []);

  useEffect(() => () => { if (prescriptionImage) URL.revokeObjectURL(prescriptionImage); }, [prescriptionImage]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refreshVoices = () => setBrowserVoices(window.speechSynthesis.getVoices());
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices);
  }, []);

  const analyze = async (f: File) => {
    setBusy(true); setMsg("");
    setPrescriptionImage(URL.createObjectURL(f));
    try {
      const fd = new FormData(); fd.append("image", f);
      const r = await fetch("/api/analyze", { method: "POST", body: fd }); const j = await r.json();
      if (!r.ok) { setMeds([]); setMsg(j.error ?? "Could not analyze this image."); return; }
      setOcrText(j.ocrText ?? "");
      setOcrInfo(j.ocr ?? null);
      if (j.scheduleDefaults) setMealTimes(j.scheduleDefaults);
      setMeds(Array.isArray(j.meds) ? j.meds : []);
      if (j.error) setMsg(j.error);
      else if (!j.meds?.length) setMsg("No medicines were extracted. Keep this prescription in review and check the image.");
      else if (j.reviewState === "do_not_schedule") setMsg("Do not schedule yet. Resolve the highlighted fields and verify each medicine.");
    } catch {
      setMeds([]);
      setMsg("Could not reach the analysis service. Your prescription image remains available for review.");
    } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!meds?.length || meds.some((m) => m.reviewState !== "ready" || !m.caregiverVerified || reviewIssuesFor(m).length > 0)) {
      setMsg("Do not schedule yet. Resolve critical fields and verify each medicine against the prescription.");
      return;
    }
    if (meds.some((m) => m.durationDays !== null && (!Number.isInteger(m.durationDays) || m.durationDays < 1 || m.durationDays > 365))) {
      setMsg("Duration must be between 1 and 365 days.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ meds, language: lang }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setMsg(result.error ?? "Could not confirm this prescription. Review it and try again."); return; }
      setMeds(null); setTab("reminders"); setMsg("");
    } catch { setMsg("Could not reach the scheduling service. Your review remains available."); }
    finally { setBusy(false); }
  };
  const edit = (i: number, p: Partial<Med>) => setMeds((current) => current?.map((m, j) => {
    if (j !== i) return m;
    const editedFields = Object.keys(p);
    const uncertainFields = m.uncertainFields.filter((field) => !editedFields.includes(field) && !(editedFields.includes("timesPerDay") && field === "frequencyPattern"));
    const next = { ...m, ...p, uncertainFields, caregiverVerified: false };
    if (editedFields.includes("frequencyPattern") || editedFields.includes("timesPerDay")) {
      next.schedule = scheduleFromPattern(next.frequencyPattern, mealTimes);
      next.scheduleOrigin = next.schedule.length ? "generated" : "caregiver";
    }
    if (editedFields.includes("schedule")) next.scheduleOrigin = "caregiver";
    next.reviewIssues = reviewIssuesFor(next);
    next.reviewState = next.reviewIssues.length ? "do_not_schedule" : "ready";
    return next;
  }) ?? null);
  const addManualMedicine = () => setMeds((current) => [...(current ?? []), {
    name: null,
    strength: null,
    timesPerDay: null,
    frequencyPattern: null,
    timing: null,
    durationDays: 1,
    durationDefaulted: true,
    schedule: [],
    scheduleOrigin: "caregiver",
    uncertainFields: [],
    reviewIssues: ["name", "strength", "frequency", "schedule"],
    reviewState: "do_not_schedule",
    caregiverVerified: false,
  }]);
  const verify = (i: number, checked: boolean) => {
    const currentMed = meds?.[i];
    if (!currentMed) return;
    const reviewIssues = reviewIssuesFor(currentMed);
    if (checked && reviewIssues.length) {
      setMsg("Resolve the highlighted fields before verifying this medicine.");
      return;
    }
    setMeds((current) => current?.map((m, j) => j === i
      ? { ...m, caregiverVerified: checked, reviewIssues, reviewState: reviewIssues.length ? "do_not_schedule" : "ready" }
      : m) ?? null);
  };
  const speakInBrowser = async (r: Rem): Promise<boolean> => {
    if (!("speechSynthesis" in window)) return false;
    const availableVoices = browserVoices.length ? browserVoices : await new Promise<SpeechSynthesisVoice[]>((resolve) => {
      const initial = window.speechSynthesis.getVoices();
      if (initial.length) return resolve(initial);
      const onVoicesChanged = () => {
        window.clearTimeout(timeout);
        resolve(window.speechSynthesis.getVoices());
      };
      const timeout = window.setTimeout(() => {
        window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
        resolve(window.speechSynthesis.getVoices());
      }, 1500);
      window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged, { once: true });
    });
    const locales: Record<string, string> = { Marathi: "mr-IN", Hindi: "hi-IN", Tamil: "ta-IN", English: "en-IN" };
    const utterance = new SpeechSynthesisUtterance(r.explanation);
    utterance.lang = locales[r.language ?? "English"] ?? "en-IN";
    const voice = availableVoices.find((candidate) => candidate.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2).toLowerCase()));
    if (!voice) return false;
    utterance.voice = voice;
    setMsg("");
    window.speechSynthesis.cancel();
    return new Promise((resolve) => {
      utterance.onend = () => resolve(true);
      utterance.onerror = () => resolve(false);
      window.speechSynthesis.speak(utterance);
    });
  };
  const play = async (r: Rem) => {
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: r.explanation, language: r.language }) });
      if (res.status === 200) {
        const audioUrl = URL.createObjectURL(await res.blob());
        const audio = new Audio(audioUrl);
        try {
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error("Remote audio playback failed"));
            audio.play().catch(reject);
          });
          return;
        } finally { URL.revokeObjectURL(audioUrl); }
      }
    } catch { /* Fall back to browser speech when remote audio is unavailable. */ }
    if (!(await speakInBrowser(r))) setMsg(r.explanation);
  };
  useEffect(() => {
    if (!voiceEnabled) return;
    for (const reminder of rems) {
      if (reminder.status !== "due") continue;
      const key = `${reminder._id}:${reminder.attempts}`;
      if (autoSpoken.current.has(key)) continue;
      autoSpoken.current.add(key);
      void play(reminder);
    }
  }, [rems, voiceEnabled]);
  const enableVoice = () => {
    setVoiceEnabled(true);
    setMsg("Automatic voice reminders enabled for this app session.");
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance("Voice reminders enabled.");
      window.speechSynthesis.speak(utterance);
    }
  };
  const taken = async (id: string) => {
    try {
      const response = await fetch(`/api/reminders/${id}/taken`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      setMsg(response.ok ? "Confirmation received." : result.error ?? "Could not confirm this reminder.");
    } catch {
      setMsg("Could not reach the backend to confirm this reminder.");
    }
  };
  const snooze = async (id: string) => {
    try {
      const response = await fetch(`/api/reminders/${id}/snooze`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      setMsg(response.ok ? "Reminder snoozed for 10 minutes." : result.error ?? "Could not snooze this reminder.");
    } catch { setMsg("Could not reach the backend to snooze this reminder."); }
  };

  return (
    <main>
      <h1>Medicine companion</h1>
      <button className="alt" onClick={enableVoice} disabled={voiceEnabled}>{voiceEnabled ? "Voice enabled" : "Enable automatic voice"}</button>
      <nav>{(["setup", "reminders", "family"] as const).map((t) => <button key={t} className={tab === t ? "" : "alt"} onClick={() => setTab(t)}>{t === "setup" ? "Add prescription" : t === "reminders" ? "Today" : "Family view"}</button>)}</nav>
      {msg && <p role="status" className="card">{msg}</p>}

      {tab === "setup" && (<>
        <div className="card"><label>Reminder language <select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select></label></div>
        {!meds && <div className="card"><p>Photo of a printed prescription</p><input type="file" accept="image/*" onChange={(e) => e.target.files && analyze(e.target.files[0])} />{busy && <p>Reading prescription…</p>}</div>}
        {meds && (<>
          {meds.length === 0 || meds.some((m) => m.reviewState === "do_not_schedule" || !m.caregiverVerified)
            ? <p role="alert" className="review-warning"><b>Do not schedule yet.</b> Resolve highlighted fields and verify every medicine against the original prescription.</p>
            : <p><b>Review complete.</b> Nothing is scheduled until you confirm.</p>}
          {ocrInfo && <p className={ocrInfo.needsReview ? "review-warning" : "ocr-quality"} role={ocrInfo.needsReview ? "alert" : "status"}>OCR: {ocrInfo.engine} · {(ocrInfo.confidence * 100).toFixed(1)}% confidence (threshold {(ocrInfo.threshold * 100).toFixed(0)}%). {ocrInfo.needsReview ? "Compare every field with the original." : ""} {ocrInfo.warnings.join(" ")}</p>}
          {prescriptionImage && <details className="evidence"><summary>Original prescription</summary><img src={prescriptionImage} alt="Uploaded prescription for caregiver verification" /></details>}
          {ocrText && <details className="evidence"><summary>Recognized prescription text</summary><pre>{ocrText}</pre></details>}
          {meds.length === 0 && <button className="alt" onClick={addManualMedicine}>Add medicine manually</button>}
          {meds.map((m, i) => {
            const issues = reviewIssuesFor(m);
            return <div className="card" key={i}>
              <h2>{m.name || "Unclear medicine name"}</h2>
              {issues.length > 0 && <p role="alert" className="review-warning">Needs review: {issues.join(", ")}</p>}
              {m.ocrNeedsReview && <p role="alert" className="review-warning">OCR confidence is low. Check every field against the original before verifying.</p>}
              <div className="row">
                <label>Name<input value={m.name ?? ""} onChange={(e) => edit(i, { name: e.target.value || null })} /></label>
                <label>Strength<input value={m.strength ?? ""} onChange={(e) => edit(i, { strength: e.target.value })} /></label>
                <label>Frequency pattern<input value={m.frequencyPattern ?? ""} placeholder="e.g. 1-0-1" onChange={(e) => edit(i, { frequencyPattern: e.target.value || null })} /></label>
                <label>Times per day<input type="number" min="1" max="6" value={m.timesPerDay ?? ""} onChange={(e) => edit(i, { timesPerDay: e.target.value ? Number(e.target.value) : null })} /></label>
                <label>Reminder times (24h, comma separated)<input value={m.schedule.join(",")} onChange={(e) => edit(i, { schedule: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} /></label>
                <label>Days{m.durationDefaulted && <small> (one-day default)</small>}<input type="number" min="1" max="365" value={m.durationDays ?? ""} onChange={(e) => edit(i, { durationDays: +e.target.value || null, durationDefaulted: false })} /></label>
              </div>
              <small>Schedule source: {m.scheduleOrigin === "generated" ? "generated from pattern; verify these times" : m.scheduleOrigin === "prescription" ? "exact time printed on prescription" : "caregiver-entered"}</small>
              <label>When to take<input value={m.timing ?? ""} onChange={(e) => edit(i, { timing: e.target.value || null })} /></label>
              <label className="verify-control"><input type="checkbox" checked={m.caregiverVerified} disabled={issues.length > 0} onChange={(e) => verify(i, e.target.checked)} /> I checked this medicine and schedule against the original prescription.</label>
            </div>;
          })}
          <button onClick={confirm} disabled={busy || meds.length === 0 || meds.some((m) => m.reviewState !== "ready" || !m.caregiverVerified || reviewIssuesFor(m).length > 0)}>{busy ? "Saving…" : "Confirm and start reminders"}</button>
          <button className="alt" onClick={() => setMeds(null)}>Start over</button>
        </>)}
        <small>This app explains what is printed on the prescription. It does not give medical advice.</small>
      </>)}

      {tab === "reminders" && (rems.length === 0 ? <p>No reminders yet. Add a prescription first.</p> : rems.map((r) => (
        <div key={r._id} className={`card ${r.status === "due" ? "due" : r.status === "missed" ? "missed" : ""}`}>
          <b>{r.name}</b> <small>{new Date(r.scheduledAt).toLocaleString()} · {r.status}</small>
          {r.status === "due" && (<><p>{r.explanation}</p><button onClick={() => play(r)}>Play reminder</button><button className="alt" onClick={() => taken(r._id)}>Yes, I took it</button><button className="alt" onClick={() => snooze(r._id)}>Snooze 10 min</button></>)}
        </div>)))}

      {tab === "family" && (<>
        <h2>Missed doses</h2>
        {rems.filter((r) => r.familyNotified).length === 0 ? <p>No missed doses.</p> : rems.filter((r) => r.familyNotified).map((r) => <div className="card missed" key={r._id}><b>{r.name}</b> was not confirmed after {r.attempts} reminders. <small>{new Date(r.scheduledAt).toLocaleString()}</small></div>)}
        <h2>Confirmed</h2>
        {rems.filter((r) => r.status === "confirmed").map((r) => <div className="card" key={r._id}>{r.name} <small>taken</small></div>)}
      </>)}
    </main>
  );
}
