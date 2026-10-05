import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const modules = new Map();
async function moduleUrl(path) {
  if (modules.has(path.href)) return modules.get(path.href);
  let source = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/import\s*['"][^'"]+\.css['"];?\s*/g, '');
  for (const match of [...source.matchAll(/from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)]) source = source.replaceAll(`${match[1]}${match[2]}${match[1]}`, JSON.stringify(await moduleUrl(new URL(`${match[2]}.ts`, path))));
  const url = `data:text/javascript;base64,${Buffer.from(source + '\n//# sourceURL=' + path.pathname.split('/').at(-1)).toString('base64')}`; modules.set(path.href,url); return url;
}
const gallery = await import(await moduleUrl(new URL('../src/public-gallery.ts', import.meta.url)));
const landscapes = await import(await moduleUrl(new URL('../src/public-landscapes.ts', import.meta.url)));
const id = '12345678-1234-4234-8234-123456789abc';
const gift = (extra={}) => ({ id,title:'A quiet coastline',createdAt:'2026-10-05T00:00:00Z',photoIntent:'place',worldUrl:'/real-world.spz',panoramaUrl:'/world-panorama.png',colliderUrl:'/real-collider.glb',worldSemantics:{metricScaleFactor:2,groundPlaneOffset:1},mediaExpiresAt:Date.now()/1000+600,...extra });
const success = data => new Response(JSON.stringify({ok:true,data}),{headers:{'Content-Type':'application/json'}});

test('published projection contains only the landscape, never private uploads, stories, miniature or paid capabilities', () => {
  const value = gift({token:'private-creator-capability',photoUrl:'/private-photo.jpg',modelUrl:'/private-model.glb',tripoInputUrl:'/private-miniature.png',senderName:'Private person',recipientName:'Private recipient',dedication:'Secret dedication',story:'Secret story',worldRetry:{available:true}});
  const data = gallery.publicGiftData(value), items = gallery.publicGalleryItems([value,value]);
  assert.equal(data.story,''); assert.equal(data.senderName,''); assert.equal(data.worldUrl,'/real-world.spz');
  for(const field of ['token','modelUrl','originalUrl','keepsakeImageUrl','recipientName','dedication','worldRetry']) assert.equal(Object.hasOwn(data,field),false,field);
  assert.equal(items.length,1); assert.equal(items[0].imageUrl,'/world-panorama.png'); assert.equal(items[0].modelUrl,undefined);
  assert.equal(items[0].worldPath,`generated/${id}?public=1&view=world`);
  assert.doesNotMatch(JSON.stringify(items),/private-|Secret|Private person|key=/);
});

test('malformed, expired and missing-world entries cannot become public gallery cards', () => {
  for(const value of [null,{},gift({id:'not-a-real-id'}),gift({title:''}),gift({worldUrl:undefined}),gift({worldUrl:'javascript:alert(1)'}),gift({worldUrl:'//external/world.spz'}),gift({worldUrl:'https://name:password@host/world.spz'}),gift({mediaExpiresAt:1}),gift({mediaExpiresAt:NaN})]) assert.equal(gallery.publicGiftData(value),undefined);
  assert.equal(gallery.publicGiftData(gift({panoramaUrl:'javascript:alert(1)'})).panoramaUrl,undefined);
  assert.throws(()=>gallery.publicGiftPath('rio-example'),/verified/);
});

