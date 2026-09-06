import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const repo = process.cwd();
const evidence = path.join(repo, "plans/033-evidence");
assert(!existsSync(path.join(evidence, "identities.json")), "Preserve frozen inputs");
const identities = {};
let common;
for (const workload of ["salt", "shallow"]) {
  identities[workload] = {};
  for (const variant of ["baseline", "candidate"]) {
    process.argv[2] = workload;
    process.argv[3] = variant;
    common = await import(`${pathToFileURL(path.join(evidence, "common.mjs"))}?${workload}-${variant}`);
    identities[workload][variant] = common.identity();
  }
  common.verifyIdentity(common.workloadIdentity(identities[workload].baseline), common.workloadIdentity(identities[workload].candidate));
}
const { json, hash, writeJson, workloadIdentity, verifyIdentity } = common;
const oldIdentities = json(path.join(repo, "plans/029-evidence/identities.json"));
for (const workload of ["salt", "shallow"]) {
  verifyIdentity(workloadIdentity(identities[workload].baseline), workloadIdentity(oldIdentities[workload].candidate));
  for (const mode of ["default", "projectService"])
    for (const stage of ["baseline", "component", "shared"]) {
      const file = path.join(evidence, "oracles", `${workload}-${mode}-${stage}.json`);
      const old = path.join(repo, "plans/029-evidence/oracles", path.basename(file));
      assert.equal(hash(readFileSync(file)), hash(readFileSync(old)), "Copied oracle changed");
      verifyIdentity(json(file).workloadIdentity, workloadIdentity(identities[workload].baseline));
    }
}
const artifacts = json(path.join(evidence, "artifact-inputs.json"));
assert.equal(identities.salt.baseline.artifact.files["dist/index.mjs"], artifacts.baseline.distFiles["index.mjs"]);
assert.equal(identities.salt.candidate.artifact.files["dist/index.mjs"], artifacts.candidate.distFiles["index.mjs"]);
assert.notEqual(artifacts.baseline.distFiles["index.mjs"], artifacts.candidate.distFiles["index.mjs"], "Candidate must contain the intended implementation change");
for (const variant of ["baseline", "candidate"])
  for (const [file, expected] of Object.entries(artifacts[variant].distFiles))
    assert.equal(identities.salt[variant].artifact.files[`dist/${file}`], expected, `${variant}/${file}`);
writeJson(path.join(evidence, "identities.json"), identities);
writeJson(path.join(evidence, "input-adaptation.json"), {
  createdAt: new Date().toISOString(),
  baseline: "Exact Plan029 candidate archive now used as baseline; current source41b536a verified before implementation integration.",
  candidate: "Plan033 isolated build/archive with frozen source and distribution hashes.",
  unchangedWorkloads: "All Salt/shallow consumer, compiler, dependency, options, config and source identities exactly match Plan029 candidate workloadIdentity; all12 oracle files retain original bytes.",
  artifacts,
});
console.log(JSON.stringify({ workloads: Object.keys(identities), oracleFiles: 12, artifacts: "verified and different", workloadIdentities: "identical to frozen029" }));
