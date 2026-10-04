export interface OriginalFileInput {
  kind: 'gift-photo' | 'place-photo' | 'audio';
  file: { size: number; type: string };
}

export type OriginalFileIssue = 'NO_GIFT_PHOTO' | 'EMPTY_FILE' | 'UNSUPPORTED_TYPE' | 'FILE_TOO_LARGE';
export interface OriginalFileFailure { code: OriginalFileIssue; message: string }

/** Validate each original before saving; there is no account or file-count allowance. */
export function validateOriginalFiles(files: readonly OriginalFileInput[]): OriginalFileFailure | null {
  const gifts = files.filter(item => item.kind === 'gift-photo').length;
  if (!gifts) return { code: 'NO_GIFT_PHOTO', message: 'Add at least one original gift photo.' };
  for (const item of files) {
    if (!Number.isFinite(item.file.size) || item.file.size <= 0) return { code: 'EMPTY_FILE', message: 'Every original file must contain data. Choose a different file or record the narration again.' };
    const allowed = item.kind === 'audio' ? ['audio/webm', 'audio/ogg', 'audio/mpeg'] : ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(item.file.type)) return { code: 'UNSUPPORTED_TYPE', message: item.kind === 'audio' ? 'Use WebM, Ogg, or MP3 for original narration.' : 'Use JPG, PNG, or WebP for original photos.' };
    const maxBytes = (item.kind === 'audio' ? 4 : 8) * 1024 * 1024;
    if (item.file.size > maxBytes) return { code: 'FILE_TOO_LARGE', message: item.kind === 'audio' ? 'Keep original narration at or below 4 MiB.' : 'Keep each original photo at or below 8 MiB.' };
  }
  return null;
}