test('fresh-browser list and public gift reads use anonymous GET only and carry no creator token', async () => {
  const calls=[], fetcher=async(url,options)=>{calls.push({url,options});return success(url.includes('action=list')?{enabled:true,items:[gift()],nextCursor:'opaque+next/page'}:gift());};
  const list=await gallery.readPublicGallery(new AbortController().signal,fetcher);
  assert.equal(list.items.length,1); assert.equal(list.nextCursor,'opaque+next/page');
  const opened=await gallery.readPublicGift(id,new AbortController().signal,fetcher); assert.equal(opened.worldUrl,'/real-world.spz');
  await gallery.readPublicGallery(new AbortController().signal,fetcher,list.nextCursor);
  for(const call of calls){assert.equal(call.options.method,'GET');assert.equal(call.options.credentials,'same-origin');assert.equal(call.options.body,undefined);assert.equal(call.options.headers,undefined);assert.equal(call.options.redirect,'error');assert.doesNotMatch(call.url,/key=|token=|prepare|advance|finalize|retry/);}
  assert.match(calls[2].url,/cursor=opaque%2Bnext%2Fpage/);
});

test('disabled publishing returns no public entries and malformed or mismatched read replies are rejected', async () => {
  const disabled=await gallery.readPublicGallery(new AbortController().signal,async()=>success({enabled:false,items:[gift()]}));assert.deepEqual(disabled,{enabled:false,items:[]});
  await assert.rejects(gallery.readPublicGallery(new AbortController().signal,async()=>success({enabled:true,items:'invalid'})),/verified/);
  await assert.rejects(gallery.readPublicGift(id,new AbortController().signal,async()=>success(gift({id:'22345678-1234-4234-8234-123456789abc'}))),/verified/);
  await assert.rejects(gallery.readPublicGift('bad',new AbortController().signal,async()=>{throw Error('must not fetch')}),/verified/);
});

test('a closed public read ignores late replies rather than handing an old route its landscape', async () => {
  const abort=new AbortController(); let finish,started;const ready=new Promise(resolve=>started=resolve);
  const pending=gallery.readPublicGift(id,abort.signal,async()=>{started();return new Promise(resolve=>finish=resolve)});
  await ready; abort.abort(); finish(success(gift())); await assert.rejects(pending,error=>error.name==='AbortError');
});

test('public landscape markup escapes titles and uses panorama cards and world routes without accounts or miniature UI', () => {
  const items=gallery.publicGalleryItems([gift({title:'<script>bad()</script>'})]), html=landscapes.publicLandscapeMarkup(items);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|\/real-world\.spz|model\.glb|Sign in|data-auth|Private person|key=/);
  assert.match(html,/world-panorama\.png/);assert.match(html,/public=1&amp;view=world/);
  const examples=landscapes.publicLandscapeExamples([{id:'rio-example',title:'Rio',worldPath:'generated/rio-example?view=world'},{id:'unknown',title:'Unknown',worldPath:'generated/unknown?view=world'}]);
  assert.equal(examples.length,1);assert.equal(examples[0].imageUrl,'/demo/rio-world-pano.png');assert.equal(examples[0].modelUrl,undefined);assert.match(examples[0].worldPath,/landscape=1/);
});

test('paginated gallery preserves displayed worlds on failure, deduplicates pages and ignores a retired response', async () => {
  const host={html:'',button:null,set innerHTML(value){this.html=value;this.button=value.includes('data-public-more')?{}:null},get innerHTML(){return this.html},querySelector(){return this.button}};
  const item=gallery.publicGalleryItems([gift()])[0]; let current=true,attempt=0,finish,started;const ready=new Promise(resolve=>started=resolve);
  const page=landscapes.mountPublicLandscapeGallery(host,{enabled:true,items:[item],nextCursor:'page2'},[],()=>current,async()=>{
    attempt++;if(attempt===1)throw Error('network');if(attempt===2)return {enabled:true,items:[item],nextCursor:'page3'};started();return new Promise(resolve=>finish=resolve);
  });
  await host.button.onclick();assert.match(host.html,/worlds already shown remain available/);assert.match(host.html,/A quiet coastline/);
  await host.button.onclick();assert.equal((host.html.match(/class="public-landscape-card"/g)||[]).length,1);
  const pending=host.button.onclick();await ready;current=false;page.destroy();const before=host.html;finish({enabled:true,items:gallery.publicGalleryItems([gift({title:'Late private route'})])});await pending;assert.equal(host.html,before);
});
