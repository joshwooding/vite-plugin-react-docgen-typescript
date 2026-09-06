const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os');
const evidence = __dirname;
const repo = path.resolve(evidence, '../..');
const raw = path.join(repo, '.yarn/simplification-evidence/031');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const saveNew = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const modes = ['projectService', 'native', 'storybook'];
const expected = structuredClone(read(path.join(repo, 'plans/030-evidence/native-188x7.json')).outputs['nightly-prototype:projectService']);
for (const component of Object.values(expected)) {
  component.props.tone.description = 'Shared tone revision 000.';
  component.props.tone.type.values = ['"base"', '"revision-000"'];
}
const artifact = read(path.join(repo, 'plans/030-evidence/native-artifact.json'));
const freezeFiles = [__filename, path.join(evidence, 'runner.mjs'), path.join(raw, 'backend-library.mjs'), path.join(raw, 'storybook-runtime/package-lock.json'),
  ...artifact.files.map(file => file.destination),
  ...['storybook/dist/shared/open-service/services/docgen/worker/docgen-worker.js', '@storybook/react/dist/docgen/docgen-worker.js', '@storybook/react/dist/_node-chunks/chunk-PEK7NXDQ.js', 'typescript/lib/typescript.js'].map(file => path.join(raw, 'storybook-runtime/node_modules', file)),
];
const freeze = freezeFiles.map(file => ({ file, sha256: hash(file) }));
saveNew(path.join(evidence, 'cold-freeze.json'), { createdAt: new Date().toISOString(), freeze, host: { node: process.version, platform: process.platform, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length }, budget: { rounds: 3, processes: 9, timeoutMs: 120000 } });
const attempts = [];
for (let round = 0; round < 3; round++) {
  const order = [...modes.slice(round), ...modes.slice(0, round)];
  for (const [position, mode] of order.entries()) {
    const output = path.join(raw, `cold-${round}-${position}-${mode}.json`);
    assert(!fs.existsSync(output));
    console.log(`Cold round ${round + 1}/3, position ${position + 1}/3: ${mode}`);
    const attempt = { round, position, mode, output, startedAt: new Date().toISOString() };
    const child = cp.spawnSync(process.execPath, [path.join(evidence, 'runner.mjs'), mode, output, '188', '--cold-only'], { cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
    Object.assign(attempt, { finishedAt: new Date().toISOString(), status: child.status, signal: child.signal, error: child.error?.message, stdout: child.stdout, stderr: child.stderr });
    attempts.push(attempt);
    fs.writeFileSync(path.join(evidence, 'cold-attempts.json'), JSON.stringify(attempts, null, 2) + '\n');
    assert.equal(child.status, 0, JSON.stringify(attempt));
    const result = read(output);
    assert.equal(result.status, 'passed');
    assert.equal(result.stages.length, 1);
    assert.deepEqual(result.stages[0].output, expected);
    attempt.elapsedMs = result.stages[0].elapsedMs;
    attempt.outputSha256 = hash(output);
    console.log(`${mode}: ${attempt.elapsedMs.toFixed(1)} ms; all 188 normalized components match`);
  }
}
for (const file of freeze) assert.equal(hash(file.file), file.sha256);
fs.writeFileSync(path.join(evidence, 'cold-attempts.json'), JSON.stringify(attempts, null, 2) + '\n');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const lanes = modes.map(mode => {
  const values = attempts.filter(attempt => attempt.mode === mode).map(attempt => attempt.elapsedMs);
  const mid = median(values);
  return { mode, valuesMs: values, medianMs: mid, madMs: median(values.map(value => Math.abs(value - mid))) };
});
saveNew(path.join(evidence, 'cold-comparison.json'), { status: 'passed', processes: attempts.length, parity: '188 complete normalized components match the independent oracle in every run', lanes });
console.log(JSON.stringify(lanes, null, 2));
