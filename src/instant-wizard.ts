export const INSTANT_WIZARD_STEPS = ['photo', 'place', 'story', 'review'] as const;
export type InstantWizardStep = typeof INSTANT_WIZARD_STEPS[number];

/** Only the photo is required to reach the optional steps. */
export function instantWizardDestination(step: InstantWizardStep, direction: -1 | 1, hasPhoto: boolean): InstantWizardStep {
  if (direction === 1 && !hasPhoto) return 'photo';
  return INSTANT_WIZARD_STEPS[Math.max(0, Math.min(3, INSTANT_WIZARD_STEPS.indexOf(step) + direction))];
}
export function instantWizardCanCreate(step: InstantWizardStep, hasPhoto: boolean, consent: boolean): boolean {
  return step === 'review' && hasPhoto && consent;
}
export function instantDefaultWorldPrompt(intent: 'object' | 'place'): string {
  return intent === 'place'
    ? 'A realistic three-dimensional place matching this photo, preserving its buildings, trees, ground, lighting and relative layout.'
    : 'A realistic scene inspired by this photo and the souvenir, preserving visible materials, surroundings and lighting rather than inventing a fantasy setting.';
}
/** Keep a reviewed transcript editable and never silently cut off its ending. */
export function appendInstantTranscript(story: string, transcript: string): { story: string; error: string } {
  const words = transcript.trim();
  if (!words) return { story, error: '' };
  const next = story.trim() ? `${story.trimEnd()}\n\n${words}` : words;
  return next.length <= 1200 ? { story: next, error: '' } : { story, error: 'This transcript would make the story longer than 1,200 characters. Shorten the story or transcript, then try again.' };
}
export function instantJobConfirmedMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'JOB_UNAVAILABLE';
}

export const instantWorldRetryStorageKey = (jobStorageKey: string) => `${jobStorageKey}:world-retry`;
/** Keep the same idempotency key after an interrupted response or page reload. */
export function readInstantWorldRetryReference(raw: string | null): { id: string; token: string; retryKey: string } | null {
  try {
    const value = JSON.parse(raw || 'null');
    return value && typeof value.id === 'string' && typeof value.token === 'string' && typeof value.retryKey === 'string' && /^[A-Za-z0-9_-]{8,120}$/.test(value.id) && /^[A-Za-z0-9_-]{16,160}$/.test(value.token) && /^[A-Za-z0-9_-]{8,120}$/.test(value.retryKey)
      ? { id: value.id, token: value.token, retryKey: value.retryKey } : null;
  } catch { return null; }
}
