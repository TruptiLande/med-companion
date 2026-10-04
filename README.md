# Med Companion
Prescription photo -> PaddleOCR -> Gemma (Ollama) -> caregiver confirms -> Temporal reminders -> ElevenLabs voice -> family alert.
The AI only explains what is printed on the prescription. It never prescribes or changes doses.

## Run
1. `ollama pull gemma3:4b` (or set GEMMA_MODEL to any Gemma tag you have)
2. `py -3.12 -m pip install -r backend/ocr/requirements.txt` (EasyOCR models download the first time fallback is needed)
3. `temporal server start-dev`
4. `cd backend && cp .env.example .env && npm i && npm run worker` and, in a second terminal, `npm run dev`
5. `cd frontend && npm i && npm run dev` -> http://localhost:5173
Set DEMO=1 in .env so reminders fire in seconds (retry after 60s) instead of at clock time.
Set `OCR_CONFIDENCE_THRESHOLD` in `backend/.env` to adjust when EasyOCR fallback is attempted. Low-confidence results stay in caregiver review.

## Voice reminders
Automatic spoken reminders are enabled while the app is open. If your browser blocks autoplay, tap the voice control once to allow audio; you can mute it there. For spoken dose feedback, tap the microphone on a due or missed reminder, say “I took it” (or “मी घेतली” in Marathi), then confirm the recognized phrase. Speech recognition depends on browser support and microphone permission; the manual confirmation button remains available. Voice reminders do not run in the background when the app is closed.

The prescription screen includes a fictional sample image for testing OCR and review. It is clearly marked as a test fixture and must not be used as medical guidance. A meal-time reminder is generated only when both the daily frequency and the matching meal phrase (for example, “once daily after breakfast”) are confirmed in the OCR text; frequency alone never determines an invented time.

## Offline honesty
OCR, Gemma, Temporal and Mongo (use a local mongod) run offline. ElevenLabs and family alerts need internet; without a key, the UI uses browser speech when an appropriate voice is available and otherwise shows the reminder as text.

## Mastra assistant
Schedule questions go through a Mastra agent (`backend/src/mastra`) that can look up confirmed medicines and reminder status. The Express adapter also exposes Mastra HTTP routes under `/api` (for example `POST /api/agents/medication-agent/generate`). The home screen chat uses `POST /api/agent`. The assistant never prescribes or changes doses. If `backend/src/mastra` fails to compile, check it against the installed `@mastra/core` version.
