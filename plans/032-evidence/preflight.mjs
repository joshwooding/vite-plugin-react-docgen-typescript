import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { evidence, frozenEvidence, dist, root, identity, verifyIdentity, json, hash, writeJson, oraclePath, workloadIdentity } from "./common.mjs";
const main = path.resolve(evidence, "../..");
const phase = process.argv[4];
assert(["before", "after"].includes(phase));
const destination = path.join(evidence, `preflight-${phase}.json`);
assert(!existsSync(destination), "Do not overwrite preflight evidence");
const actual = identity();
verifyIdentity(actual, json(path.join(frozenEvidence, "identities.json")).salt.candidate);
for (const mode of ["default", "projectService"])
  for (const stage of ["baseline", "component", "shared"])
    verifyIdentity(json(oraclePath(mode, stage)).workloadIdentity, workloadIdentity(actual));
const sourceFreeze = json(path.join(main, "plans/029-evidence/source-freeze.json"));
for (const item of sourceFreeze) assert.equal(hash(readFileSync(path.join(main, item.path))), item.sha256, item.path);
const inherited = json(path.join(main, "plans/029-evidence/harness-freeze.json"));
const oldRepo = path.resolve(frozenEvidence, "../..");
for (const item of inherited) assert.equal(hash(readFileSync(path.join(oldRepo, item.path))), item.sha256, item.path);
const artifact = json(path.join(main, "plans/029-evidence/compatibility/artifact.json"));
for (const [name, expected] of Object.entries(artifact.distFiles)) {
  assert.equal(hash(readFileSync(path.join(path.dirname(dist), name))), expected, `candidate ${name}`);
  assert.equal(hash(readFileSync(path.join(main, "packages/vite-plugin-react-docgen-typescript/dist", name))), expected, `main ${name}`);
}
for (const [name, expected] of Object.entries(json(path.join(evidence, "harness-freeze.json"))))
  assert.equal(hash(readFileSync(path.join(evidence, name))), expected, name);
writeJson(destination, { verifiedAt: new Date().toISOString(), phase, identity: actual, sourceFilesVerified: sourceFreeze.length, inheritedHarnessFilesVerified: inherited.length, distFilesVerified: Object.keys(artifact.distFiles).length, oraclesVerified: 6, mainSourceCommit: "41b536a1293ba8a2b13a3f42c18f6b414334e22c" });
console.log(JSON.stringify({ phase, source: "unchanged reviewed artifact", targets: actual.targetCount, sourceHash: actual.sourceSha256, root, destination }));
