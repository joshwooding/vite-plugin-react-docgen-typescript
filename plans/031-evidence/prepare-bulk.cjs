const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = source => crypto.createHash('sha256').update(source).digest('hex');
const runner = fs.readFileSync(path.join(__dirname, 'runner.mjs'), 'utf8');
const oldLoop = '      const payloads = [];\n      for (const entry of entries) {';
const oldEnd = '        payloads.push(reply.payload);\n      }\n      return { output:';
assert(runner.includes(oldLoop) && runner.includes(oldEnd));
const bulkRunner = runner.replace(oldLoop, '      const payloads = await Promise.all(entries.map(async entry => {')
  .replace(oldEnd, '        return reply.payload;\n      }));\n      return { output:');
const parent = fs.readFileSync(path.join(__dirname, 'cold.cjs'), 'utf8');
const bulkParent = parent.replaceAll("'runner.mjs'", "'runner-bulk.mjs'")
  .replaceAll("'cold-", "'bulk-").replace('`cold-${round}', '`bulk-${round}');
fs.writeFileSync(path.join(__dirname, 'runner-bulk.mjs'), bulkRunner, { flag: 'wx' });
fs.writeFileSync(path.join(__dirname, 'cold-bulk.cjs'), bulkParent, { flag: 'wx' });
fs.writeFileSync(path.join(__dirname, 'bulk-protocol.json'), JSON.stringify({
  declaredAt: new Date().toISOString(), rounds: 3, processes: 9, timeoutMs: 120000,
  reason: 'Storybook registerExtractionService.extractAllDocgen uses Promise.all. Match that request concurrency; preserve sequential-worker results separately.',
  ordering: 'Same cyclic three-mode ordering as initial comparison; sequential child processes, no replacement.',
  oldRunnerSha256: hash(runner), bulkRunnerSha256: hash(bulkRunner),
  originalParentSha256: hash(parent), bulkParentSha256: hash(bulkParent),
}, null, 2) + '\n', { flag: 'wx' });
