import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function actualModule(relativePath) {
  const compiled = ts.transpileModule(await readFile(new URL(relativePath, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}
const { validateOriginalFiles } = await actualModule('../src/original-upload-rules.ts');
const { uploadRules } = await actualModule('../api/_lib/rules.ts');
const MiB = 1024 * 1024;
const item = (kind = 'gift-photo', type = 'image/png', size = 1) => ({ kind, file: { type, size } });
const code = (files) => validateOriginalFiles(files)?.code ?? null;

test('a postcard requires a gift photo and limits gift angles to four', () => {
  assert.equal(code([]), 'NO_GIFT_PHOTO');
  assert.equal(code([item('place-photo')]), 'NO_GIFT_PHOTO');
  assert.equal(code(Array.from({ length: 4 }, () => item())), null);
  assert.equal(code(Array.from({ length: 5 }, () => item())), 'GIFT_PHOTO_COUNT');
});

test('narration and place photos share the eight-original capacity', () => {
  const files = [item(), ...Array.from({ length: 6 }, () => item('place-photo')), item('audio', 'audio/mpeg')];
  assert.equal(code(files), null);
  assert.equal(code([...files, item('place-photo')]), 'TOTAL_COUNT');
});

test('4 MiB narration is accepted but one extra byte is rejected before cloud save', () => {
  const exact = item('audio', 'audio/ogg', 4 * MiB);
  assert.equal(code([item(), exact]), null);
  assert.equal(uploadRules(exact.kind, exact.file.type, exact.file.size).extension, 'ogg');
  const oversized = item('audio', 'audio/ogg', 4 * MiB + 1);
  assert.equal(code([item(), oversized]), 'FILE_TOO_LARGE');
  assert.throws(() => uploadRules(oversized.kind, oversized.file.type, oversized.file.size), (error) => error.code === 'MEDIA_SIZE_LIMIT');
});

test('8 MiB images are accepted but one extra byte is rejected on both client and server', () => {
  for (const kind of ['gift-photo', 'place-photo']) {
    const exact = item(kind, 'image/webp', 8 * MiB);
    const files = kind === 'gift-photo' ? [exact] : [item(), exact];
    assert.equal(code(files), null);
    assert.equal(uploadRules(exact.kind, exact.file.type, exact.file.size).extension, 'webp');
    const oversized = item(kind, 'image/webp', 8 * MiB + 1);
    assert.equal(code([item(), oversized]), 'FILE_TOO_LARGE');
    assert.throws(() => uploadRules(oversized.kind, oversized.file.type, oversized.file.size), (error) => error.code === 'MEDIA_SIZE_LIMIT');
  }
});

test('image/audio substitutions and unsupported MIME types fail before reservation', () => {
  for (const wrong of [item('audio', 'image/png'), item('gift-photo', 'audio/mpeg'), item('place-photo', 'text/html'), item('audio', 'audio/mp4')]) {
    assert.equal(code([item(), wrong]), 'UNSUPPORTED_TYPE');
    assert.throws(() => uploadRules(wrong.kind, wrong.file.type, wrong.file.size));
  }
});

test('empty or invalid-sized originals fail before a partial draft can be created', () => {
  for (const size of [0, -1, NaN, Infinity]) {
    assert.equal(code([item('gift-photo', 'image/png', size)]), 'EMPTY_FILE');
    assert.throws(() => uploadRules('gift-photo', 'image/png', size), (error) => error.code === 'MEDIA_SIZE_LIMIT');
  }
});

test('valid original inputs are preserved, including their exact byte sizes and types', () => {
  const files = Object.freeze([Object.freeze({ kind: 'gift-photo', file: Object.freeze({ size: 12, type: 'image/jpeg' }) }), Object.freeze({ kind: 'audio', file: Object.freeze({ size: 34, type: 'audio/webm' }) })]);
  const before = JSON.stringify(files);
  assert.equal(validateOriginalFiles(files), null);
  assert.equal(JSON.stringify(files), before);
});
