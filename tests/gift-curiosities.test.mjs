import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {visionDecision,VISION_VERSION} from '../tools/local-vision-policy.mjs';
const code=ts.transpileModule(await readFile(new URL('../shared/gift-curiosities.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {selectedCuriosities,curiositiesFor,CURIOSITY_FACTS}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('gift context contains reviewed facts only, never arbitrary URLs or claimed provenance',()=>{
 for(const ids of [['invented'],['rio-gardens','rio-gardens'],['rio-gardens','clock-pocket','bird-feathers'],[{id:'rio-gardens',sourceUrl:'javascript:x'}]])assert.throws(()=>selectedCuriosities(ids));
 const selected=selectedCuriosities(['clock-pocket']);selected[0].text='mutated';assert.notEqual(CURIOSITY_FACTS.find(x=>x.id==='clock-pocket').text,'mutated');
 assert.equal(selectedCuriosities(undefined).length,0);
});
test('GPS optout still supplies object facts without supplying unrelated place claims',()=>{
 assert.deepEqual(curiositiesFor('clock').map(x=>x.id),['clock-pocket']);
 assert.deepEqual(curiositiesFor('unknown','not-curated'),[]);
 assert.deepEqual(curiositiesFor('bird','rio').map(x=>x.id),['rio-gardens','bird-feathers']);
 assert.ok(CURIOSITY_FACTS.every(x=>new URL(x.sourceUrl).protocol==='https:'));
});
test('photo screening holds ambiguous sensitive images and blocks adult product signals independently of nudity',()=>{
 const ordinary=[{kind:'clock',score:.9},{kind:'adult-product',score:.01},{kind:'sexual',score:.01}];
 assert.equal(visionDecision(.001,ordinary).decision,'allow');
 assert.equal(visionDecision(.20,ordinary).decision,'review');
 assert.equal(visionDecision(.8,ordinary).category,'sexual');
 const adult=visionDecision(.001,[{kind:'adult-product',score:.8},{kind:'unknown',score:.2}]);assert.equal(adult.decision,'block');assert.equal(adult.category,'adult-product');assert.equal(adult.modelVersion,VISION_VERSION);
 assert.equal(visionDecision(.001,[{kind:'adult-product',score:.12},{kind:'unknown',score:.88}]).decision,'review');
});
test('malformed classifier scores cannot produce an approval',()=>{
 for(const sexual of [NaN,Infinity,-.1,1.1])assert.throws(()=>visionDecision(sexual,[{kind:'unknown',score:1}]));
 for(const score of [NaN,Infinity,-.1,1.1])assert.throws(()=>visionDecision(.01,[{kind:'unknown',score}]));
 assert.throws(()=>visionDecision(.01,[]));
});
