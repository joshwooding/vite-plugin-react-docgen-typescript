import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidence = path.dirname(fileURLToPath(import.meta.url));
const json = (file) =>
  JSON.parse(readFileSync(path.join(evidence, file), "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const identities = json("identities.json");
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const stats = (values) => {
  const med = median(values);
  const mad = median(values.map((value) => Math.abs(value - med)));
  return {
    samples: values,
    medianMs: med,
    madMs: mad,
    madPercent: med ? (100 * mad) / med : 0,
  };
};
const phases = {
  cold: (s) => s.metrics.coldBatchMs,
  warm: (s) => s.metrics.warmBatchMs,
  component: (s) => s.componentHmr.totalCycleMs,
  shared: (s) => s.sharedHmr.totalCycleMs,
  close: (s) => s.metrics.closeMs,
  session: (s) => s.metrics.pluginSessionTotalMs,
};
const report = {
  rule: "Predeclared3pairs/mode/workload; no extension. Salt useful requires cold/shared >=10% and100ms median reduction with3positive paired deltas. Phase inconclusive if MAD>20% or mixed paired direction. Component/session flags >10% AND100ms, warm >10ms. Shallow cold/HMR/session flags >10% AND20ms.",
  workloads: {},
};
const allAttempts = [];
for (const workload of ["salt", "shallow"]) {
  const ledger = json(`${workload}-attempts.json`);
  assert(ledger.finishedAt);
  assert.equal(ledger.attempts.length, 12);
  assert.equal(ledger.rows.length, 12);
  for (const [file, expectedHash] of Object.entries(ledger.hashes)) {
    assert.equal(
      hash(readFileSync(path.join(evidence, file))),
      expectedHash,
      `Frozen input changed: ${file}`,
    );
  }
  const expectedHarness = hash(
    ["common.mjs", "driver.mjs"]
      .map((file) => `${file}:${ledger.hashes[file]}`)
      .join("\n"),
  );
  const samples = ledger.attempts.map((attempt, index) => {
    assert.deepEqual(
      {
        workload: attempt.workload,
        mode: attempt.mode,
        variant: attempt.variant,
        label: attempt.label,
      },
      ledger.rows[index],
    );
    assert.equal(attempt.code, 0);
    assert(!attempt.timedOut);
    assert.deepEqual(attempt.restorationRequired, []);
    assert.equal(
      hash(readFileSync(attempt.log)),
      attempt.logSha256,
      "Saved attempt log changed",
    );
    assert(
      Number.isFinite(Date.parse(attempt.startedAt)) &&
        Number.isFinite(Date.parse(attempt.finishedAt)),
    );
    assert(Date.parse(attempt.startedAt) <= Date.parse(attempt.finishedAt));
    if (index)
      assert(
        Date.parse(ledger.attempts[index - 1].finishedAt) <=
          Date.parse(attempt.startedAt),
        "Overlapping parent attempts",
      );
    allAttempts.push(attempt);
    const sample = json(
      `samples/${[workload, attempt.mode, attempt.label, attempt.variant].join("-")}.json`,
    );
    for (const key of ["workload", "mode", "variant", "label"])
      assert.equal(sample[key], attempt[key], `Sample row mismatch: ${key}`);
    assert(
      Number.isFinite(Date.parse(sample.startIso)) &&
        Number.isFinite(Date.parse(sample.finishIso)),
    );
    assert(Date.parse(attempt.startedAt) <= Date.parse(sample.startIso));
    assert(Date.parse(sample.startIso) <= Date.parse(sample.finishIso));
    assert(Date.parse(sample.finishIso) <= Date.parse(attempt.finishedAt));
    assert.deepEqual(sample.identity, identities[workload][attempt.variant]);
    assert.equal(sample.harnessSha256, expectedHarness);
    assert.equal(sample.cache, false);
    assert.equal(sample.processFirstMeasuredInstance, true);
    assert.deepEqual(sample.compilerModulesBeforeCold, []);
    for (const phase of Object.values(phases))
      assert(Number.isFinite(phase(sample)) && phase(sample) >= 0);
    const sessionSum =
      phases.cold(sample) +
      phases.warm(sample) +
      phases.component(sample) +
      phases.shared(sample) +
      phases.close(sample);
    assert(Math.abs(sessionSum - phases.session(sample)) < 0.000001);
    for (const stage of ["component", "shared"]) {
      assert.equal(
        sample[`${stage}Hmr`].metadataSha256,
        json(`oracles/${[workload, attempt.mode, stage].join("-")}.json`)
          .summary.sha256,
      );
      assert.equal(
        sample[`${stage}Hmr`].affectedTargetCount,
        workload === "salt" ? 215 : stage === "component" ? 2 : 3,
      );
    }
    return sample;
  });
  report.workloads[workload] = {};
  for (const mode of ["default", "projectService"]) {
    const group = samples.filter((sample) => sample.mode === mode);
    const baseline = group.filter((sample) => sample.variant === "baseline");
    const candidate = group.filter((sample) => sample.variant === "candidate");
    assert.equal(baseline.length, 3);
    assert.equal(candidate.length, 3);
    const phaseResults = Object.fromEntries(
      Object.entries(phases).map(([phase, value]) => {
        const a = stats(baseline.map(value));
        const b = stats(candidate.map(value));
        const pairedDeltasMs = baseline.map(
          (sample) =>
            value(sample) -
            value(candidate.find((other) => other.label === sample.label)),
        );
        const reductionMs = a.medianMs - b.medianMs;
        const reductionPercent = (100 * reductionMs) / a.medianMs;
        const inconclusive =
          a.madPercent > 20 ||
          b.madPercent > 20 ||
          (pairedDeltasMs.some((delta) => delta > 0) &&
            pairedDeltasMs.some((delta) => delta < 0));
        const regressionMs = -reductionMs;
        const regressionPercent = -reductionPercent;
        const regressionFlag =
          workload === "salt"
            ? phase === "warm"
              ? regressionMs > 10
              : ["component", "session"].includes(phase) &&
                regressionMs > 100 &&
                regressionPercent > 10
            : ["cold", "component", "shared", "session"].includes(phase) &&
              regressionMs > 20 &&
              regressionPercent > 10;
        return [
          phase,
          {
            baseline: a,
            candidate: b,
            pairedDeltasMs,
            reductionMs,
            reductionPercent,
            inconclusive,
            regressionFlag,
            usefulSaltPhase:
              workload === "salt" &&
              ["cold", "shared"].includes(phase) &&
              !inconclusive &&
              reductionMs >= 100 &&
              reductionPercent >= 10 &&
              pairedDeltasMs.every((delta) => delta > 0),
          },
        ];
      }),
    );
    report.workloads[workload][mode] = {
      phases: phaseResults,
      usefulSaltBenefit:
        workload === "salt" &&
        phaseResults.cold.usefulSaltPhase &&
        phaseResults.shared.usefulSaltPhase &&
        !Object.values(phaseResults).some((phase) => phase.regressionFlag),
      regressionFlags: Object.entries(phaseResults)
        .filter(([, result]) => result.regressionFlag)
        .map(([name]) => name),
    };
  }
}
allAttempts.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
for (let index = 1; index < allAttempts.length; index++)
  assert(
    Date.parse(allAttempts[index - 1].finishedAt) <=
      Date.parse(allAttempts[index].startedAt),
    "Workloads overlapped",
  );
writeFileSync(
  path.join(evidence, "comparison.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
