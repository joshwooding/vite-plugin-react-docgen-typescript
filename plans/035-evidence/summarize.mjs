import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { directory, harness, hash, readJson, save } from './common.mjs';
export const states=['off','populate','restart'];
export const groups=['large-project','react-typing'].flatMap(scenario=>['default','projectService'].map(mode=>({scenario,mode})));
export const key=({scenario,mode})=>`${scenario}/${mode}`;
export function median(values) { assert.ok(values.length); const sorted=[...values].sort((a,b)=>a-b);const middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2; }
export const stats=values=>({median:median(values),mad:median(values.map(value=>Math.abs(value-median(values))))});
const finite=value=>assert.ok(Number.isFinite(value)&&value>=0,`Invalid metric: ${value}`);
export function expectedParser(scenario) {
  if(scenario!=='react-typing') return {propFilter:'plugin-default'};
  const source=readFileSync(harness,'utf8'); const match=source.match(/function retainNativeDisabled\(prop\) \{[\s\S]*?\n\}/);assert.ok(match);
  return {propFilter:'retainNativeDisabled: '+match[0],shouldExtractLiteralValuesFromEnum:true,shouldRemoveUndefinedFromOptional:true};
}
export function validateReport(report,sample,reference) {
  const frozen=readJson('frozen-identity.json');const controls=readJson('controls-results.json');assert.equal(controls.status,'PASS');
  const control=controls.groups.find(group=>key(group)===key(sample));assert.ok(control);
  assert.equal(report.schemaVersion,2);assert.equal(report.benchmarkKind,'direct-plugin');assert.equal(report.cache,sample.cache);
  assert.deepEqual(report.scenario,{sourceSha256:frozen.scenarios[sample.scenario].sourceSha256,fileCount:control.files.length,label:sample.scenario,name:sample.scenario,scale:1});
  assert.deepEqual(report.identity,frozen.harnessIdentity); assert.equal(report.nodeVersion,frozen.nodeVersion);assert.equal(report.platform,frozen.platform);
  assert.deepEqual(report.parserOptions,{parser:expectedParser(sample.scenario),tsconfig:frozen.scenarios[sample.scenario].tsconfig});
  assert.equal(report.iterations,1);assert.deepEqual(report.modes,[sample.mode]);assert.equal(report.results.length,1);assert.equal(report.results[0].mode,sample.mode);assert.equal(report.results[0].runs.length,1);
  assert.ok(Number.isInteger(report.processId)&&report.processId>0);if(sample.childPid!==undefined) assert.equal(report.processId,sample.childPid);
  assert.ok(Number.isFinite(Date.parse(report.createdAt)));if(sample.startedAt) assert.ok(Date.parse(report.createdAt)>=Date.parse(sample.startedAt)&&Date.parse(report.createdAt)<=Date.parse(sample.finishedAt));
  const run=report.results[0].runs[0]; assert.equal(run.cache,sample.cache);assert.equal(run.mode,sample.mode);assert.equal(run.processFirstMeasuredInstance,true);assert.equal(run.fileCount,control.files.length);
  for(const name of ['coldBatchMs','configResolvedMs','firstBatchMs','warmBatchMs','sessionTotalMs']) {finite(run[name]);assert.equal(report.results[0].metrics[name],run[name]);}
  assert.ok(Math.abs(run.coldBatchMs-run.configResolvedMs-run.firstBatchMs)<0.000001);assert.equal(run.componentHmr.status,'updated');finite(run.componentHmr.totalCycleMs);
  assert.deepEqual(report.results[0].metrics.componentHmr,run.componentHmr);
  assert.equal(run.componentHmr.affectedModuleCount,control.states[0].observation.transformed.length);assert.equal(run.componentHmr.invalidatedModuleCount,control.states[0].observation.invalidated.length);
  const lifecycle=run.cacheLifecycle;for(const name of ['initialEntryCount','finalEntryCount']) assert.ok(Number.isInteger(lifecycle[name])&&lifecycle[name]>=0);
  assert.equal(lifecycle.initialEntryCount>0,sample.cache==='restart');assert.equal(lifecycle.finalEntryCount>0,sample.cache!=='off');
  if(sample.cache==='restart') {assert.ok(Number.isInteger(lifecycle.seedProcessId)&&lifecycle.seedProcessId>0);assert.notEqual(lifecycle.seedProcessId,report.processId);} else assert.equal(lifecycle.seedProcessId,null);
  if(sample.scenario==='react-typing') {assert.equal(lifecycle.validation.fixtureValidation.compilerDiagnostics,0);assert.match(lifecycle.validation.fixtureValidation.reactDeclaration,/[\\/]@types[\\/]react[\\/]index\.d\.ts$/);assert.notEqual(lifecycle.validation.processId,report.processId);}
  if(reference) assert.deepEqual(report.timingScope,reference.timingScope);
  return run;
}
export function validateInvocationOrder(manifest) {
  const schedule=[];for(let round=1;round<=10;round++) for(const group of groups) {
    if(round>5&&!manifest.extendedGroups.includes(key(group)))continue;
    const offset=(round-1)%3;for(const cache of [...states.slice(offset),...states.slice(0,offset)])schedule.push({...group,cache,round});
  }
  assert.ok(manifest.samples.length<=schedule.length);let finish=-Infinity;
  for(const [index,sample] of manifest.samples.entries()) {
    assert.equal(sample.invocation,index+1);assert.equal(sample.invocationId,`035-${String(index+1).padStart(3,'0')}`);
    for(const field of ['scenario','mode','cache','round']) assert.equal(sample[field],schedule[index][field],'Capture order changed');
    assert.ok(Date.parse(sample.startedAt)>=finish&&Date.parse(sample.finishedAt)>=Date.parse(sample.startedAt),'Overlapping or invalid process lifetime');finish=Date.parse(sample.finishedAt);assert.equal(sample.exitCode,0);
    assert.deepEqual(sample.args,[harness,'--scenario',sample.scenario,'--scale','1','--modes',sample.mode,'--cache',sample.cache,'--iterations','1','--output',path.join(directory,sample.report)]);
    assert.equal(sample.inputFingerprint,hash(JSON.stringify(manifest.before.inputs)));assert.equal(sample.scriptFingerprint,hash(JSON.stringify(manifest.before.scripts)));
  }
}
export function summarize(manifest) {
  assert.equal(manifest.status,'COMPLETE');assert.ok(['initial','final'].includes(manifest.stage));assert.equal(manifest.failures.length,0);assert.deepEqual(manifest.before,manifest.after);validateInvocationOrder(manifest);
  const rows=[],initialRows=[],seen=new Set();let reference;
  for(const group of groups) for(const cache of states) {
    const samples=manifest.samples.filter(sample=>key(sample)===key(group)&&sample.cache===cache);const count=manifest.extendedGroups.includes(key(group))?10:5;
    assert.equal(samples.length,count,`Missing samples ${key(group)}/${cache}`);assert.deepEqual(samples.map(sample=>sample.round).sort((a,b)=>a-b),Array.from({length:count},(_,i)=>i+1));
    const runs=samples.map(sample=>{
      assert.equal(sample.status,'PASS');assert.ok(!seen.has(sample.report));seen.add(sample.report);assert.ok(!path.isAbsolute(sample.report)&&!sample.report.split(/[\\/]/).includes('..'));
      assert.equal(hash(readFileSync(path.join(directory,sample.report))),sample.reportSha256,'Raw report hash changed');
      const report=readJson(sample.report);const run=validateReport(report,sample,reference);reference??=report;return run;
    });
    const rowFor=(selected)=>({...group,cache,count:selected.length,cold:stats(selected.map(run=>run.coldBatchMs)),warm:stats(selected.map(run=>run.warmBatchMs)),hmr:stats(selected.map(run=>run.componentHmr.totalCycleMs)),session:stats(selected.map(run=>run.sessionTotalMs))});
    initialRows.push(rowFor(runs.slice(0,5)));
    rows.push({...rowFor(runs),samples:samples.map(sample=>sample.report),fileCount:runs[0].fileCount,affectedModuleCount:runs[0].componentHmr.affectedModuleCount,invalidatedModuleCount:runs[0].componentHmr.invalidatedModuleCount,initialEntries:[...new Set(runs.map(run=>run.cacheLifecycle.initialEntryCount))],finalEntries:[...new Set(runs.map(run=>run.cacheLifecycle.finalEntryCount))]});
  }
  assert.equal(seen.size,manifest.samples.length);
  const noisy=rows=>[...new Set(rows.filter(row=>[row.cold,row.hmr,row.session].some(metric=>metric.mad>metric.median*0.2)).map(key))];
  const initialNoisyGroups=noisy(initialRows),noisyGroups=noisy(rows);
  if(manifest.stage==='final') assert.deepEqual([...manifest.extendedGroups].sort(),[...initialNoisyGroups].sort(),'Extension must exactly match first-five variance gate');
  const zeroDenominatorGroups=[...new Set(rows.filter(row=>[row.cold,row.hmr,row.session].some(metric=>metric.median===0)).map(key))];
  const comparisons=groups.map(group=>{
    const [off,populate,restart]=states.map(cache=>rows.find(row=>key(row)===key(group)&&row.cache===cache));
    const coldSavingMs=off.cold.median-restart.cold.median;
    const coldSavingPercent=off.cold.median===0?'INCONCLUSIVE_ZERO_DENOMINATOR':100*coldSavingMs/off.cold.median;
    const hmr=[populate,restart].map(row=>{const deltaMs=row.hmr.median-off.hmr.median;const deltaPercent=off.hmr.median===0?'INCONCLUSIVE_ZERO_DENOMINATOR':100*deltaMs/off.hmr.median;return {cache:row.cache,deltaMs,deltaPercent,materialRegression:typeof deltaPercent==='number'&&deltaMs>10&&deltaPercent>10};});
    const populationSessionOverheadMs=populate.session.median-off.session.median,restartSessionSavingMs=off.session.median-restart.session.median;
    const benefitThreshold=typeof coldSavingPercent==='number'&&coldSavingMs>=100&&coldSavingPercent>=20;
    return {...group,coldSavingMs,coldSavingPercent,benefitThreshold,hmr,eligibleWithinGroup:benefitThreshold&&!hmr.some(row=>row.materialRegression),populationSessionOverheadMs,restartSessionSavingMs,projectedReuseSessionsToBreakEven:restartSessionSavingMs>0?Math.ceil(Math.max(0,populationSessionOverheadMs)/restartSessionSavingMs):'NO_DEMONSTRATED_BREAK_EVEN'};
  });
  const verdict=noisyGroups.length||zeroDenominatorGroups.length?'INCONCLUSIVE':comparisons.some(row=>row.benefitThreshold)&&!comparisons.some(row=>row.hmr.some(hmr=>hmr.materialRegression))?'KEEP':'SIMPLIFY_OR_DEPRECATE';
  return {schemaVersion:1,evaluatedIdentity:reference.identity,rows,initialRows,comparisons,initialNoisyGroups,noisyGroups,zeroDenominatorGroups,verdict,scope:'Two scale1 fixtures on Windows/Node24, stable modes, direct-plugin HMR. No Salt, cold OS cache, Vite/browser latency, cross-platform, storage or retained-memory claims.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {const summary=summarize(readJson('capture.json'));save('summary.json',summary);console.log(JSON.stringify({verdict:summary.verdict,samples:summary.rows.reduce((sum,row)=>sum+row.count,0),noisyGroups:summary.noisyGroups}));}
