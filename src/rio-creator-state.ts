export type RioCreatorTheme = 'paper' | 'sunset' | 'ocean';

export interface RioCreatorDraft {
  version: 1;
  title: string;
  sender: string;
  recipient: string;
  dedication: string;
  story: string;
  theme: RioCreatorTheme;
}

const STORAGE_KEY = 'giftportals.rio.creator.v1';
const MAX_TOKEN_LENGTH = 14_000;
const limits = { title: 80, sender: 60, recipient: 60, dedication: 280, story: 900 } as const;
const fields = Object.keys(limits) as Array<keyof typeof limits>;
const tokenFields = ['version', ...fields, 'theme'];
const malformedUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** A fresh fictional draft; constructing or editing it does not persist anything. */
export function newRioCreatorDraft(): RioCreatorDraft {
  return {
    version: 1,
    title: 'A little piece of Rio',
    sender: 'Clara',
    recipient: '',
    dedication: 'This little piece of Rio made me think of you.',
    story: 'I wanted you to feel the light, the breeze, and the afternoon that made me think of you.',
    theme: 'paper',
  };
}

/** Text remains plain data. Consumers must use textContent or escape it in HTML. */
export function normalizeRioCreatorDraft(input: unknown): RioCreatorDraft | null {
  try {
    if (!input || typeof input !== 'object') return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const properties = Object.getOwnPropertyDescriptors(input);
    // Read data properties only: normalization never invokes user-supplied getters.
    for (const key of tokenFields) if (!properties[key] || !('value' in properties[key])) return null;
    if (properties.version.value !== 1) return null;
    const theme: unknown = properties.theme.value;
    if (theme !== 'paper' && theme !== 'sunset' && theme !== 'ocean') return null;
    const draft = { version: 1, theme } as RioCreatorDraft;
    for (const field of fields) {
      const value: unknown = properties[field].value;
      if (typeof value !== 'string' || value.length > limits[field] || malformedUnicode.test(value)) return null;
      draft[field] = value;
    }
    return draft;
  } catch { return null; }
}

/** Returns a Unicode-safe payload, not a URL, invitation or externally saved gift. */
export function encodeRioCreatorDraft(draft: RioCreatorDraft): string {
  const clean = normalizeRioCreatorDraft(draft);
  if (!clean) throw new TypeError('Invalid Rio creator draft');
  const params = new URLSearchParams({ version: '1' });
  for (const field of fields) params.set(field, clean[field]);
  params.set('theme', clean.theme);
  return params.toString();
}

export function decodeRioCreatorDraft(token: string): RioCreatorDraft | null {
  if (typeof token !== 'string' || !token || token.length > MAX_TOKEN_LENGTH) return null;
  // URLSearchParams tolerates broken escapes; reject those and invalid UTF-8 first.
  if (!/^[A-Za-z0-9*+._~%=&-]+$/.test(token)) return null;
  if (token.split('&').some(field => field.indexOf('=') < 1)) return null;
  try {
    decodeURIComponent(token.replace(/\+/g, ' '));
    const params = new URLSearchParams(token);
    const keys = [...params.keys()];
    if (keys.length !== tokenFields.length || new Set(keys).size !== keys.length || keys.some(key => !tokenFields.includes(key))) return null;
    if (params.get('version') !== '1') return null;
    return normalizeRioCreatorDraft({
      version: 1,
      title: params.get('title'),
      sender: params.get('sender'),
      recipient: params.get('recipient'),
      dedication: params.get('dedication'),
      story: params.get('story'),
      theme: params.get('theme'),
    });
  } catch { return null; }
}

/** Persistence happens only when the caller explicitly supplies storage and saves. */
export function saveRioCreatorDraft(draft: RioCreatorDraft, storage: Pick<Storage, 'setItem'>): boolean {
  const clean = normalizeRioCreatorDraft(draft);
  if (!clean) return false;
  try { storage.setItem(STORAGE_KEY, JSON.stringify(clean)); return true; }
  catch { return false; }
}

export function loadRioCreatorDraft(storage: Pick<Storage, 'getItem'>): RioCreatorDraft | null {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (typeof raw !== 'string' || !raw || raw.length > MAX_TOKEN_LENGTH) return null;
    return normalizeRioCreatorDraft(JSON.parse(raw));
  } catch { return null; }
}
