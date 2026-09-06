import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidence, '../..');
const raw = path.join(repo, '.yarn/simplification-evidence/031');
const runtime = path.join(raw, 'storybook-runtime');
const req = createRequire(path.join(runtime, 'package.json'));
const { readBenchmarkWorkspace, writeSharedRevision, loadPluginRunner, normalizeOutput } = await import(pathToFileURL(path.join(raw, 'backend-library.mjs')));
const fixture = readBenchmarkWorkspace(path.join(raw, 'fixture'));
const mode = process.argv[2];
const outputFile = process.argv[3];
const limit = Number(process.argv[4] ?? 188);
const editCount = process.argv[5] === '--cold-only' ? 0 : 3;
const entries = fixture.entries.slice(0, limit);
const checkpoint = (output, revision) => {
  assert.equal(Object.keys(output).length, limit);
  for (const entry of entries) {
    const component = output[entry.componentName];
    assert.equal(component.description, `Benchmark component ${Number(entry.componentName.slice(9))}.`);
    assert.deepEqual(Object.keys(component.props), ['density', 'label', 'tone', 'variant']);
    assert.equal(component.props.tone.description, `Shared tone revision ${String(revision).padStart(3, '0')}.`);
    assert.deepEqual(component.props.tone.type.values, ['"base"', `"revision-${String(revision).padStart(3, '0')}"`]);
  }
  return createHash('sha256').update(JSON.stringify(output)).digest('hex');
};
function workerTransport(worker) {
  let nextId = 0;
  const pending = new Map();
  worker.on('message', reply => {
    const key = reply.type === 'init' ? 'init' : reply.id;
    const request = pending.get(key);
    if (!request) return;
    pending.delete(key); clearTimeout(request.timer);
    reply.error ? request.reject(new Error(JSON.stringify(reply.error))) : request.resolve(reply);
  });
  worker.on('error', error => { for (const request of pending.values()) { clearTimeout(request.timer); request.reject(error); } pending.clear(); });
  return message => new Promise((resolve, reject) => {
    if (message.type !== 'init') message.id = nextId++;
    const key = message.type === 'init' ? 'init' : message.id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error('Worker request timeout')); }, 120000);
    pending.set(key, { resolve, reject, timer }); worker.postMessage(message);
  });
}
const toIndexEntry = entry => ({ type: 'story', id: entry.componentName.toLowerCase() + '--primary', title: entry.componentName, name: 'Primary', exportName: 'Primary', importPath: './' + path.relative(fixture.root, entry.storyFile).replaceAll('\\', '/'), tags: [] });
process.chdir(fixture.root);
writeSharedRevision(fixture.sharedFile, 0);
let worker, runner;
const result = { mode, versions: { storybook: req('storybook/package.json').version, typescript: mode === 'native' ? '7.1.0-dev.20260905.1' : req('typescript/package.json').version }, limit, startedAt: new Date().toISOString(), stages: [], status: 'running' };
try {
  const coldStart = performance.now();
  let extract;
  if (mode === 'storybook') {
    worker = new Worker(req.resolve('storybook/internal/docgen-worker'));
    const send = workerTransport(worker);
    await send({ type: 'init', descriptors: [{ moduleSpecifier: req.resolve('@storybook/react/internal/docgen-worker') }], logLevel: 'error' });
    extract = async () => {
      const payloads = await Promise.all(entries.map(async entry => {
        const reply = await send({ type: 'extract', entry: toIndexEntry(entry) });
        assert(reply.payload && !reply.payload.error && reply.payload.reactComponentMeta, `Missing metadata: ${entry.componentName}`);
        assert.deepEqual(Object.keys(reply.payload.argTypes).sort(), ['density', 'label', 'tone', 'variant']);
        return reply.payload;
      }));
      return { output: normalizeOutput(payloads.map(payload => payload.reactComponentMeta)), payloads };
    };
  } else {
    assert.equal(limit, 188, 'Plugin runs use the complete fixture');
    process.env.VITE_RDT_NATIVE_TYPESCRIPT_PACKAGE = 'typescript7next';
    const pluginEntry = path.join(repo, '.yarn/simplification-evidence/030/native-prototype/dist/index.mjs');
    const loaded = await loadPluginRunner(mode, fixture, false, pluginEntry, 'prototype');
    runner = await loaded.create();
    result.metadata = loaded.metadata;
    extract = () => runner.cold();
  }
  const cold = await extract();
  result.stages.push({ name: 'cold', elapsedMs: performance.now() - coldStart, ...cold });
  result.stages.at(-1).digest = checkpoint(cold.output, 0);
  for (let revision = 1; revision <= editCount; revision++) {
    const editStart = performance.now();
    let changed;
    if (mode === 'storybook') { writeSharedRevision(fixture.sharedFile, revision); changed = await extract(); }
    else changed = await runner.edit(revision);
    result.stages.push({ name: `shared-${revision}`, elapsedMs: performance.now() - editStart, ...changed });
    result.stages.at(-1).digest = checkpoint(changed.output, revision);
  }
  result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.error = error.stack; process.exitCode = 1;
} finally {
  await runner?.dispose();
  await worker?.terminate();
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(outputFile, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ mode, status: result.status, stages: result.stages.map(({ name, elapsedMs, digest }) => ({ name, elapsedMs, digest })), error: result.error }, null, 2));
}
