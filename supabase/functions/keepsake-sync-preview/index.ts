// Isolated experiment. Deployment packaging substitutes server-only placeholders.
// No production generation endpoint or provider write is exposed by this relay.
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createClient } from '@supabase/supabase-js';
import handler from '../../../api/giftportals.js';
import { cloudInstantService } from '../../../api/instant-cloud.js';
import { authContext, cloud } from '../../../api/_lib/cloud.js';
import { createCloudInstantRepository } from '../../../api/_lib/cloud-instant-adapters.js';
import { createKeepsakeSyncStorage, keepsakeSyncSettings, runKeepsakeSyncRequest } from '../../../api/_lib/keepsake-sync.js';
import { AppError, ensure, giftHash, secretMatches } from '../../../api/_lib/rules.js';

const relayKey = '__PREVIEW_RELAY_KEY__';
const bucket = 'gp-keepsake-sync-preview-20261005';
Object.assign(globalThis, { process, Buffer });
// Supabase Edge supports reading secrets, but rejects OS environment mutation.
// Existing server modules receive a per-isolate plain configuration object.
Object.defineProperty(process, 'env', { configurable: true, writable: true, value: {
  SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
  SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  ENABLE_KEEPSAKE_SYNC: 'true', KEEPSAKE_SYNC_BUCKET: bucket,
  KEEPSAKE_SYNC_ENCRYPTION_KEY: '__PREVIEW_ENCRYPTION_KEY__',
  KEEPSAKE_SYNC_ORIGIN: 'https://preview.giftportals.invalid',
  VERCEL_ENV: 'development', ENABLE_SIGNUP: 'true',
  ENABLE_GENERATION: 'false', ENABLE_CLOUD_GENERATION: 'false',
} });
const allowed = new Set(['status', 'login', 'signup', 'refresh', 'world', 'demo', 'keepsakes-list', 'keepsakes-save', 'keepsakes-remove']);
const result = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

// A labeled fictional fixture verifies actual Auth + private Storage across two
// accounts without writing a job or purchasing a generation in the live project.
const fixtureId = 'e8481166-37cd-4d3d-a58c-6f6b4ec2dceb';
const fixtureToken = '__PREVIEW_FIXTURE_TOKEN__';
const fixtureExpiry = '__PREVIEW_FIXTURE_EXPIRY__';
function fixtureJob() {
  const sha = 'a'.repeat(64);
  return { id: fixtureId, state: 'completed', revision: 0, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z', expires_at: fixtureExpiry,
    document: { title: 'Fictional preview test gift', story: 'A public Rio example used only to test collection sync. This is not a new generated gift.', worldPrompt: 'A fictional sync test.', photoIntent: 'place', objectRepresentation: 'souvenir-miniature', senderName: 'Preview test', recipientName: 'Preview test', dedication: '', needsReference: false, images: [], generation: {tripo:{},worldlabs:{}}, photoSafety: {decision:'allow',results:[{decision:'allow',category:'ordinary'}]} },
    stages: {tripo:{state:'completed'},worldlabs:{state:'failed'}},
    assets: { model: {id:'model',path:`${fixtureId}/generated/${sha}.glb`,mime:'model/gltf-binary',bytes:1,sha256:sha} } };
}

