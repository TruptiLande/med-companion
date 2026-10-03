import { useEffect, useRef, useState } from "react";
import { Bell, CalendarClock, Camera, Check, HeartHandshake, Home, Mic, Pill, ShieldCheck, Volume2 } from "lucide-react";
import { isTakenPhrase } from "./voice.js";
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
type SpeechRecognitionResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type SpeechRecognitionErrorEvent = { error?: string };
type BrowserSpeechRecognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
};
type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
const LANGS = ["Marathi", "Hindi", "Tamil", "English"];
const LANGUAGE_LOCALES: Record<string, string> = { Marathi: "mr-IN", Hindi: "hi-IN", Tamil: "ta-IN", English: "en-IN" };
const TAKEN_PROMPTS: Record<string, string> = { Marathi: "मी घेतली", Hindi: "मैंने ले ली", Tamil: "நான் எடுத்தேன்", English: "I took it" };
const validClockTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
type Tab = "home" | "setup" | "reminders" | "family";
const NAV_ITEMS = [
  { id: "home", label: "Home", short: "Home", Icon: Home },
  { id: "reminders", label: "Today's schedule", short: "Today", Icon: CalendarClock },
  { id: "setup", label: "Add prescription", short: "Add", Icon: Camera },
  { id: "family", label: "Family view", short: "Family", Icon: HeartHandshake },
] as const;

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
  const [tab, setTab] = useState<Tab>("home");
  const [lang, setLang] = useState("Marathi");
  const [meds, setMeds] = useState<Med[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [rems, setRems] = useState<Rem[]>([]);
  const [ocrText, setOcrText] = useState("");
  const [ocrInfo, setOcrInfo] = useState<OcrInfo | null>(null);
  const [prescriptionImage, setPrescriptionImage] = useState("");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceEnabledRef = useRef(true);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [listeningReminder, setListeningReminder] = useState<string | null>(null);
  const [voiceConfirmation, setVoiceConfirmation] = useState<{ reminderId: string; transcript: string; matched: boolean } | null>(null);
  const [browserVoices, setBrowserVoices] = useState<SpeechSynthesisVoice[]>([]);
  const autoHandled = useRef(new Set<string>());
  const autoInFlight = useRef(new Set<string>());
  const activeAudio = useRef<HTMLAudioElement | null>(null);

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
      setMeds(Array.isArray(j.meds) ? j.meds : []);
      if (j.error) setMsg(j.error);
      else if (!j.meds?.length) setMsg("No medicines were extracted. Keep this prescription in review and check the image.");
      else if (j.reviewState === "do_not_schedule") setMsg("Do not schedule yet. Resolve the highlighted fields and verify each medicine.");
    } catch {
      setMeds([]);
      setMsg("Could not reach the analysis service. Your prescription image remains available for review.");
    } finally { setBusy(false); }
  };
  const loadSamplePrescription = async () => {
    setMsg("");
    setBusy(true);
    try {
      const response = await fetch("/sample-prescription.svg");
      if (!response.ok) throw new Error("Sample prescription could not be loaded.");
      const imageUrl = URL.createObjectURL(await response.blob());
      try {
        const image = new Image();
        image.src = imageUrl;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image conversion is unavailable.");
        context.drawImage(image, 0, 0);
        const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Image conversion failed.")), "image/png"));
        setBusy(false);
        await analyze(new File([png], "sample-prescription.png", { type: "image/png" }));
      } finally {
        URL.revokeObjectURL(imageUrl);
      }
    } catch {
      setBusy(false);
      setMsg("Could not load the sample prescription. You can still choose an image from your device.");
    }
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
    const uncertainFields = m.uncertainFields.filter((field) => !editedFields.includes(field));
    const next = { ...m, ...p, uncertainFields, caregiverVerified: false };
    next.reviewIssues = reviewIssuesFor(next);
    next.reviewState = next.reviewIssues.length ? "do_not_schedule" : "ready";
    return next;
  }) ?? null);
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
    const utterance = new SpeechSynthesisUtterance(r.explanation);
    utterance.lang = LANGUAGE_LOCALES[r.language ?? "English"] ?? "en-IN";
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
  const play = async (r: Rem, automatic = false): Promise<boolean> => {
    if (automatic && !voiceEnabledRef.current) return false;
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: r.explanation, language: r.language }) });
      if (res.status === 200) {
        const audioUrl = URL.createObjectURL(await res.blob());
        const audio = new Audio(audioUrl);
        activeAudio.current?.pause();
        activeAudio.current = audio;
        try {
          let interrupted = false;
          const played = await new Promise<boolean>((resolve) => {
            audio.onended = () => resolve(true);
            audio.onerror = () => resolve(false);
            audio.onpause = () => { interrupted = true; resolve(false); };
            if (automatic && !voiceEnabledRef.current) resolve(false);
            else {
              if ("speechSynthesis" in window) window.speechSynthesis.cancel();
              audio.play().catch(() => resolve(false));
            }
          });
          if (played) return true;
          if (interrupted || (automatic && !voiceEnabledRef.current)) return false;
        } finally {
          if (activeAudio.current === audio) activeAudio.current = null;
          URL.revokeObjectURL(audioUrl);
        }
      }
    } catch { /* Fall back to browser speech when remote audio is unavailable. */ }
    if (automatic && !voiceEnabledRef.current) return false;
    const played = await speakInBrowser(r);
    if (!played) setMsg(`Voice playback is unavailable. Reminder: ${r.explanation}`);
    return played;
  };
  useEffect(() => {
    if (!voiceEnabled || !audioUnlocked) return;
    const reminder = rems.find((item) => {
      const key = `${item._id}:${item.attempts}`;
      return item.status === "due" && !autoHandled.current.has(key) && !autoInFlight.current.has(key);
    });
    if (!reminder) return;
    const key = `${reminder._id}:${reminder.attempts}`;
    autoInFlight.current.add(key);
    void play(reminder, true).finally(() => {
      autoInFlight.current.delete(key);
      autoHandled.current.add(key);
    });
  }, [rems, voiceEnabled, audioUnlocked]);
  const toggleVoice = () => {
    if (!audioUnlocked) {
      setAudioUnlocked(true);
      setVoiceEnabled(true);
      voiceEnabledRef.current = true;
      setMsg("Automatic voice reminders are on. You can mute them here.");
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance("Voice reminders are ready."));
      }
      return;
    }
    const nextEnabled = !voiceEnabled;
    setVoiceEnabled(nextEnabled);
    voiceEnabledRef.current = nextEnabled;
    if (!nextEnabled) {
      activeAudio.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    }
    setMsg(nextEnabled ? "Automatic voice reminders are on." : "Automatic voice reminders are muted.");
  };
  const listenForTaken = (reminder: Rem) => {
    const speechWindow = window as Window & { SpeechRecognition?: BrowserSpeechRecognitionConstructor; webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor };
    const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Recognition) {
      setMsg("Voice input is not supported in this browser. Use the button to confirm instead.");
      return;
    }
    const recognition = new Recognition();
    const language = reminder.language ?? lang;
    recognition.lang = LANGUAGE_LOCALES[language] ?? "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim() ?? "";
      const matched = isTakenPhrase(transcript, language);
      setVoiceConfirmation({ reminderId: reminder._id, transcript, matched });
      setMsg(matched ? "I heard that you took this medicine. Confirm below to update the reminder." : "I could not match that to a taken confirmation. You can try again or use the button.");
    };
    recognition.onerror = (event) => {
      setMsg(event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone access is blocked. Allow it in your browser or use the button to confirm."
        : "I could not hear that clearly. Try again or use the button to confirm.");
    };
    recognition.onend = () => setListeningReminder(null);
    setVoiceConfirmation(null);
    setListeningReminder(reminder._id);
    try {
      recognition.start();
    } catch {
      setListeningReminder(null);
      setMsg("Voice input could not start. Try again or use the button to confirm.");
    }
  };
  const voiceFeedbackFor = (reminder: Rem) => voiceConfirmation?.reminderId === reminder._id ? (
    <div className="voice-feedback" role="status">
      <p>I heard: <q>{voiceConfirmation.transcript || "No speech detected"}</q></p>
      {voiceConfirmation.matched
        ? <button className="primary-action" onClick={() => taken(reminder._id)}><Check size={16} /> Confirm taken</button>
        : <span>Try again or use the manual confirmation.</span>}
    </div>
  ) : null;
  const reminderActions = (reminder: Rem) => (
    <>
      <div className="next-actions">
        <button className="primary-action" onClick={() => taken(reminder._id)}><Check size={17} /> {reminder.status === "missed" ? "Confirm taken late" : "I took it"}</button>
        <button className="secondary-action" onClick={() => listenForTaken(reminder)} disabled={listeningReminder === reminder._id}><Mic size={16} /> {listeningReminder === reminder._id ? "Listening…" : `Say ‘${TAKEN_PROMPTS[reminder.language ?? lang] ?? TAKEN_PROMPTS.English}’`}</button>
        {reminder.status === "due" && <button className="secondary-action" onClick={() => snooze(reminder._id)}>Snooze 10 min</button>}
        <button className="icon-button play-action" onClick={() => void play(reminder)} aria-label={`Play reminder for ${reminder.name}`}><Volume2 size={18} /></button>
      </div>
      {voiceFeedbackFor(reminder)}
    </>
  );
  const taken = async (id: string) => {
    try {
      const response = await fetch(`/api/reminders/${id}/taken`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (response.ok) setVoiceConfirmation(null);
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

  const today = new Date().toDateString();
  const todaysReminders = rems.filter((reminder) => new Date(reminder.scheduledAt).toDateString() === today);
  const takenCount = todaysReminders.filter((reminder) => reminder.status === "confirmed").length;
  const missedCount = todaysReminders.filter((reminder) => reminder.status === "missed").length;
  const nextReminder = todaysReminders
    .filter((reminder) => reminder.status === "due" || reminder.status === "scheduled")
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())[0]
    ?? todaysReminders.find((reminder) => reminder.status === "missed");
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  const displayTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => setTab("home")} aria-label="Med Companion home">
          <span className="brand-mark"><Pill size={22} aria-hidden="true" /></span>
          <span>Med Companion<small>CARE, MADE CLEAR</small></span>
        </button>
        <p className="nav-label">YOUR SPACE</p>
        <nav className="side-nav" aria-label="Main navigation">
          {NAV_ITEMS.map(({ id, label, Icon }) => <button key={id} className={tab === id ? "nav-item active" : "nav-item"} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}>
            <Icon size={19} aria-hidden="true" /><span>{label}</span>{id === "family" && missedCount > 0 && <span className="nav-count">{missedCount}</span>}
          </button>)}
        </nav>
        <div className="sidebar-note"><ShieldCheck size={18} aria-hidden="true" /><p>Every medicine is checked by a caregiver before reminders begin.</p></div>
        <div className="sidebar-footer"><span className="status-dot" /> Your care plan</div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div className="topbar-date">{new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}<strong>{tab === "home" ? "Your day, at a glance" : NAV_ITEMS.find((item) => item.id === tab)?.label}</strong></div>
          <div className="topbar-actions">
            <span className="language-pill">{lang}</span>
            <button className={voiceEnabled && audioUnlocked ? "voice-toggle enabled" : "voice-toggle"} onClick={toggleVoice} aria-label={!audioUnlocked ? "Unlock automatic voice reminders" : voiceEnabled ? "Mute automatic voice reminders" : "Turn on automatic voice reminders"} aria-pressed={voiceEnabled}>
              <Volume2 size={17} aria-hidden="true" /><span>{!audioUnlocked ? "Unlock voice" : voiceEnabled ? "Mute voice" : "Turn voice on"}</span>
            </button>
            <button className="icon-button notification-button" onClick={() => setTab("family")} aria-label="Open family alerts"><Bell size={19} aria-hidden="true" />{missedCount > 0 && <span className="notification-dot" />}</button>
          </div>
        </header>

        <main className="content-wrap">
          {msg && <p role="status" className="notice">{msg}</p>}

          {tab === "home" && <div className="page-stack">
            <section className="page-intro">
              <p className="eyebrow">A LITTLE MORE PEACE OF MIND</p>
              <h1>{greeting},<br />let's take today one dose at a time.</h1>
              <p>Your medication plan is here when you need it.</p>
            </section>

            <section className="summary-grid" aria-label="Today's medication summary">
              <article className="summary-card summary-total"><span className="summary-icon"><Pill size={19} /></span><strong>{todaysReminders.length}</strong><span>Scheduled today</span></article>
              <article className="summary-card summary-taken"><span className="summary-icon"><Check size={19} /></span><strong>{takenCount}</strong><span>Confirmed</span></article>
              <article className="summary-card summary-missed"><span className="summary-icon"><HeartHandshake size={19} /></span><strong>{missedCount}</strong><span>Need attention</span></article>
            </section>

            <section className="next-section">
              <div className="section-heading"><div><p className="eyebrow">{nextReminder?.status === "missed" ? "FOLLOW UP" : "UP NEXT"}</p><h2>{nextReminder?.status === "missed" ? "Needs a check-in" : "Your next reminder"}</h2></div><button className="text-link" onClick={() => setTab("reminders")}>Full schedule <span aria-hidden="true">→</span></button></div>
              {nextReminder ? <article className={`next-card ${nextReminder.status === "due" ? "is-due" : nextReminder.status === "missed" ? "is-missed" : ""}`}>
                <div className="next-card-top"><span className={`status-pill ${nextReminder.status === "due" ? "due-pill" : nextReminder.status === "missed" ? "missed-pill" : "upcoming-pill"}`}><span />{nextReminder.status === "due" ? "Due now" : nextReminder.status === "missed" ? "Missed" : "Coming up"}</span><span className="next-time">{displayTime(nextReminder.scheduledAt)}</span></div>
                <h3>{nextReminder.name}</h3><p>{nextReminder.explanation || "Your scheduled medication reminder."}</p>
                {(nextReminder.status === "due" || nextReminder.status === "missed") && reminderActions(nextReminder)}
              </article> : <div className="empty-panel"><span className="empty-icon"><Check size={21} /></span><div><strong>Nothing else is scheduled today</strong><p>Your upcoming reminders will appear here.</p></div></div>}
            </section>

            <section className="home-bottom">
              <article className="quick-card"><div className="quick-icon"><Camera size={20} /></div><div><h3>Have a new prescription?</h3><p>Add a photo and review every detail before scheduling.</p></div><button className="secondary-action" onClick={() => { setMeds(null); setTab("setup"); }}>Add prescription <span aria-hidden="true">→</span></button></article>
              <article className="care-note"><ShieldCheck size={19} /><p>Med Companion explains what is printed on a prescription. It does not provide medical advice.</p></article>
            </section>
          </div>}

          {tab === "setup" && <div className="page-stack">
            <section className="page-intro compact-intro"><p className="eyebrow">PRESCRIPTION REVIEW</p><h1>Add a prescription</h1><p>Read the label together, then verify each detail before reminders are scheduled.</p></section>
            <div className="card setup-language"><label>Reminder language<select value={lang} onChange={(e) => setLang(e.target.value)}>{LANGS.map((l) => <option key={l}>{l}</option>)}</select></label></div>
            {!meds && <div className="upload-panel"><span className="upload-icon"><Camera size={24} /></span><h2>Start with a clear photo</h2><p>Use a printed prescription with the medicine name and instructions in focus.</p><label className="upload-button">{busy ? "Reading prescription…" : "Choose prescription photo"}<input type="file" accept="image/*" disabled={busy} onChange={(e) => e.target.files && analyze(e.target.files[0])} /></label><button className="secondary-action sample-button" onClick={loadSamplePrescription} disabled={busy}>{busy ? "Loading sample…" : "Try sample prescription"}</button><small>Sample is fictional and for testing only. JPG, PNG, or another common image format.</small></div>}
            {meds && <>
              <div className="review-intro"><div><span className="eyebrow">CAREGIVER REVIEW</span><h2>Check every detail</h2></div><button className="text-link" onClick={() => setMeds(null)}>Start over</button></div>
              {meds.length === 0 || meds.some((m) => m.reviewState === "do_not_schedule" || !m.caregiverVerified)
                ? <p role="alert" className="review-warning"><b>Do not schedule yet.</b> Resolve highlighted fields and verify every medicine against the original prescription.</p>
                : <p className="ocr-quality"><b>Review complete.</b> Nothing is scheduled until you confirm.</p>}
              {ocrInfo && <p className={ocrInfo.needsReview ? "review-warning" : "ocr-quality"} role={ocrInfo.needsReview ? "alert" : "status"}>OCR: {ocrInfo.engine} · {(ocrInfo.confidence * 100).toFixed(1)}% confidence (threshold {(ocrInfo.threshold * 100).toFixed(0)}%). {ocrInfo.needsReview ? "Compare every field with the original." : ""} {ocrInfo.warnings.join(" ")}</p>}
              {prescriptionImage && <details className="evidence"><summary>Original prescription</summary><img src={prescriptionImage} alt="Uploaded prescription for caregiver verification" /></details>}
              {ocrText && <details className="evidence"><summary>Recognized prescription text</summary><pre>{ocrText}</pre></details>}
              {meds.map((m, i) => {
                const issues = reviewIssuesFor(m);
                return <article className="medicine-review" key={i}>
                  <div className="medicine-review-heading"><span className="medicine-icon"><Pill size={19} /></span><div><p className="eyebrow">MEDICINE {i + 1}</p><h2>{m.name || "Unclear medicine name"}</h2></div></div>
                  {issues.length > 0 && <p role="alert" className="review-warning">Needs review: {issues.join(", ")}</p>}
                  {m.ocrNeedsReview && <p role="alert" className="review-warning">OCR confidence is low. Check every field against the original before verifying.</p>}
                  <div className="row">
                    <label>Name<input value={m.name ?? ""} onChange={(e) => edit(i, { name: e.target.value || null })} /></label>
                    <label>Strength<input value={m.strength ?? ""} onChange={(e) => edit(i, { strength: e.target.value })} /></label>
                    <div className="review-fact"><span>Frequency read from prescription</span><strong>{m.timesPerDay == null ? "Unclear in prescription" : `${m.timesPerDay} ${m.timesPerDay === 1 ? "dose" : "doses"} per day`}</strong>{m.frequencyPattern && <small>Printed pattern: {m.frequencyPattern}</small>}</div>
                    <div className="review-fact"><span>Reminder times</span><strong>{m.schedule.length ? m.schedule.join(", ") : "Not scheduled: frequency or timing needs review"}</strong></div>
                    <label>Days{m.durationDefaulted && <small> (one-day default)</small>}<input type="number" min="1" max="365" value={m.durationDays ?? ""} onChange={(e) => edit(i, { durationDays: +e.target.value || null, durationDefaulted: false })} /></label>
                  </div>
                  <small className="schedule-source">Schedule source: {m.scheduleOrigin === "generated" ? "generated from source-verified instructions; verify these times" : m.scheduleOrigin === "prescription" ? "exact time printed on prescription" : "caregiver-entered"}</small>
                  <label>When to take<input value={m.timing ?? ""} onChange={(e) => edit(i, { timing: e.target.value || null })} /></label>
                  <label className="verify-control"><input type="checkbox" checked={m.caregiverVerified} disabled={issues.length > 0} onChange={(e) => verify(i, e.target.checked)} /> I checked this medicine and schedule against the original prescription.</label>
                </article>;
              })}
              <button className="primary-action confirm-action" onClick={confirm} disabled={busy || meds.length === 0 || meds.some((m) => m.reviewState !== "ready" || !m.caregiverVerified || reviewIssuesFor(m).length > 0)}>{busy ? "Saving…" : "Confirm and start reminders"}</button>
            </>}
          </div>}

          {tab === "reminders" && <div className="page-stack">
            <section className="page-intro compact-intro"><p className="eyebrow">YOUR DAILY PLAN</p><h1>Today's schedule</h1><p>{todaysReminders.length ? `${todaysReminders.length} reminders on your plan today.` : "A clear view of what is coming up and what is complete."}</p></section>
            {todaysReminders.length === 0 ? <div className="empty-panel"><span className="empty-icon"><CalendarClock size={21} /></span><div><strong>No reminders today</strong><p>Add a prescription to create a medication schedule.</p></div><button className="secondary-action" onClick={() => { setMeds(null); setTab("setup"); }}>Add prescription</button></div> : <div className="schedule-list">{todaysReminders.map((r) => <article key={r._id} className={`schedule-card ${r.status === "due" ? "schedule-due" : r.status === "missed" ? "schedule-missed" : ""}`}>
              <div className="schedule-time"><strong>{displayTime(r.scheduledAt)}</strong><span>{new Date(r.scheduledAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span></div><span className="schedule-rail" />
              <div className="schedule-detail"><div className="schedule-title-row"><div><h2>{r.name}</h2><p>{r.explanation}</p></div><span className={`status-pill ${r.status === "due" ? "due-pill" : r.status === "confirmed" ? "taken-pill" : r.status === "missed" ? "missed-pill" : "upcoming-pill"}`}><span />{r.status === "confirmed" ? "Taken" : r.status === "due" ? "Due now" : r.status === "missed" ? "Missed" : "Upcoming"}</span></div>
                {(r.status === "due" || r.status === "missed") && reminderActions(r)}
              </div>
            </article>)}</div>}
          </div>}

          {tab === "family" && <div className="page-stack">
            <section className="page-intro compact-intro"><p className="eyebrow">CARE CIRCLE</p><h1>Family view</h1><p>A simple overview of reminders that need attention and doses already confirmed.</p></section>
            <section className="family-section"><div className="section-heading"><div><p className="eyebrow">FOLLOW-UP</p><h2>Missed doses</h2></div><span className="section-count">{rems.filter((r) => r.familyNotified && r.status === "missed").length}</span></div>
              {rems.filter((r) => r.familyNotified && r.status === "missed").length === 0 ? <div className="empty-panel"><span className="empty-icon"><HeartHandshake size={21} /></span><div><strong>No missed doses</strong><p>Family alerts will appear here if a reminder is missed.</p></div></div> : rems.filter((r) => r.familyNotified && r.status === "missed").map((r) => <article className="family-row missed-row" key={r._id}><span className="family-row-icon"><HeartHandshake size={18} /></span><div><strong>{r.name}</strong><p>Not confirmed after {r.attempts} reminders</p></div><time>{new Date(r.scheduledAt).toLocaleString()}</time></article>)}
            </section>
            <section className="family-section"><div className="section-heading"><div><p className="eyebrow">DOSE HISTORY</p><h2>Confirmed</h2></div><span className="section-count">{rems.filter((r) => r.status === "confirmed").length}</span></div>
              {rems.filter((r) => r.status === "confirmed").length === 0 ? <div className="empty-panel"><span className="empty-icon"><Check size={21} /></span><div><strong>No confirmed doses yet</strong><p>Once a reminder is marked taken, it will show here.</p></div></div> : rems.filter((r) => r.status === "confirmed").map((r) => <article className="family-row" key={r._id}><span className="family-row-icon"><Check size={18} /></span><div><strong>{r.name}</strong><p>Marked as taken</p></div><time>{new Date(r.scheduledAt).toLocaleString()}</time></article>)}
            </section>
          </div>}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Main navigation">
        {NAV_ITEMS.map(({ id, short, Icon }) => <button key={id} className={tab === id ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setTab(id)} aria-current={tab === id ? "page" : undefined}><Icon size={20} aria-hidden="true" /><span>{short}</span></button>)}
      </nav>
    </div>
  );
}
