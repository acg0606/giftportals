import test from 'node:test';
import assert from 'node:assert/strict';
import {OBJECT_LABELS,VISION_VERSION,VISION_WEIGHTS_VERSION,compatibleVisionWeights,visionDecision} from '../../tools/local-vision-policy.mjs';

test('policy3 retains sensitive labels and includes distinct ordinary water, wood and science categories',()=>{
 assert.match(VISION_VERSION,/:policy-3$/);assert.equal(OBJECT_LABELS.length,33);
 assert.equal(OBJECT_LABELS.filter(([kind])=>kind==='sexual').length,2);
 assert.equal(OBJECT_LABELS.filter(([kind])=>kind==='adult-product').length,3);
 for(const subject of ['riverside architecture','mountain bay','framed landscape','space capsule','phonograph record','astronomical instrument','bronze gears','printing press','wooden pier','calm water','weathered wooden planks'])assert.ok(OBJECT_LABELS.some(([,label])=>label.includes(subject)),subject);
 assert.equal(new Set(OBJECT_LABELS.map(([,label])=>label)).size,OBJECT_LABELS.length);
 for(const [,label]of OBJECT_LABELS)assert.ok(!/paris|rio|apollo|voyager|antikythera|sha256|\/assets\//i.test(label));
});
test('policy updates reuse verified pinned weights offline, but reject unrelated and unknown model versions',()=>{
 for(const version of [VISION_WEIGHTS_VERSION,`${VISION_WEIGHTS_VERSION}:policy-1`,`${VISION_WEIGHTS_VERSION}:policy-2`,VISION_VERSION])assert.equal(compatibleVisionWeights(version),true);
 for(const version of [undefined,null,'different-model',`${VISION_WEIGHTS_VERSION}:policy-999`,`${VISION_WEIGHTS_VERSION}:policy-2-extra`])assert.equal(compatibleVisionWeights(version),false);
});
test('ordinary scene or scientific recognition cannot override the unchanged sensitive thresholds',()=>{
 const scientific=[{kind:'unknown',score:.999},{kind:'sexual',score:.001}];
 assert.equal(visionDecision(.149,scientific).decision,'allow');
 assert.equal(visionDecision(.15,scientific).decision,'review');
 assert.equal(visionDecision(.40,scientific).category,'sexual');
 assert.equal(visionDecision(.01,[{kind:'landscape',score:.82},{kind:'sexual',score:.18}]).decision,'review');
 assert.equal(visionDecision(.01,[{kind:'unknown',score:.92},{kind:'adult-product',score:.08}]).decision,'review');
 assert.equal(visionDecision(.01,[{kind:'unknown',score:.65},{kind:'adult-product',score:.35}]).category,'adult-product');
 assert.equal(visionDecision(.01,[{kind:'adult-product',score:.20},{kind:'unknown',score:.19}]).decision,'block');
});
