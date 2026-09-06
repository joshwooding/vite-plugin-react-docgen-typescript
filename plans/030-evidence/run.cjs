// Superseded stable-compiler CLI setup. No formal samples were collected.
// Known preflight assertion at the negative control requires exit 2, although
// TS7 correctly reports the expected TS2322 with exit 1. Preserved, not reused.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { pathToFileURL } = require('node:url');

const evidence = __dirname;
const repo = path.resolve(evidence, '../..');
const raw = path.join(repo, '.yarn/simplification-evidence/030');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const save = (name, value) => fs.writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const physical = file => fs.realpathSync.native(file).replaceAll('\\', '/');
const previous = read(path.join(repo, '.yarn/.codex-worktrees/plan029/vite-plugin-react-docgen-typescript/plans/029-evidence/identities.json'));
const compilers = Object.fromEntries(['ts6', 'ts7'].map(name => {
  const root = path.join(repo, 'node_modules', name === 'ts6' ? 'typescript' : 'typescript7');
  return [name, { root, cli: path.join(root, 'bin/tsc'), version: read(path.join(root, 'package.json')).version }];
}));
assert.equal(compilers.ts6.version, '6.0.3');
assert.equal(compilers.ts7.version, '7.0.2');
const workloads = Object.fromEntries(['salt', 'shallow'].map(name => {
  const root = previous[name].baseline.root;
  return [name, { root, config: path.join(root, name === 'salt' ? 'packages/core/tsconfig.json' : 'tsconfig.json') }];
}));
const baseArgs = config => ['--noEmit', '--incremental', 'false', '--pretty', 'false', '--noCheck', 'false', '--project', config];
function run(compiler, config, cwd, extra = []) {
  const args = [compilers[compiler].cli, ...baseArgs(config), ...extra];
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const child = cp.spawnSync(process.execPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
  const elapsedMs = performance.now() - start;
  return { command: [process.execPath, ...args], cwd, startedAt, finishedAt: new Date().toISOString(), elapsedMs, status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr };
}
function success(result) {
  assert.equal(result.status, 0, result.error || result.stdout || result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
}
function verifyFiles(files) {
  for (const [file, expected] of Object.entries(files)) assert.equal(fileHash(file), expected, 'Changed input: ' + file);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const statistics = values => {
  const medianMs = median(values);
  const madMs = median(values.map(value => Math.abs(value - medianMs)));
  return { values, medianMs, madMs, madPercent: 100 * madMs / medianMs };
};

async function preflight() {
  fs.mkdirSync(raw, { recursive: true });
  const nativeExe = (await import(pathToFileURL(path.join(compilers.ts7.root, 'lib/getExePath.js')).href)).default();
  const libraryRoots = [physical(path.join(compilers.ts6.root, 'lib')), physical(path.dirname(nativeExe)), physical(path.join(compilers.ts7.root, 'lib'))];
  const proof = { createdAt: new Date().toISOString(), harnessSha256: fileHash(__filename), node: process.version, host: { platform: process.platform, release: os.release(), arch: process.arch, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length }, compilers, nativeExe, inputs: {}, workloads: {}, negativeControls: {}, budget: { pairsPerWorkload: 5, processes: 20, timeoutMs: 120000, replacement: false, extension: false } };
  for (const compiler of Object.values(compilers)) {
    for (const file of [compiler.cli, path.join(compiler.root, 'package.json')]) proof.inputs[file] = fileHash(file);
  }
  for (const file of [nativeExe, path.join(compilers.ts6.root, 'lib/_tsc.js'), path.join(compilers.ts7.root, 'lib/tsc.js'), path.join(compilers.ts7.root, 'lib/getExePath.js')]) proof.inputs[file] = fileHash(file);
  for (const [name, workload] of Object.entries(workloads)) {
    proof.inputs[workload.config] = fileHash(workload.config);
    if (name === 'salt') {
      const base = path.join(workload.root, 'tsconfig.base.json');
      proof.inputs[base] = fileHash(base);
    }
    const selected = {};
    for (const compiler of ['ts6', 'ts7']) {
      const diagnostic = read(path.join(evidence, 'preflight2-' + name + '-' + compiler + '.json'));
      success(diagnostic);
      assert(/Check time:\s+[0-9.]+s/.test(diagnostic.stdout));
      const config = run(compiler, workload.config, workload.root, ['--showConfig']);
      save('config-' + name + '-' + compiler + '.json', config);
      success(config);
      const parsed = JSON.parse(config.stdout);
      assert.notEqual(parsed.compilerOptions.noCheck, true);
      const roots = parsed.files.map(file => physical(path.resolve(path.dirname(workload.config), file))).sort();
      const listing = run(compiler, workload.config, workload.root, ['--listFilesOnly']);
      save('files-' + name + '-' + compiler + '.json', listing);
      success(listing);
      const files = listing.stdout.trim().split(/\r?\n/).map(file => physical(file.trim())).sort();
      assert.equal(files.length, Number(diagnostic.stdout.match(/^Files:\s+(\d+)/m)[1]));
      const libraries = files.filter(file => libraryRoots.includes(path.posix.dirname(file)) && /^lib.*\.d\.ts$/.test(path.posix.basename(file)));
      const nonCompilerFiles = files.filter(file => !libraries.includes(file));
      for (const file of files) proof.inputs[file] = fileHash(file);
      selected[compiler] = { roots, files, libraries, nonCompilerFiles };
    }
    assert.deepEqual(selected.ts6.roots, selected.ts7.roots, name + ': root inputs differ');
    assert.deepEqual(selected.ts6.nonCompilerFiles, selected.ts7.nonCompilerFiles, name + ': source/dependency inputs differ');
    assert.equal(selected.ts6.roots.length, name === 'salt' ? 401 : 4);
    proof.workloads[name] = { ...workload, ...selected };
    console.log(name + ': matching roots and non-compiler inputs verified');
  }
  const negative = path.join(raw, 'negative');
  fs.mkdirSync(negative, { recursive: true });
  fs.writeFileSync(path.join(negative, 'negative.ts'), 'const sentinel: string = 123;\n', { flag: 'wx' });
  fs.writeFileSync(path.join(negative, 'tsconfig.json'), JSON.stringify({ files: ['negative.ts'], compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, types: [], lib: ['ES2020'] } }), { flag: 'wx' });
  for (const compiler of ['ts6', 'ts7']) {
    const result = run(compiler, path.join(negative, 'tsconfig.json'), negative);
    save('negative-' + compiler + '.json', result);
    assert.equal(result.status, 2);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /negative\.ts\(1,7\): error TS2322/);
    proof.negativeControls[compiler] = 'Expected TS2322 returned';
  }
  assert.deepEqual(Object.keys(require(path.join(compilers.ts7.root, 'lib/version.cjs'))).sort(), ['version', 'versionMajorMinor']);
  verifyFiles(proof.inputs);
  save('input-proof.json', proof);
  console.log('Preflight complete; no formal timing samples have run.');
}

function sample() {
  const proofPath = path.join(evidence, 'input-proof.json');
  const proof = read(proofPath);
  assert.equal(fileHash(__filename), proof.harnessSha256);
  verifyFiles(proof.inputs);
  const ledgerPath = path.join(evidence, 'attempts.json');
  assert(!fs.existsSync(ledgerPath), 'Never overwrite or extend a sampled matrix');
  const ledger = { startedAt: new Date().toISOString(), inputProofSha256: fileHash(proofPath), budget: proof.budget, attempts: [] };
  const writeLedger = () => fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  writeLedger();
  for (let round = 1; round <= 5; round++) for (const workload of ['salt', 'shallow']) {
    const ts6First = workload === 'salt' ? round % 2 === 1 : round % 2 === 0;
    for (const compiler of ts6First ? ['ts6', 'ts7'] : ['ts7', 'ts6']) {
      const current = workloads[workload];
      const result = { workload, compiler, round, ...run(compiler, current.config, current.root) };
      const file = 'sample-' + workload + '-r' + round + '-' + compiler + '.json';
      save(file, result);
      ledger.attempts.push({ workload, compiler, round, file, sha256: fileHash(path.join(evidence, file)), status: result.status, startedAt: result.startedAt, finishedAt: result.finishedAt });
      writeLedger();
      console.log(JSON.stringify({ workload, compiler, round, elapsedMs: result.elapsedMs, status: result.status }));
      success(result);
      assert.equal(result.stdout, '');
    }
  }
  verifyFiles(proof.inputs);
  assert.equal(fileHash(__filename), proof.harnessSha256);
  const summaries = {};
  for (const workload of ['salt', 'shallow']) {
    const values = compiler => ledger.attempts.filter(a => a.workload === workload && a.compiler === compiler).map(a => read(path.join(evidence, a.file)).elapsedMs);
    const ts6 = statistics(values('ts6')), ts7 = statistics(values('ts7'));
    const pairedDeltasMs = ts6.values.map((value, index) => value - ts7.values[index]);
    summaries[workload] = { ts6, ts7, pairedDeltasMs, speedup: ts6.medianMs / ts7.medianMs, reductionPercent: 100 * (ts6.medianMs - ts7.medianMs) / ts6.medianMs, inconclusive: ts6.madPercent > 20 || ts7.madPercent > 20 || (pairedDeltasMs.some(d => d > 0) && pairedDeltasMs.some(d => d < 0)) };
  }
  ledger.finishedAt = new Date().toISOString();
  writeLedger();
  save('comparison.json', { benchmark: 'Fresh-process CLI typecheck; no docgen/HMR measurement', compilers, summaries });
  console.log(JSON.stringify(summaries, null, 2));
}

const mode = process.argv[2];
assert(['preflight', 'sample'].includes(mode));
Promise.resolve(mode === 'preflight' ? preflight() : sample()).catch(error => { console.error(error); process.exitCode = 1; });
