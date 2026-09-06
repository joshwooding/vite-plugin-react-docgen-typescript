import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const evidence = path.join(process.cwd(), 'plans/033-evidence');
assert(!existsSync(path.join(evidence, 'restored-inputs.json')), 'Preserve successful final identity check');
const expected = JSON.parse(readFileSync(path.join(evidence, 'identities.json'), 'utf8'));
const results = [];
let common;
for (const workload of ['salt', 'shallow']) {
  const ledger = JSON.parse(readFileSync(path.join(evidence, `${workload}-attempts.json`), 'utf8'));
  assert(ledger.finishedAt && ledger.attempts.length === 12);
  for (const variant of ['baseline', 'candidate']) {
    process.argv[2] = workload;
    process.argv[3] = variant;
    common = await import(`${pathToFileURL(path.join(evidence, 'common.mjs'))}?after-${workload}-${variant}`);
    common.verifyIdentity(common.identity(), expected[workload][variant]);
    results.push({ workload, variant, status: 'PASS' });
  }
}
common.writeJson(path.join(evidence, 'restored-inputs.json'), { verifiedAt: new Date().toISOString(), status: 'PASS', results });
console.log(JSON.stringify({ restoredIdentities: results.length, status: 'PASS' }));
