const TAKEN_PHRASES: Record<string, string[]> = {
  English: ["i took it", "i have taken it", "i took my medicine", "i have taken my medicine"],
  Hindi: ["मैंने ले ली", "मैंने दवा ले ली", "maine le li", "maine dawa le li"],
  Marathi: ["मी घेतली", "मी औषध घेतली", "मी घेतले", "mi ghetli", "me ghetli", "mi ghetale"],
  Tamil: ["நான் எடுத்தேன்", "நான் மருந்து எடுத்தேன்", "naan eduthen", "naan marundhu eduthen"],
};

export function isTakenPhrase(transcript: string, language: string): boolean {
  const normalized = transcript
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[.,!?;:।॥]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const preferred = TAKEN_PHRASES[language] ?? TAKEN_PHRASES.English;
  const otherLanguages = Object.entries(TAKEN_PHRASES)
    .filter(([name]) => name !== language)
    .flatMap(([, phrases]) => phrases);
  return [...preferred, ...otherLanguages]
    .some((phrase) => phrase.normalize("NFKC").toLocaleLowerCase() === normalized);
}