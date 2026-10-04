import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
const source=ts.transpileModule(await readFile(new URL('../src/gift-unboxing.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
  .replace(/import '\.\/gift-unboxing.css';\s*/, '').replace(/from 'three'/,`from '${import.meta.resolve('three')}'`);
const {createUnboxingState,unboxingStep,unboxingAdvance,unboxingTick,unboxingReduce}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('unboxing requires three deliberate sequential actions and ignores duplicate clicks during a transition',()=>{
  const state=createUnboxingState();assert.equal(unboxingStep(state),'wrapped');assert.equal(unboxingAdvance(state),true);assert.equal(unboxingAdvance(state),false);
  for(let i=0;i<20;i++)unboxingTick(state,.05);assert.equal(unboxingStep(state),'ribbon');assert.equal(unboxingAdvance(state),true);
  for(let i=0;i<20;i++)unboxingTick(state,.05);assert.equal(unboxingStep(state),'lid');assert.equal(unboxingAdvance(state),true);
  for(let i=0;i<20;i++)unboxingTick(state,.05);assert.equal(unboxingStep(state),'revealed');assert.equal(unboxingAdvance(state),false);assert.equal(unboxingTick(state,.05),false);
});
test('elapsed time is bounded and reduced motion completes only the requested action immediately',()=>{
  const state=createUnboxingState();unboxingAdvance(state);unboxingTick(state,10000);assert.ok(state.progress<.065);
  const progress=state.progress;for(const value of [NaN,Infinity,-1])unboxingTick(state,value);assert.equal(state.progress,progress);
  unboxingReduce(state,true);assert.equal(state.progress,1);assert.equal(unboxingAdvance(state),true);assert.equal(state.progress,2);
  unboxingReduce(state,false);assert.equal(state.target,2);assert.equal(state.progress,2);state.dead=true;assert.equal(unboxingAdvance(state),false);assert.equal(unboxingTick(state,.05),false);
});
