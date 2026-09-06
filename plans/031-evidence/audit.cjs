const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const evidence = __dirname;
const repo = path.resolve(evidence, '../..');
const raw = path.join(repo, '.yarn/simplification-evidence/031');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = file => sha(fs.readFileSync(file));
const median = values => [...values].sort((a, b) => a - b)[1];
const modes = ['projectService', 'native', 'storybook'];
const expected = structuredClone(read(path.join(repo, 'plans/030-evidence/native-188x7.json')).outputs['nightly-prototype:projectService']);
for (const component of Object.values(expected)) {
  component.props.tone.description = 'Shared tone revision 000.';
  component.props.tone.type.values = ['"base"', '"revision-000"'];
}
const checked = [];
const comparisons = {};
for (const prefix of ['cold', 'bulk']) {
  const attempts = read(path.join(evidence, `${prefix}-attempts.json`));
  const summary = read(path.join(evidence, `${prefix}-comparison.json`));
  const freeze = read(path.join(evidence, `${prefix}-freeze.json`));
  for (const file of freeze.freeze) assert.equal(fileHash(file.file), file.sha256);
  assert.equal(attempts.length, 9);
  for (const attempt of attempts) {
    assert.equal(attempt.status, 0);
    assert.equal(attempt.signal, null);
    assert.equal(attempt.mode, modes[(attempt.round + attempt.position) % 3]);
    assert.equal(fileHash(attempt.output), attempt.outputSha256);
    const result = read(attempt.output);
    assert.equal(result.status, 'passed');
    assert.equal(result.stages.length, 1);
    assert.equal(result.stages[0].elapsedMs, attempt.elapsedMs);
    assert.deepEqual(result.stages[0].output, expected);
    assert.equal(result.stages[0].digest, sha(JSON.stringify(expected)));
    if (attempt.mode === 'storybook') {
      assert.equal(result.versions.storybook, '10.6.0');
      assert.equal(result.versions.typescript, '6.0.3');
      assert.equal(result.stages[0].payloads.length, 188);
      for (const payload of result.stages[0].payloads) {
        const component = expected[payload.reactComponentMeta.displayName];
        assert.equal(payload.error, undefined);
        assert.equal(payload.description, component.description);
        assert.deepEqual(Object.keys(payload.argTypes).sort(), Object.keys(component.props));
        for (const [name, prop] of Object.entries(component.props)) {
          const arg = payload.argTypes[name];
          assert.equal(arg.description, prop.description);
          assert.equal(arg.type.required, prop.required);
          assert.equal(arg.type.name, prop.type.name);
          if (prop.type.values) assert.deepEqual([...arg.type.value].sort(), prop.type.values.map(value => JSON.parse(value)).sort());
          assert.equal(arg.table.defaultValue?.summary ?? null, prop.defaultValue);
        }
      }
    } else {
      assert.equal(result.metadata.typescriptVersion, attempt.mode === 'native' ? '7.1.0-dev.20260905.1' : '6.0.3');
    }
    checked.push({ file: attempt.output, sha256: attempt.outputSha256, mode: attempt.mode, protocol: prefix });
  }
  for (const lane of summary.lanes) {
    const values = attempts.filter(attempt => attempt.mode === lane.mode).map(attempt => attempt.elapsedMs);
    assert.deepEqual(values, lane.valuesMs);
    assert.equal(median(values), lane.medianMs);
    assert.equal(median(values.map(value => Math.abs(value - lane.medianMs))), lane.madMs);
  }
  const storybook = summary.lanes.find(lane => lane.mode === 'storybook');
  comparisons[prefix] = summary.lanes.filter(lane => lane.mode !== 'storybook').map(lane => ({
    against: lane.mode,
    storybookRatioOfMedians: storybook.medianMs / lane.medianMs,
    storybookExtraPercent: 100 * (storybook.medianMs / lane.medianMs - 1),
    pairedStorybookMinusPluginMs: storybook.valuesMs.map((value, index) => value - lane.valuesMs[index]),
  }));
}
const req = createRequire(path.join(raw, 'storybook-runtime/package.json'));
const rendererRequire = createRequire(req.resolve('@storybook/react/package.json'));
const compilerManifest = rendererRequire.resolve('typescript/package.json');
assert.equal(read(compilerManifest).version, '6.0.3');
const live = read(path.join(evidence, 'server-freshness.json'));
assert(live.sharedSourceAfterEdit.includes('revision-002'));
assert(live.sharedSourceAfterEdit.includes('Shared tone revision 002.'));
assert.equal(live.status, 'stale');
for (const value of Object.values(live.toneDescriptions)) assert.equal(value, 'Shared tone revision 001.');
const result = { status: 'verified', createdAt: new Date().toISOString(), processes: checked.length, checked, comparisons, rendererCompiler: { path: compilerManifest, sha256: fileHash(compilerManifest), version: '6.0.3' }, liveServerEvidenceSha256: fileHash(path.join(evidence, 'server-freshness.json')), findings: ['All 18 cold runs match the full normalized oracle.', 'All six Storybook payload sets also match ArgTypes names, descriptions, required flags, types, enum values and defaults.', 'Shared edit remained stale in published worker and live feature server. No edit timing claim.'] };
fs.writeFileSync(path.join(evidence, 'audit.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, processes: result.processes, comparisons, findings: result.findings }, null, 2));
