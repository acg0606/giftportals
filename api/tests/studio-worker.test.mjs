import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

async function moduleURL(path, replacements = {}) {
  let js = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [from, to] of Object.entries(replacements)) js = js.replaceAll(`'${from}'`, JSON.stringify(to));
  return `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
}
const rulesURL = await moduleURL('../_lib/rules.ts');
const { AppError } = await import(rulesURL);
const slot = '__giftportalsSyntheticStudioWorker';
const fakeCloud = `export const cloud=()=>globalThis.${slot}.service; export const unwrap=r=>{if(r.error)throw r.error;return r.data};`;
const fakeProviders = `
export const checkProviderCredit=(...args)=>globalThis.${slot}.credit(...args);
export const providerJSON=(...args)=>globalThis.${slot}.json(...args);
export const completedAssets=async()=>({assets:[],cost:globalThis.${slot}.actualCost,resultId:'synthetic-result'});
export const providerId=value=>value;`;
const art = await moduleURL('../../shared/gift-art-style.ts');
const recipes = await moduleURL('../_lib/cloud-instant-recipes.ts', { '../../shared/gift-art-style.js': art });
const { tick } = await import(await moduleURL('../tick.ts', {
  './_lib/rules.js': rulesURL,
  './_lib/cloud.js': `data:text/javascript;base64,${Buffer.from(fakeCloud).toString('base64')}`,
  './_lib/providers.js': `data:text/javascript;base64,${Buffer.from(fakeProviders).toString('base64')}`,
  './_lib/cloud-instant-recipes.js': recipes,
}));

function fixture(t, options = {}) {
  const prior = globalThis[slot], enabled = process.env.ENABLE_GENERATION;
  const provider = options.provider || 'worldlabs';
  const job = { id: '00000000-0000-4000-a000-000000000601', owner_id: 'synthetic-owner', memory_id: 'synthetic-memory',
    provider, state: 'pending', reserved_credits: provider === 'worldlabs' ? 500 : 150,
    created_at: new Date().toISOString(), poll_attempts: 0, attempts: 0, submitted_at: null, provider_task_id: null };
  const calls = [], costs = [], updates = [];
  const context = { actualCost: provider === 'worldlabs' ? 1580 : 60, job, service: {
    async rpc(name, values) {
      calls.push(['rpc', name]);
      if (name === 'gp_claim_job') return { data: ['pending', 'processing'].includes(job.state) ? [{ ...job }] : [] };
      assert.equal(name, 'gp_record_job_cost'); costs.push(values.cost_value); return { data: null };
    },
    from(table) {
      let mutation;
      const query = {
        select() { return query; }, eq() { return query; }, is() { return query; }, lt() { return query; }, order() { return query; }, limit() { return query; },
        update(value) { mutation = value; return query; },
        async single() {
          if (table === 'gp_jobs') { assert.ok(mutation); Object.assign(job, mutation); updates.push({ ...mutation }); return { data: { ...job } }; }
          if (table === 'gp_profiles') return { data: { is_demo: false } };
          assert.equal(table, 'gp_memories');
          return { data: { ai_consent: true, title: 'Synthetic place', story: 'Synthetic words.', location: { label: 'Paris' } } };
        },
        then(yes, no) { return Promise.resolve({ data: provider === 'tripo' ? [{ path: 'synthetic-original.png', bucket: 'giftportals-private' }] : [] }).then(yes, no); },
      };
      // Cleanup sees no expired originals. The Tripo photo query sees its exact input.
      query.lt = () => { query.then = (yes, no) => Promise.resolve({ data: [] }).then(yes, no); return query; };
      return query;
    },
    storage: { from() { return { async createSignedUrl() { return { data: { signedUrl: 'https://synthetic.invalid/photo' } }; } }; } },
  },
    async credit(requestedProvider, amount) {
      calls.push(['credit', requestedProvider, amount]);
      if (options.insufficient) throw new AppError('PROVIDER_INSUFFICIENT_CREDITS', 403);
      assert.equal(amount, requestedProvider === 'worldlabs' ? 1580 : 100);
    },
    async json(requestedProvider, path, method = 'GET', body) {
      calls.push(['provider', requestedProvider, path, method, body]);
      if (method === 'POST') {
        assert.equal(job.state, 'processing'); assert.ok(job.submitted_at, 'Submission intention must be stored before POST');
        if (options.ambiguous) throw new AppError('SUBMISSION_AMBIGUOUS', 409);
        return requestedProvider === 'tripo' ? { task_id: 'synthetic-task' } : { operation_id: 'synthetic-operation' };
      }
      return { done: true };
    },
  };
  globalThis[slot] = context; process.env.ENABLE_GENERATION = 'true';
  t.after(() => { prior === undefined ? delete globalThis[slot] : globalThis[slot] = prior;
    enabled === undefined ? delete process.env.ENABLE_GENERATION : process.env.ENABLE_GENERATION = enabled; });
  return { job, calls, costs, updates };
}

test('Studio World Labs reservation500 does not gate the pinned1580 recipe; one POST is followed by GET and actual-cost audit', async t => {
  const f = fixture(t);
  assert.equal((await tick()).state, 'processing'); assert.equal((await tick()).state, 'completed'); assert.equal((await tick()).processed, false);
  assert.deepEqual(f.calls.filter(call => call[0] === 'credit'), [['credit', 'worldlabs', 1580]]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'provider').map(call => call[3]), ['POST', 'GET']);
  assert.equal(f.calls.find(call => call[0] === 'provider' && call[3] === 'POST')[4].model, 'marble-1.1');
  assert.deepEqual(f.costs, [1580]); assert.equal(f.job.reserved_credits, 500);
});

test('Studio Tripo reservation150 is audit only; affordability uses100 and completed reuse never sends another POST', async t => {
  const f = fixture(t, { provider: 'tripo' });
  await tick(); await tick(); await tick();
  assert.deepEqual(f.calls.filter(call => call[0] === 'credit'), [['credit', 'tripo', 100]]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'provider').map(call => call[3]), ['POST', 'GET']);
  assert.equal(f.calls.find(call => call[0] === 'provider' && call[3] === 'POST')[4].model, 'v3.1-20260211');
  assert.equal(f.job.reserved_credits, 150); assert.deepEqual(f.costs, [60]);
});

test('genuine provider insufficiency fails before a paid POST or stored submission intention', async t => {
  const f = fixture(t, { insufficient: true }), response = await tick();
  assert.equal(response.state, 'failed'); assert.equal(response.errorCode, 'PROVIDER_INSUFFICIENT_CREDITS');
  assert.equal(f.job.submitted_at, null); assert.equal(f.calls.some(call => call[0] === 'provider'), false); assert.deepEqual(f.costs, []);
});

test('a lost paid response retains ambiguous intent and never automatically submits a replacement', async t => {
  const f = fixture(t, { ambiguous: true }), response = await tick();
  assert.equal(response.errorCode, 'SUBMISSION_AMBIGUOUS'); assert.ok(f.job.submitted_at); assert.equal(f.job.provider_task_id, null);
  await tick(); assert.equal(f.calls.filter(call => call[0] === 'provider' && call[3] === 'POST').length, 1);
});