Deno.serve(async request => {
  try {
    // Public auth actions require this private relay key. Personal actions also
    // verify the user's actual Supabase session via authContext/getUser.
    ensure(secretMatches(request.headers.get('x-giftportals-relay-key'), relayKey), 'RELAY_DENIED', 403);
    const url = new URL(request.url), action = url.searchParams.get('action') || 'status';
    if (url.searchParams.get('service') === 'bootstrap') {
      ensure(request.method === 'POST', 'METHOD_NOT_ALLOWED', 405);
      const service = cloud(); let existing = await service.storage.getBucket(bucket);
      if (existing.error) {
        const made = await service.storage.createBucket(bucket, { public: false, fileSizeLimit: 2048, allowedMimeTypes: ['application/json'] });
        ensure(!made.error, 'PREVIEW_BOOTSTRAP_FAILED', 503); existing = await service.storage.getBucket(bucket);
      }
      ensure(existing.data?.public === false && existing.data.id === bucket, 'PREVIEW_BOOTSTRAP_FAILED', 503);
      const payload = await request.json();
      if (payload.persona === 'a' || payload.persona === 'b') {
        const email = `giftportals-sync-preview-${payload.persona}-20261005@example.com`;
        const password = payload.password;
        ensure(typeof password === 'string' && password.length >= 24 && password.length <= 128, 'INVALID_PASSWORD');
        const created = await service.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: {display_name:`Fictional sync test ${payload.persona.toUpperCase()}`} });
        ensure(!created.error || /already|registered/i.test(created.error.message), 'PREVIEW_TEST_ACCOUNT_FAILED', 503);
        const login = await service.auth.signInWithPassword({email,password});
        ensure(login.data.session && !login.error, 'PREVIEW_TEST_ACCOUNT_FAILED', 503);
        return result({ok:true,data:{email,password,session:login.data.session,fixtureLink:`https://giftportals.vercel.app/#/generated/${fixtureId}?key=${fixtureToken}`}});
      }
      return result({ok:true,data:{bucket,private:true}});
    }
    ensure(['giftportals','instant-cloud'].includes(url.searchParams.get('service') || ''), 'ACTION_UNAVAILABLE', 404);
    const headers = {host:'preview.giftportals.invalid',origin:'https://preview.giftportals.invalid','sec-fetch-site':'same-origin','content-type':'application/json',authorization:request.headers.get('authorization') || '','x-instant-token':request.headers.get('x-instant-token') || ''};
    const repo = createCloudInstantRepository();
    if (url.searchParams.get('service') === 'instant-cloud') {
      ensure(request.method === 'GET' && action === 'job', 'METHOD_NOT_ALLOWED', 405);
      const id = url.searchParams.get('id') || '', token = headers['x-instant-token'];
      if (id === fixtureId && secretMatches(giftHash(token), giftHash(fixtureToken))) {
        ensure(Date.parse(fixtureExpiry) > Date.now(), 'JOB_EXPIRED', 404);
        const example = await fetch('https://giftportals.vercel.app/demo/rio-generated-gift.json', {signal:AbortSignal.timeout(10000)}).then(response=>response.json());
        return result({ok:true,data:{...fixtureJob().document,id,token,state:'completed',createdAt:'2026-10-05T00:00:00Z',mediaExpiresAt:Date.parse(fixtureExpiry)/1000,tripo:{state:'completed'},worldlabs:{state:'failed'},assets:{photoUrl:'https://giftportals.vercel.app/assets/examples/v13/rio.jpg',tripoInputUrl:'https://giftportals.vercel.app/assets/portal-dusk/rio-keepsake.png',modelUrl:new URL(example.modelUrl,'https://giftportals.vercel.app').href},worldRetry:{available:false}}});
      }
      return result({ok:true,data:await cloudInstantService().get({id,token})});
    }
    ensure(allowed.has(action), 'ACTION_UNAVAILABLE', 404);
    const body = request.method === 'GET' ? undefined : await request.json();
    ensure(body === undefined || JSON.stringify(body).length <= 16384, 'BODY_TOO_LARGE', 413);
    if (action.startsWith('keepsakes-')) {
      const ctx = await authContext(headers.authorization), settings = keepsakeSyncSettings()!;
      const repository = {get:async(id:string,hash:string)=>id===fixtureId&&secretMatches(hash,giftHash(fixtureToken)) ? fixtureJob() : repo.get(id,hash)};
      const data = await runKeepsakeSyncRequest(action,{method:request.method,headers}, {id:ctx.user.id,demo:ctx.profile.is_demo}, {settings,storage:createKeepsakeSyncStorage(ctx.service,bucket),repository},body);
      return result({ok:true,data});
    }
    let statusCode = 200; const outgoing = new Headers({'Cache-Control':'no-store'}); let payload = '';
    const response = {get statusCode(){return statusCode;},set statusCode(value){statusCode=value;},setHeader:(name:string,value:string)=>outgoing.set(name,value),end:(value:string)=>{payload=value;}};
    await handler({url:`/api/giftportals?${url.searchParams}`,method:request.method,headers,body},response);
    return new Response(payload,{status:statusCode,headers:outgoing});
  } catch(error) {
    const known = error instanceof AppError;
    return result({ok:false,error:{code:known?error.code:'PREVIEW_SERVICE_UNAVAILABLE',message:known?error.message:'The preview service could not be reached. Your existing gifts are kept.'}},known?error.status:503);
  }
});
