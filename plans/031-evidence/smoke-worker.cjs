const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { Worker } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const evidence = __dirname;
const repo = path.resolve(evidence, '../..');
const runtime = path.join(repo, '.yarn/simplification-evidence/031/storybook-runtime');
const req = createRequire(path.join(runtime, 'package.json'));
const fixture = path.join(repo, '.yarn/simplification-evidence/031/fixture');
process.chdir(fixture);
const manifest = JSON.parse(fs.readFileSync('benchmark-manifest.json', 'utf8'));
const start = performance.now();
const worker = new Worker(req.resolve('storybook/internal/docgen-worker'));
let seq = 0;
function send(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Worker request timed out')); }, 120000);
    const cleanup = () => { clearTimeout(timer); worker.off('message', receive); worker.off('error', fail); };
    const fail = error => { cleanup(); reject(error); };
    const receive = reply => {
      if (reply.type === message.type && (message.type === 'init' || reply.id === message.id)) {
        cleanup(); reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve(reply);
      }
    };
    worker.on('message', receive); worker.on('error', fail); worker.postMessage(message);
  });
}
(async () => {
  try {
    await send({ type: 'init', descriptors: [{ moduleSpecifier: req.resolve('@storybook/react/internal/docgen-worker') }], logLevel: 'error' });
    const entry = manifest.entries[0];
    const reply = await send({ type: 'extract', id: seq++, entry: { type: 'story', id: 'component000--primary', title: entry.componentName, name: 'Primary', exportName: 'Primary', importPath: './' + entry.storyFile.replaceAll('\\', '/'), tags: [] } });
    const result = { elapsedMs: performance.now() - start, reply };
    fs.writeFileSync(path.join(evidence, 'worker-smoke.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(result, null, 2));
  } finally { await worker.terminate(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
