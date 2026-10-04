import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/collection-conveyor.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const motion=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const {createCollectionConveyor,conveyorPoint,conveyorAdvance,conveyorSetPlaying,conveyorSetReduced,conveyorStep,conveyorScrub,conveyorSetLaneHalf,conveyorWrap}=motion;

test('one through six distinct slots circulate only in the front lane, with at least one nearest display at every phase',()=>{
 for(let count=1;count<=6;count++){
  const state=createCollectionConveyor(count);if(count<3)conveyorSetLaneHalf(state,count===1?1.7:3);
  for(let phase=0;phase<1000;phase++){
   state.offset=state.length*phase/1000;const points=Array.from({length:count},(_,i)=>conveyorPoint(state,i));
   assert.equal(points.length,count);assert.equal(new Set(points.map(point=>point.x)).size,count);
   assert.ok(points.every(point=>point.front&&point.z===.9&&point.x>=-state.length/2&&point.x<state.length/2));
   assert.ok(Math.min(...points.map(point=>Math.abs(point.x)))<=state.length/count/2+1e-9);
  }
 }
});
test('autoplay moves right to left and wraps from left to right at the lane boundary',()=>{
 const state=createCollectionConveyor(3),before=conveyorPoint(state,0).x;
 conveyorAdvance(state,.05);assert.ok(conveyorPoint(state,0).x<before);
 state.offset=state.target=state.length*.5+3.25-.01;const edge=conveyorPoint(state,0).x;
 conveyorAdvance(state,.05);assert.ok(edge<-4.8);assert.ok(conveyorPoint(state,0).x>4.8);
 assert.equal(conveyorWrap(-1,state.length),state.length-1);assert.equal(conveyorWrap(Infinity,state.length),0);
});
test('Next centers the incoming right-hand gift and Previous returns one slot; paused stepping never starts autoplay',()=>{
 for(const count of [2,3,6]){
  const state=createCollectionConveyor(count,true),right=conveyorPoint(state,0).x;assert.ok(right>0);
  conveyorStep(state,1);assert.equal(state.cursor,0);assert.ok(Math.abs(conveyorPoint(state,0).x)<1e-9);assert.equal(state.playing,false);
  conveyorStep(state,-1);assert.equal(state.cursor,1);assert.ok(Math.abs(conveyorPoint(state,1).x)<1e-9);
 }
});
test('motion clamps long or invalid elapsed time and pause removes momentum',()=>{
 const state=createCollectionConveyor(3);conveyorAdvance(state,60_000);assert.ok(Math.abs(state.offset-.38*.05)<1e-9);
 conveyorSetPlaying(state,false);const paused=state.offset;for(const dt of [1000,NaN,Infinity,-1,.05])assert.equal(conveyorAdvance(state,dt),false);
 assert.equal(state.offset,paused);conveyorScrub(state,1000);const dragged=state.offset;assert.equal(state.playing,false);assert.equal(conveyorAdvance(state,.05),false);assert.equal(state.offset,dragged);
 conveyorScrub(state,NaN);assert.equal(state.offset,dragged);
});
test('live reduced motion stops autoplay, allows explicit still stepping, and never silently resumes',()=>{
 const state=createCollectionConveyor(3);conveyorSetReduced(state,true);assert.equal(state.playing,false);assert.equal(conveyorSetPlaying(state,true),false);
 const before=state.offset;conveyorAdvance(state,.05);assert.equal(state.offset,before);conveyorStep(state,1);assert.equal(state.offset,state.target);
 conveyorSetReduced(state,false);assert.equal(state.playing,false);conveyorAdvance(state,.05);assert.equal(state.offset,state.target);assert.equal(conveyorSetPlaying(state,true),true);
});
test('viewport lane resizing preserves normalized position for small collections and leaves three-item spacing intact',()=>{
 for(const count of [1,2]){const state=createCollectionConveyor(count);state.offset=state.target=state.length*.42;conveyorSetLaneHalf(state,1.8);assert.ok(Math.abs(state.offset/state.length-.42)<1e-9);assert.equal(state.offset,state.target);}
 const state=createCollectionConveyor(3),length=state.length;conveyorSetLaneHalf(state,1);assert.equal(state.length,length);
 assert.equal(createCollectionConveyor(90).count,6);assert.equal(createCollectionConveyor(NaN).playing,false);assert.equal(createCollectionConveyor(0).playing,false);
});
