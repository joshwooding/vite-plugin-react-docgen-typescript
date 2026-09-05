import path from "node:path";
import { equal, evidence, hash, identity, json, modes, repo, run, writeJson } from "./common.mjs";
import { readFileSync } from "node:fs";

const controls = json(path.join(evidence, "controls.json"));
const restart = json(path.join(evidence, "restart-results.json"));
const watcher = json(path.join(evidence, "watcher-results.json"));
const fixture = json(path.join(evidence, "fixture-results.json"));
function assert(condition, message) { if (!condition) throw new Error(message); }
function matrix(rows, expected, key) {
  const actual = rows.map(key);
  assert(new Set(actual).size === actual.length && equal([...actual].sort(), [...expected].sort()), "Missing, extra or duplicate matrix rows");
}
assert(equal(restart.identity, watcher.identity) && equal(restart.identity, fixture.identity), "Evidence identities differ");
assert(controls.evaluatedSha === restart.identity.evaluatedSha, "Controls SHA mismatch");
// Evidence-only commits may advance HEAD. Verify ancestry and evaluated content, not HEAD equality.
await run("git", ["merge-base", "--is-ancestor", restart.identity.evaluatedSha, "HEAD"], { cwd: repo, windowsHide: true });
await run("git", ["diff", "--quiet", restart.identity.evaluatedSha, "--", "packages/vite-plugin-react-docgen-typescript/src", "scripts/benchmark-playground.mjs", "yarn.lock"], { cwd: repo, windowsHide: true });
const current = await identity();
for (const key of ["sourceSha256", "buildSha256", "lockfileSha256", "benchmarkSha256", "node", "versions"]) assert(equal(current[key], restart.identity[key]), "Current evaluated input differs: " + key);
for (const name of ["prerequisiteDrift", "build", "typecheck", "tests", "fixture", "snapshotStatusArtifact"]) assert(controls[name].status === "PASS", "Control failed: " + name);
assert(controls.tests.passedTests === 309 && controls.tests.passedFiles === 11, "Unexpected test control");
matrix(fixture.rows, modes, (r) => r.mode);
for (const r of fixture.rows) assert(r.status === "PASS" && r.fixtureValidation.compilerDiagnostics === 0 && /[\\/]@types[\\/]react[\\/]index\.d\.ts$/.test(r.fixtureValidation.reactDeclaration), "Invalid React fixture");
const cases = ["unchanged", "imported-type-edit", "config-edit", "existing-ambient-edit", "new-global-declaration", "new-module-augmentation", "unresolved-import-creation", "dependency-deletion-recreation", "same-size-preserved-mtime"];
const expected = modes.flatMap((m) => cases.flatMap((c) => (c === "dependency-deletion-recreation" ? ["deleted", "recreated"] : ["restart"]).map((p) => m + "/" + c + "/" + p)));
matrix(restart.rows, expected, (r) => r.mode + "/" + r.case + "/" + r.checkpoint);
for (const r of restart.rows) {
  assert(r.cacheEntries > 0 && r.seed.cache && r.cached.cache && !r.oracle.cache, "Invalid cache lifecycle");
  assert(new Set([r.seed.pid, r.cached.pid, r.oracle.pid]).size === 3 && r.seed.root === r.cached.root && r.seed.root === r.oracle.root, "Invalid restart process/path isolation");
  const previous = r.checkpoint === "recreated" ? restart.rows.find((p) => p.mode === r.mode && p.case === r.case && p.checkpoint === "deleted").oracle : r.seed;
  assert(r.oracleChanged === !equal(previous.metadata, r.oracle.metadata), "Incorrect oracle-change claim");
  assert(r.oracleChanged === (r.case !== "unchanged"), "Ineffective mutation/control");
  assert(r.status === (equal(r.cached.metadata, r.oracle.metadata) ? "PASS" : "STALE_METADATA"), "Incorrect freshness classification");
  if (r.case === "unchanged") assert(r.cached.persistedHit, "No unchanged persistent hit");
  if (r.case === "same-size-preserved-mtime") assert(equal(r.mutation.before, r.mutation.after), "Size/mtime not exactly preserved");
}
matrix(watcher.rows, modes.flatMap((m) => ["fresh", "persistent-only"].map((s) => m + "/" + s)), (r) => r.mode + "/" + r.startup);
for (const r of watcher.rows) {
  const o = r.observed;
  assert(o.controlEvents.some((e) => e.event === "change") && o.controlHotHooks.length > 0, "Missing watcher positive control");
  assert(o.root === r.oracle.root && o.pid !== r.oracle.pid && !equal(o.initial, r.oracle.metadata), "Invalid watcher oracle/isolation");
  assert(o.windowMs === 5000 && r.oracle.metadata.props.label.type.name === "number", "Invalid watcher observation");
  if (r.startup === "persistent-only") assert(r.cacheEntries > 0 && r.seed.pid !== o.pid && r.seed.pid !== r.oracle.pid && r.seed.root === o.root && o.persistedHit && !o.loadedAfterInitial, "Warm startup was not cache-only");
  assert(r.status === (equal(o.after, r.oracle.metadata) ? "PASS" : "STALE_METADATA"), "Incorrect watcher classification");
}
const failures = [
  ...restart.rows.filter((r) => r.status === "STALE_METADATA").map((r) => ({ source: "restart-results.json", mode: r.mode, case: r.case, checkpoint: r.checkpoint })),
  ...watcher.rows.filter((r) => r.status === "STALE_METADATA").map((r) => ({ source: "watcher-results.json", mode: r.mode, startup: r.startup })),
];
assert(failures.length > 0, "Gap-route summary requires reproducible correctness failures; timing cannot silently be skipped");
assert(restart.verdict === "CORRECTNESS_GAP" && watcher.verdict === "CORRECTNESS_GAP", "Report verdict mismatch");
const summary = {
  schemaVersion: 1, verdict: "CORRECTNESS_GAP", identity: restart.identity,
  rule: "Any stale metadata takes precedence over all performance criteria.",
  evidenceSha256: Object.fromEntries(["controls.json", "fixture-results.json", "restart-results.json", "watcher-results.json"].map((f) => [f, hash(readFileSync(path.join(evidence, f)))])),
  restart: { checkpoints: restart.rows.length, pass: restart.rows.filter((r) => r.status === "PASS").length, stale: restart.rows.filter((r) => r.status === "STALE_METADATA").length },
  watcher: { rows: watcher.rows.length, stale: watcher.rows.filter((r) => r.status === "STALE_METADATA").length, observationWindowMs: 5000 },
  failures,
  timings: ["large-project", "react-typing"].flatMap((scenario) => modes.flatMap((mode) => ["off", "populate", "restart"].map((cache) => ({
    scenario, mode, cache, status: "SKIPPED_CORRECTNESS_GAP", sampleCount: 0,
    coldBatchMedianMs: null, coldBatchMadMs: null, warmBatchMedianMs: null,
    affectedHmrMedianMs: null, sessionMedianMs: null, populationOverheadMs: null,
    restartSavingMs: null, breakEvenRestarts: null, cacheBytes: null, cacheFileCount: null, retainedMemoryBytes: null,
    reason: "Correctness prerequisite failed; see failures and linked source reports.",
  })))),
  performanceConclusion: "No speed, population overhead, break-even, storage or retained-memory conclusion was measured. No timing runner or hash/read diagnostic was created or invoked.",
};
assert(summary.timings.length === 12, "Incomplete timing skip matrix");
writeJson(path.join(evidence, "summary.json"), summary);
console.log("CORRECTNESS_GAP: " + summary.restart.stale + "/20 stale restart checkpoints; " + summary.watcher.stale + "/4 stale watcher rows; all 12 timing rows explicitly skipped.");
