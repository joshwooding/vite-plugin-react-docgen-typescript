// Read-only audit of the current-nightly prototype benchmark; writes only its report.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const evidence = __dirname;
const repo = path.resolve(evidence, '../..');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summary = values => {
  const mid = median(values);
  return { values, median: mid, mad: median(values.map(value => Math.abs(value - mid))) };
};
const resultPath = path.join(evidence, 'native-188x7.json');
const result = read(resultPath);
const artifact = read(path.join(evidence, 'native-artifact.json'));
const log = fs.readFileSync(path.join(evidence, 'native-188x7.log'), 'utf8');
const workspace = /Kept benchmark workspace at (.+)/.exec(log)[1].trim();
const modes = ['projectService', 'native'];
const versions = ['6.0.3', '7.1.0-dev.20260905.1'];
const harness = path.join(artifact.prototypeCheckout, 'scripts/benchmark-backends.mjs');
assert.equal(fileHash(harness), 'f5dcde4895b27f948d2158acba86199b0abbec1f2f3f5aed0b60ed9b92a60bd0');
for (const file of artifact.files) {
  assert.equal(fileHash(file.source), file.sha256);
  assert.equal(fileHash(file.destination), file.sha256);
}
const pluginRequire = createRequire(path.join(artifact.artifact, 'dist/index.mjs'));
const compilerPackages = ['typescript', 'typescript7next'].map((name, index) => {
  const manifestPath = pluginRequire.resolve(`${name}/package.json`);
  const manifest = read(manifestPath);
  assert.equal(manifest.version, versions[index]);
  return { name, version: manifest.version, path: fs.realpathSync.native(manifestPath), sha256: fileHash(manifestPath), gitHead: manifest.gitHead };
});
const nativeRequire = createRequire(compilerPackages[1].path);
const nativePlatformManifest = nativeRequire.resolve('@typescript/typescript-win32-x64/package.json');
assert.equal(read(nativePlatformManifest).version, versions[1]);
const nativeExecutable = path.join(path.dirname(nativePlatformManifest), 'lib/tsc.exe');
assert.equal(result.iterations, 4);
assert.equal(result.edits, 3);
assert.equal(result.counterbalanced, true);
assert.equal(result.fixture.componentCount, 188);
assert.equal(result.fixture.projectCount, 7);
assert.equal(result.results.length, 2);
assert.equal(result.parity[0].exactComponentMatches, 188);
assert.equal(result.parity[0].fieldAgreement, 1);

const rawFiles = [];
let expectedOutput;
const lanes = modes.map((mode, modeIndex) => {
  const lane = result.results.find(item => item.mode === mode);
  assert.equal(lane.runs.length, 4);
  for (let iteration = 0; iteration < 4; iteration++) {
    const run = lane.runs.find(item => item.iteration === iteration);
    const order = (modeIndex + iteration) % 2;
    assert.equal(run.order, order);
    assert.equal(result.executionOrder[iteration][order], `nightly-prototype:${mode}`);
    assert.equal(run.metadata.typescriptVersion, versions[modeIndex]);
    assert.equal(path.resolve(run.metadata.pluginEntry), path.join(artifact.artifact, 'dist/index.mjs'));
    assert.equal(run.editSamplesMs.length, 3);
    assert.equal(run.cold.totalMs, run.cold.moduleLoadMs + run.cold.setupMs + run.cold.extractionMs);
    assert.equal(run.cold.measurement.nativeRequestProfile, null);
    const rawPath = path.join(workspace, `run-${iteration}-${order}.json`);
    const raw = read(rawPath);
    const { output, ...rawWithoutOutput } = raw;
    const { iteration: ignoredIteration, order: ignoredOrder, ...recorded } = run;
    assert.deepEqual(rawWithoutOutput, recorded);
    assert.equal(hash(JSON.stringify(output)), run.outputDigest);
    assert.equal(Object.keys(output).length, 188);
    for (let componentIndex = 0; componentIndex < 188; componentIndex++) {
      const name = `Component${String(componentIndex).padStart(3, '0')}`;
      const component = output[name];
      assert.equal(component.displayName, name);
      assert.equal(component.description, `Benchmark component ${componentIndex}.`);
      assert.deepEqual(Object.keys(component.props), ['density', 'label', 'tone', 'variant']);
      assert.equal(component.props.tone.description, 'Shared tone revision 003.');
      assert.deepEqual(component.props.tone.type.values, ['"base"', '"revision-003"']);
    }
    expectedOutput ??= output;
    assert.deepEqual(output, expectedOutput);
    rawFiles.push({ path: rawPath, sha256: fileHash(rawPath), outputDigest: run.outputDigest });
  }
  const runs = lane.runs;
  return {
    mode, version: versions[modeIndex],
    coldMs: summary(runs.map(run => run.cold.totalMs)),
    meanEditMs: summary(runs.map(run => run.editSamplesMs.reduce((a, b) => a + b, 0) / 3)),
    coldRetainedRssMiB: summary(runs.map(run => run.memory.cold.retainedRssBytes / 1048576)),
    editSamplesMs: runs.map(run => run.editSamplesMs),
  };
});
const comparisons = Object.fromEntries(['coldMs', 'meanEditMs'].map(metric => {
  const baseline = lanes[0][metric];
  const nightly = lanes[1][metric];
  const differencesMs = baseline.values.map((value, index) => value - nightly.values[index]);
  return [metric, { ratioOfMedians: baseline.median / nightly.median, reductionPercent: 100 * (1 - nightly.median / baseline.median), pairedDifferencesMs: differencesMs, allPairsFavorNightly: differencesMs.every(value => value > 0) }];
}));
const audit = {
  status: 'verified', createdAt: new Date().toISOString(), resultPath,
  resultSha256: fileHash(resultPath), harness, harnessSha256: fileHash(harness),
  compilerPackages, nativeExecutable: { path: nativeExecutable, sha256: fileHash(nativeExecutable) },
  host: { node: process.version, platform: process.platform, arch: process.arch, release: os.release(), cpu: os.cpus()[0].model, logicalCpus: os.cpus().length },
  processes: rawFiles.length, rawFiles, lanes, comparisons,
  limits: ['Synthetic fixture; older experimental artifact, not Plan 029 or Salt DS.', 'Final normalized output equality checked on every run; intermediate revisions checked by original harness for count and shared description, not full cross-backend field equality.', 'Native timing instrumentation enabled; request profiling disabled. Cold total excludes Node process startup.'],
};
fs.writeFileSync(path.join(evidence, 'native-audit.json'), JSON.stringify(audit, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: audit.status, host: audit.host, lanes, comparisons }, null, 2));
