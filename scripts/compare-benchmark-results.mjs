import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const median = (values) => {
  if (values.length === 0) throw new Error("Cannot calculate an empty median");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

export const medianAbsoluteDeviation = (values) => {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
};

const hasValidPairedSampleCount = (baselineValues, candidateValues) =>
  baselineValues.length === candidateValues.length &&
  (baselineValues.length === 5 || baselineValues.length === 10);

const parseArguments = (arguments_) => {
  const parsed = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) continue;
    const next = arguments_[index + 1];
    parsed.set(argument, next?.startsWith("--") ? true : (next ?? true));
    if (next && !next.startsWith("--")) index += 1;
  }
  return parsed;
};

const collectSamples = (directory) => {
  const samples = new Map();
  for (const fileName of readdirSync(directory).filter((name) =>
    name.endsWith(".json"),
  )) {
    const report = JSON.parse(
      readFileSync(path.join(directory, fileName), "utf-8"),
    );
    const scenario = report.scenario?.name;
    if (
      !scenario ||
      report.iterations !== 1 ||
      !Array.isArray(report.results)
    ) {
      throw new Error(`Invalid benchmark report: ${fileName}`);
    }
    for (const result of report.results) {
      const prefix = `${scenario}/${result.mode}`;
      const entries = [
        ["cold", result.metrics?.coldBatchMs],
        ["warm", result.metrics?.warmBatchMs],
        ["component-hmr", result.metrics?.componentHmr?.totalCycleMs],
      ];
      for (const [metric, value] of entries) {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new Error(`Missing ${prefix}/${metric} in ${fileName}`);
        }
        const key = `${prefix}/${metric}`;
        const values = samples.get(key) ?? [];
        values.push(value);
        samples.set(key, values);
      }
      samples.set(
        `${prefix}/status`,
        (samples.get(`${prefix}/status`) ?? []).concat(
          result.metrics?.componentHmr?.status ?? "missing",
        ),
      );
    }
  }
  return samples;
};

export const compareSamples = (baseline, candidate, maximumRegression) => {
  const failures = [];
  const rows = [];
  const keys = [...new Set([...baseline.keys(), ...candidate.keys()])].sort();
  for (const key of keys) {
    const baselineValues = baseline.get(key);
    const candidateValues = candidate.get(key);
    if (!baselineValues || !candidateValues) {
      failures.push(`${key}: missing baseline or candidate samples`);
      continue;
    }
    if (key.endsWith("/status")) {
      if (
        !hasValidPairedSampleCount(baselineValues, candidateValues) ||
        new Set(baselineValues).size !== 1 ||
        new Set(candidateValues).size !== 1 ||
        baselineValues[0] !== candidateValues[0]
      ) {
        failures.push(`${key}: status/sample mismatch`);
      }
      continue;
    }
    if (!hasValidPairedSampleCount(baselineValues, candidateValues)) {
      failures.push(
        `${key}: expected 5 or 10 paired independent samples, received ${baselineValues.length}/${candidateValues.length}`,
      );
      continue;
    }
    const baselineMedian = median(baselineValues);
    const candidateMedian = median(candidateValues);
    const delta = ((candidateMedian - baselineMedian) / baselineMedian) * 100;
    const baselineMad = medianAbsoluteDeviation(baselineValues);
    const candidateMad = medianAbsoluteDeviation(candidateValues);
    rows.push({
      baselineMad,
      baselineMedian,
      candidateMad,
      candidateMedian,
      delta,
      key,
    });
    if (delta > maximumRegression) {
      failures.push(
        `${key}: ${delta.toFixed(2)}% regression exceeds ${maximumRegression}%`,
      );
    }
    if (
      baselineMad > baselineMedian * 0.2 ||
      candidateMad > candidateMedian * 0.2
    ) {
      failures.push(
        `${key}: MAD exceeds 20% of its median; collect five more pairs`,
      );
    }
  }
  return { failures, rows };
};

const runSelfTest = () => {
  if (median([5, 1, 3]) !== 3 || median([1, 2, 3, 4]) !== 2.5) {
    throw new Error("median self-test failed");
  }
  if (medianAbsoluteDeviation([1, 2, 3, 4, 100]) !== 1) {
    throw new Error("MAD self-test failed");
  }
  const baseline = new Map([
    ["scenario/default/cold", [100, 100, 100, 100, 100]],
  ]);
  const passing = compareSamples(
    baseline,
    new Map([["scenario/default/cold", [110, 110, 110, 110, 110]]]),
    15,
  );
  const failing = compareSamples(
    baseline,
    new Map([["scenario/default/cold", [120, 120, 120, 120, 120]]]),
    15,
  );
  if (passing.failures.length !== 0 || failing.failures.length !== 1) {
    throw new Error("comparison self-test failed");
  }
  const extended = compareSamples(
    new Map([["scenario/default/cold", Array(10).fill(100)]]),
    new Map([["scenario/default/cold", Array(10).fill(110)]]),
    15,
  );
  const invalidCount = compareSamples(
    new Map([["scenario/default/cold", Array(6).fill(100)]]),
    new Map([["scenario/default/cold", Array(6).fill(110)]]),
    15,
  );
  if (extended.failures.length !== 0 || invalidCount.failures.length !== 1) {
    throw new Error("extended sample-count self-test failed");
  }
  console.log("benchmark comparator self-test passed");
};

const main = () => {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.has("--self-test")) return runSelfTest();
  const baselineDirectory = arguments_.get("--baseline-dir");
  const candidateDirectory = arguments_.get("--candidate-dir");
  const maximumRegression = Number(arguments_.get("--max-regression"));
  if (
    typeof baselineDirectory !== "string" ||
    typeof candidateDirectory !== "string" ||
    !Number.isFinite(maximumRegression)
  ) {
    throw new Error(
      "Usage: --baseline-dir <path> --candidate-dir <path> --max-regression <percent>",
    );
  }
  const comparison = compareSamples(
    collectSamples(baselineDirectory),
    collectSamples(candidateDirectory),
    maximumRegression,
  );
  for (const row of comparison.rows) {
    console.log(
      `${row.key}: ${row.baselineMedian.toFixed(2)}ms -> ${row.candidateMedian.toFixed(2)}ms (${row.delta.toFixed(2)}%), MAD ${row.baselineMad.toFixed(2)}/${row.candidateMad.toFixed(2)}`,
    );
  }
  for (const failure of comparison.failures) console.error(failure);
  if (comparison.failures.length > 0) process.exitCode = 1;
};

main();
