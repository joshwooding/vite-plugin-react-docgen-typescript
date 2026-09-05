import assert from "node:assert/strict";
import path from "node:path";
import {
  evidence,
  raw,
  json,
  writeJson,
  identity,
  verifyIdentity,
  verifyMetadata,
} from "./common.mjs";
const current = identity();
const oracles = Object.fromEntries(
  ["default", "projectService"].map((mode) => [
    mode,
    Object.fromEntries(
      ["baseline", "component", "shared"].map((stage) => [
        stage,
        json(path.join(evidence, "oracles", mode + "-" + stage + ".json")),
      ]),
    ),
  ]),
);
for (const mode of Object.keys(oracles)) {
  const { baseline, component, shared } = oracles[mode];
  for (const oracle of Object.values(oracles[mode]))
    assert.deepEqual(oracle.identity, current);
  assert(baseline.summary.metadataFileCount > 0);
  assert.equal(
    component.sentinel.buttonDisabled.description,
    baseline.sentinel.buttonDisabled.description +
      " Profile documentation update.",
  );
  for (const key of ["bannerStatus", "dialogStatus", "indicatorStatus"]) {
    assert(
      baseline.sentinel[key].type.value.some((item) => item.value === '"info"'),
    );
    assert(
      !component.sentinel[key].type.value.some(
        (item) => item.value === '"profilePending"',
      ),
    );
    assert(
      shared.sentinel[key].type.value.some(
        (item) => item.value === '"profilePending"',
      ),
    );
  }
  assert.notEqual(baseline.summary.sha256, component.summary.sha256);
  assert.notEqual(component.summary.sha256, shared.summary.sha256);
}
for (const stage of ["baseline", "component", "shared"])
  assert.equal(
    oracles.default[stage].summary.sha256,
    oracles.projectService[stage].summary.sha256,
    "Backend semantic mismatch: " + stage,
  );
const changes = (a, b) =>
  Object.keys(a.summary.files).filter(
    (file) => a.summary.files[file].sha256 !== b.summary.files[file].sha256,
  );
let staleRejected = false;
try {
  verifyMetadata(
    json(path.join(raw, "oracles/default-baseline.metadata.json")),
    oracles.default.shared,
    "negative-stale-control",
  );
} catch {
  staleRejected = true;
}
assert(staleRejected);
let identityRejected = false;
try {
  verifyIdentity({ ...current, saltSourceSha256: "wrong" }, current);
} catch {
  identityRejected = true;
}
assert(identityRejected);
const result = {
  status: "PASS",
  identity: current,
  baseline: {
    metadataFileCount: oracles.default.baseline.summary.metadataFileCount,
    componentCount: oracles.default.baseline.summary.componentCount,
  },
  componentChangedFiles: changes(
    oracles.default.baseline,
    oracles.default.component,
  ),
  sharedChangedFiles: changes(
    oracles.default.component,
    oracles.default.shared,
  ),
  negativeControls: { staleRejected, identityRejected },
  backendSemanticParity: true,
};
writeJson(path.join(evidence, "controls.json"), result);
console.log(JSON.stringify(result, null, 2));
