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

## Offline honesty
OCR, Gemma, Temporal and Mongo (use a local mongod) run offline. ElevenLabs and family alerts need internet; without a key the UI falls back to text.
Mastra's API changes often: if backend/src/agent.ts fails to compile, check it against your installed version.
