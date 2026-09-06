import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { dependencyFingerprint, directory, fingerprint, harness, hash, launch, readJson, save, scriptFingerprint } from './common.mjs';
import { groups,key,states,summarize,validateInvocationOrder,validateReport } from './summarize.mjs';

assert.equal(process.argv[2],'--capture','Use --capture only after root readiness review');
assert.ok(!existsSync(path.join(directory,'capture.json')),'Never overwrite/restart a capture');
const frozen=readJson('frozen-identity.json'),controls=readJson('controls-results.json');
assert.equal(controls.status,'PASS');assert.equal(controls.groups.length,4);assert.ok(controls.groups.every(group=>group.status==='PASS'));
assert.deepEqual(fingerprint(),frozen.inputs);assert.deepEqual(controls.before,frozen.inputs);assert.deepEqual(controls.after,frozen.inputs);
assert.deepEqual(dependencyFingerprint(),frozen.dependencyFiles);
assert.equal(hash(readFileSync(process.execPath)),frozen.executableSha256);
const stamp=()=>({inputs:fingerprint(),scripts:scriptFingerprint(),dependencies:dependencyFingerprint(),nodeExecutableSha256:hash(readFileSync(process.execPath))});
const manifest={schemaVersion:1,status:'RUNNING',stage:'initial',startedAt:new Date().toISOString(),executable:process.execPath,cwd:path.resolve(directory,'../..'),before:stamp(),after:null,correctnessControlsSha256:hash(readFileSync(path.join(directory,'controls-results.json'))),frozenIdentitySha256:hash(readFileSync(path.join(directory,'frozen-identity.json'))),extendedGroups:[],samples:[],failures:[]};
mkdirSync(path.join(directory,'timings'),{recursive:true});save('capture.json',manifest,true);
const persist=()=>save('capture.json',manifest);
let reference;
async function rounds(first,last,selected) {
  for(let round=first;round<=last;round++)for(const group of selected) {
    const offset=(round-1)%3;
    for(const cache of [...states.slice(offset),...states.slice(0,offset)]) {
      assert.deepEqual(stamp(),manifest.before,'Inputs/runner changed before invocation');
      assert.equal(hash(readFileSync(path.join(directory,'controls-results.json'))),manifest.correctnessControlsSha256);
      const report=`timings/${group.scenario}-${group.mode}-${cache}-${String(round).padStart(2,'0')}.json`;
      assert.ok(!existsSync(path.join(directory,report)),'Preserve existing raw output');
      const invocation=manifest.samples.length+1;
      const sample={invocation,invocationId:`035-${String(invocation).padStart(3,'0')}`,...group,cache,round,report,status:'RUNNING',inputFingerprint:hash(JSON.stringify(manifest.before.inputs)),scriptFingerprint:hash(JSON.stringify(manifest.before.scripts))};manifest.samples.push(sample);persist();
      try {
        await launch([harness,'--scenario',group.scenario,'--scale','1','--modes',group.mode,'--cache',cache,'--iterations','1','--output',path.join(directory,report)],sample);
        sample.reportSha256=hash(readFileSync(path.join(directory,report)));
        const data=readJson(report);const run=validateReport(data,sample,reference);reference??=data;
        sample.untimedChildProcesses=[...new Set([run.cacheLifecycle.seedProcessId,run.cacheLifecycle.validation?.processId].filter(value=>value!==null&&value!==undefined))];
        validateInvocationOrder(manifest);assert.deepEqual(stamp(),manifest.before,'Inputs/runner changed during invocation');sample.status='PASS';persist();
        console.log(`${invocation}: ${key(group)}/${cache} round ${round}: PASS`);
      } catch(error) {sample.status='FAILED';manifest.status='FAILED';manifest.failures.push({invocation,message:String(error),stack:error.stack});persist();throw error;}
    }
  }
}
await rounds(1,5,groups);manifest.after=stamp();manifest.status='COMPLETE';
const initial=summarize(manifest);save('initial-summary.json',initial,true);manifest.extendedGroups=initial.noisyGroups;
if(manifest.extendedGroups.length) {manifest.status='RUNNING';persist();console.log('One extension: '+manifest.extendedGroups.join(', '));await rounds(6,10,groups.filter(group=>manifest.extendedGroups.includes(key(group))));}
manifest.stage='final';manifest.after=stamp();manifest.status='COMPLETE';manifest.finishedAt=new Date().toISOString();persist();
const summary=summarize(manifest);save('summary.json',summary,true);console.log(JSON.stringify({verdict:summary.verdict,samples:manifest.samples.length,noisyGroups:summary.noisyGroups}));
