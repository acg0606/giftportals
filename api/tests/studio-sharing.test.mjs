import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function actualModule(path, replacements = {}) {
  let js = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [from, to] of Object.entries(replacements)) js = js.replaceAll(`'${from}'`, JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}
const rulesURL = await actualModule('../_lib/rules.ts');
const { AppError, giftHash } = await import(rulesURL);
const slot = '__giftportalsStudioSharingSynthetic';
const fakeCloud = `
export const cloudConfigured=()=>true;
export const cloud=()=>globalThis.${slot}.service;
export const unwrap=value=>{if(value.error)throw value.error;return value.data};
export const authContext=async authorization=>{
 const fixture=globalThis.${slot};
 if(authorization!=='Bearer synthetic-owner-session')throw fixture.signInError;
 return {user:{id:fixture.owner},profile:fixture.profile,service:fixture.service,client:fixture.service};
};`;
const handler = (await import(await actualModule('../giftportals.ts', {
  './_lib/rules.js': rulesURL,
  './_lib/cloud.js': `data:text/javascript;base64,${Buffer.from(fakeCloud).toString('base64')}`,
}))).default;
const owner = '00000000-0000-4000-a000-000000000001';
const memory = '00000000-0000-4000-a000-000000000002';

function fixture(t, options = {}) {
  const prior = globalThis[slot], inserted = [], reads = [];
  const context = { owner, profile: { id: owner, display_name: 'Synthetic owner', is_demo: options.demo || false },
    signInError: new AppError('SIGN_IN_REQUIRED', 401), service: {
      from(table) {
        let data, adding;
        const query = {
          select(...args) { reads.push({ table, args }); return query; },
          eq() { return query; }, is() { return query; },
          in() { data = [{ id: owner, display_name: 'Synthetic owner' }]; return query; },
          insert(value) { adding = value; return query; },
          async single() {
            if (table === 'gp_memories') return options.notOwner
              ? { error: new AppError('RESOURCE_UNAVAILABLE', 404) }
              : { data: { id: memory, owner_id: owner, is_demo_public: false } };
            assert.equal(table, 'gp_gifts');
            assert.ok(adding, 'Only an explicit share insert is allowed');
            inserted.push(adding);
            return { data: { ...adding, id: `synthetic-gift-${inserted.length}`, created_at: '2026-10-04T00:00:00Z', revoked_at: null, claimed_by: null } };
          },
          then(resolve, reject) { return Promise.resolve({ data }).then(resolve, reject); },
        };
        return query;
      },
    } };
  globalThis[slot] = context;
  t.after(() => { prior === undefined ? delete globalThis[slot] : globalThis[slot] = prior; });
  return { inserted, reads };
}
async function share(body = {}, headers = { authorization: 'Bearer synthetic-owner-session' }) {
  let raw;
  const res = { statusCode: 0, setHeader() {}, end(value) { raw = value; } };
  await handler({ method: 'POST', url: '/api/giftportals?action=share', headers,
    body: { memoryId: memory, allowLinkRead: true, message: 'A synthetic invitation.', ...body } }, res);
  return { status: res.statusCode, ...JSON.parse(raw) };
}

test('a signed-in owner can explicitly share more than forty invitations without a lifetime-count query', async t => {
  const f = fixture(t), tokens = new Set();
  for (let i = 0; i < 45; i++) {
    const response = await share({ allowClaim: i % 2 === 0 });
    assert.equal(response.status, 200);
    tokens.add(response.data.token);
    const saved = f.inserted[i];
    assert.equal(saved.sender_id, owner); assert.equal(saved.memory_id, memory);
    assert.equal(saved.link_hash, giftHash(response.data.token));
    assert.equal(saved.allow_link_read, true);
    if (i % 2 === 0) {
      assert.notEqual(response.data.claimToken, response.data.token);
      assert.equal(saved.claim_hash, giftHash(response.data.claimToken));
    } else { assert.equal(response.data.claimToken, undefined); assert.equal(saved.claim_hash, null); }
  }
  assert.equal(tokens.size, 45); assert.equal(f.inserted.length, 45);
  assert.ok(f.reads.every(read => read.table !== 'gp_gifts' || read.args.every(arg => !arg?.head && !arg?.count)));
});

test('removing the allowance does not grant anonymous, demo or non-owner sharing', async t => {
  for (const [options, headers, expected] of [
    [{}, {}, 'SIGN_IN_REQUIRED'],
    [{ demo: true }, undefined, 'DEMO_READ_ONLY'],
    [{ notOwner: true }, undefined, 'RESOURCE_UNAVAILABLE'],
  ]) {
    const f = fixture(t, options), response = await share({}, headers);
    assert.equal(response.error.code, expected); assert.equal(f.inserted.length, 0);
  }
});

test('link reading and optional transferable claiming still require explicit consent', async t => {
  const f = fixture(t);
  for (const [body, code] of [[{ allowLinkRead: false }, 'SHARING_CONSENT_REQUIRED'], [{ allowClaim: 'true' }, 'CLAIM_CONSENT_REQUIRED']]) {
    const response = await share(body); assert.equal(response.error.code, code);
  }
  assert.equal(f.inserted.length, 0);
});

test('invitations still enforce dedication and recipient input sizes before insertion', async t => {
  const f = fixture(t);
  for (const body of [{ message: 'x'.repeat(1201) }, { recipientName: 'x'.repeat(81) }]) {
    assert.equal((await share(body)).status, 400);
  }
  assert.equal(f.inserted.length, 0);
});
