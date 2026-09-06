import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const evidence = path.join(repo, 'plans/033-evidence');
assert(!existsSync(path.join(evidence, 'measurement-freeze.json')), 'Preserve pre-sampling freeze');
const json = (file) => JSON.parse(readFileSync(path.join(evidence, file), 'utf8'));
const expected = json('identities.json');
let common;
for (const workload of ['salt', 'shallow']) {
  for (const variant of ['baseline', 'candidate']) {
    process.argv[2] = workload;
    process.argv[3] = variant;
    common = await import(`${pathToFileURL(path.join(evidence, 'common.mjs'))}?freeze-${workload}-${variant}`);
    common.verifyIdentity(common.identity(), expected[workload][variant]);
    for (const mode of ['default', 'projectService']) {
      const diagnostic = json(`diagnostics/${workload}-${variant}-${mode}.json`);
      assert.deepEqual(diagnostic.identity, expected[workload][variant]);
      assert.equal(diagnostic.observed.length, 1);
      assert.equal(diagnostic.observed[0].errors.length, 0);
    }
  }
}
const { hash, writeJson } = common;
const hashFile = (file) => hash(readFileSync(file));
const artifact = json('compatibility/artifact.json');
for (const item of artifact.sourceFreeze)
  assert.equal(hashFile(path.join(artifact.sourceRoot, item.path)), item.sha256);
assert.equal(hashFile(artifact.archive), artifact.archiveSha256);
const matrix = json('compatibility/summary.json');
assert.equal(matrix.status, 'PASS');
assert.equal(matrix.rows.length, 10);
assert.equal(matrix.archiveSha256, artifact.archiveSha256);
const restart = json('compatibility/restart-results.json');
const watchers = json('compatibility/watcher-results.json');
const native = json('compatibility/native/native-lower.json');
assert.equal(restart.verdict, 'PASS');
assert.equal(restart.rows.length, 26);
assert.equal(watchers.verdict, 'PASS');
assert.equal(watchers.rows.length, 4);
for (const report of [restart, watchers])
  assert.equal(report.identity.buildSha256, artifact.distFiles['index.mjs']);
assert.equal(native.status, 'PASS');
assert.equal(native.archiveSha256, artifact.archiveSha256);
const inputs = [
  'common.mjs', 'driver.mjs', 'run-samples.mjs', 'summarize.mjs',
  'prepare-inputs.mjs', 'verify-controls.mjs', 'diagnose-project.mjs',
  'protocol.json', 'identities.json', 'artifact-inputs.json', 'source-freeze.json',
  ...readdirSync(path.join(evidence, 'oracles')).sort().map((name) => `oracles/${name}`),
];
const record = {
  createdAt: new Date().toISOString(),
  status: 'READY FOR FIXED 24-PROCESS MEASUREMENT',
  artifact,
  hashes: Object.fromEntries(inputs.map((file) => [file, hashFile(path.join(evidence, file))])),
  correctness: { fullTests: 343, independentFocusedTests: 78, matrixRows: 10, restartCheckpoints: 26, nativeWatcherRows: 4, packedLowerNativePhases: 4, actualProgramDiagnostics: 8 },
  independentHarnessReview: 'Clean limited-scope comparison: destinations and metadataChecks only; identities/oracles exact. Final independent audit must check all four metadataChecks records and full affected lists in addition to inherited summary checks.',
  expectedShallowAffected: { component: ['src/components/Button.tsx', 'src/components/ButtonWrapper.tsx'], shared: ['src/components/Button.tsx', 'src/components/ButtonWrapper.tsx', 'src/components/IconButton.tsx'] },
  expectedSaltAffected: Object.keys(json('oracles/salt-default-baseline.json').summary.files).sort(),
  noConcurrentHeavyWork: true,
  scope: 'Direct plugin, disk cache off, both stable modes, fixed owned paths. Existing HMR source reads remain included in timing; comparisons and extra proof serialization remain outside timing.',
};
writeJson(path.join(evidence, 'measurement-freeze.json'), record);
console.log(JSON.stringify({ status: record.status, inputs: inputs.length, correctness: record.correctness }));
