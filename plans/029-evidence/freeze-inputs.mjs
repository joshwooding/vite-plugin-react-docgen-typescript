import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.cwd();
const identities = {};
let common;
for (const workload of ["salt", "shallow"]) {
  identities[workload] = {};
  for (const variant of ["baseline", "candidate"]) {
    process.argv[2] = workload;
    process.argv[3] = variant;
    common = await import(
      `${pathToFileURL(path.join(repo, "plans/029-evidence/common.mjs"))}?${workload}-${variant}`
    );
    identities[workload][variant] = common.identity();
  }
  common.verifyIdentity(
    common.workloadIdentity(identities[workload].baseline),
    common.workloadIdentity(identities[workload].candidate),
  );
}
const { json, hash, writeJson, evidence, workloadIdentity } = common;
const current = identities.salt.baseline;
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: current.root,
    windowsHide: true,
  })
    .toString()
    .trim(),
  "2e1da8e4fbc398b2a7dfffbd357feedf222f7e07",
);
for (const mode of ["default", "projectService"])
  for (const stage of ["baseline", "component", "shared"]) {
    const original = path.join(
      repo,
      "plans/027-evidence/oracles",
      `${mode}-${stage}.json`,
    );
    const oracle = json(original);
    for (const [oldKey, newKey] of [
      ["saltSourceSha256", "sourceSha256"],
      ["saltLockSha256", "saltLockSha256"],
      ["consumerLockSha256", "consumerLockSha256"],
      ["pluginLockSha256", "pluginLockSha256"],
      ["configSha256", "configSha256"],
      ["targetsSha256", "targetsSha256"],
      ["targetCount", "targetCount"],
      ["selectedConfigHashes", "selectedConfigHashes"],
    ])
      assert.deepEqual(
        oracle.identity[oldKey],
        current[newKey],
        `Original027 invariant: ${oldKey}`,
      );
    assert.equal(
      oracle.identity.pluginBuildSha256,
      current.artifact.files["dist/index.mjs"],
    );
    assert.deepEqual(
      oracle.identity.pluginDependencies,
      current.pluginDependencies,
    );
    assert.deepEqual(
      oracle.identity.consumerDependencies,
      current.consumerDependencies,
    );
    for (const name of ["core", "icons", "styles", "window"])
      assert.equal(
        path.resolve(current.workspaceLinks[name]),
        path.resolve(current.root, "packages", name),
      );
    writeJson(path.join(evidence, "oracles", `salt-${mode}-${stage}.json`), {
      mode,
      stage,
      sourceOracle: path.relative(repo, original),
      sourceOracleSha256: hash(readFileSync(original)),
      identityAdaptation:
        "Only the owned consumer/project location and artifact location changed; path-neutral semantic hashes are retained exactly. Program selection is verified separately for both artifacts and modes.",
      workloadIdentity: workloadIdentity(current),
      summary: oracle.summary,
      sentinel: oracle.sentinel,
    });
  }
writeJson(path.join(evidence, "identities.json"), identities);
console.log(
  JSON.stringify(
    {
      saltTargets: identities.salt.baseline.targetCount,
      shallowTargets: identities.shallow.baseline.targetCount,
      baseline: identities.salt.baseline.artifact.files["dist/index.mjs"],
      candidate: identities.salt.candidate.artifact.files["dist/index.mjs"],
    },
    null,
    2,
  ),
);
