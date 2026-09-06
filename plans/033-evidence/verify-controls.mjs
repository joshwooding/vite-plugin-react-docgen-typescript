import assert from "node:assert/strict";
import path from "node:path";
import {
  docSummary,
  evidence,
  json,
  verifyIdentity,
  verifyMetadata,
  writeJson,
} from "./common.mjs";

const results = {};
for (const workload of ["salt", "shallow"]) {
  const oracles = Object.fromEntries(
    ["default", "projectService"].map((mode) => [
      mode,
      Object.fromEntries(
        ["baseline", "component", "shared"].map((stage) => [
          stage,
          json(
            path.join(
              evidence,
              "oracles",
              `${[workload, mode, stage].join("-")}.json`,
            ),
          ),
        ]),
      ),
    ]),
  );
  for (const stage of ["baseline", "component", "shared"])
    assert.deepEqual(
      oracles.default[stage].summary,
      oracles.projectService[stage].summary,
      `Stable-mode semantic parity: ${workload}/${stage}`,
    );
  const changed = (before, after) =>
    Object.keys(before.files).filter(
      (file) => before.files[file].sha256 !== after.files[file].sha256,
    );
  const component = changed(
    oracles.default.baseline.summary,
    oracles.default.component.summary,
  );
  const shared = changed(
    oracles.default.component.summary,
    oracles.default.shared.summary,
  );
  assert.equal(component.length, workload === "salt" ? 7 : 1);
  assert.equal(shared.length, workload === "salt" ? 33 : 3);
  results[workload] = {
    componentChanged: component,
    sharedChanged: shared,
    stageHashes: Object.fromEntries(
      ["baseline", "component", "shared"].map((stage) => [
        stage,
        oracles.default[stage].summary.sha256,
      ]),
    ),
  };
  if (workload === "shallow") {
    for (const mode of ["default", "projectService"]) {
      for (const stage of ["baseline", "component", "shared"])
        verifyMetadata(
          oracles[mode][stage].documents,
          oracles[mode][stage],
          stage,
        );
      assert.throws(
        () =>
          verifyMetadata(
            oracles[mode].baseline.documents,
            oracles[mode].component,
            "stale-component",
          ),
        /Stale or divergent/,
      );
      assert.throws(
        () =>
          verifyMetadata(
            oracles[mode].component.documents,
            oracles[mode].shared,
            "stale-shared",
          ),
        /Stale or divergent/,
      );
      const original = oracles[mode].baseline.workloadIdentity;
      assert.throws(
        () =>
          verifyIdentity(
            { ...original, targetCount: original.targetCount + 1 },
            original,
          ),
        /identity mismatch/,
      );
      assert.equal(
        docSummary(oracles[mode].baseline.documents).componentCount,
        3,
      );
    }
  }
}
writeJson(path.join(evidence, "controls.json"), {
  ...results,
  negativeControls: {
    staleComponent: true,
    staleShared: true,
    workloadIdentity: true,
  },
  note: "Negative controls exercise the same verifyMetadata/verifyIdentity helpers imported by the measured driver; Salt retains all215-file original027 semantic hashes.",
});
console.log(
  JSON.stringify({
    salt: [
      results.salt.componentChanged.length,
      results.salt.sharedChanged.length,
    ],
    shallow: [
      results.shallow.componentChanged.length,
      results.shallow.sharedChanged.length,
    ],
    negativeControls: "passed",
  }),
);
