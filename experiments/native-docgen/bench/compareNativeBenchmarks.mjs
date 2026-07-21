import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REQUIRED_BACKENDS = [
  "legacy-default",
  "typescript6-control-registry",
  "typescript6-control-no-registry",
  "native-stable",
];
const REQUIRED_SCENARIOS = [
  "playground",
  "large-project",
  "large-design-system",
  "monorepo-shared-graph",
  "multi-dependent-imported-edit",
];
const REQUIRED_METRICS = [
  "initialization",
  "firstComponent",
  "coldBatch",
  "warmBatch",
  "importedEdit",
  "teardown",
];
const EXPECTED_IDENTITIES = {
  "legacy-default": {
    apiVersion: "docgen-backend-v1/react-docgen-typescript@2.2.2",
    compilerVersion: "typescript@6.0.3",
  },
  "typescript6-control-registry": {
    apiVersion: "typescript6-language-service/direct-extractor-v1/registry-on",
    compilerVersion: "typescript@6.0.3",
  },
  "typescript6-control-no-registry": {
    apiVersion: "typescript6-language-service/direct-extractor-v1/registry-off",
    compilerVersion: "typescript@6.0.3",
  },
  "native-stable": {
    apiVersion: "typescript7/unstable/async+fs+ast/high-level-v1",
    compilerVersion: "typescript@7.0.2",
  },
};

const parseArguments = () => {
  const inputs = [];
  let maxRegression;
  let minDurationMs;
  let minImprovement;
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument sequence near ${key ?? "<end>"}`);
    }
    if (key === "--input") inputs.push(path.resolve(value));
    else if (key === "--max-regression") maxRegression = Number(value);
    else if (key === "--min-improvement") minImprovement = Number(value);
    else if (key === "--min-duration-ms") minDurationMs = Number(value);
    else throw new Error(`Unknown argument ${key}`);
  }
  if (inputs.length === 0) throw new Error("At least one --input is required");
  for (const [name, value] of Object.entries({
    maxRegression,
    minDurationMs,
    minImprovement,
  })) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Invalid --${name}`);
  }
  return { inputs, maxRegression, minDurationMs, minImprovement };
};

const parseJson = (fileName, label) => {
  if (!existsSync(fileName)) throw new Error(`Missing ${label}: ${fileName}`);
  try {
    return JSON.parse(readFileSync(fileName, "utf-8"));
  } catch (error) {
    throw new Error(`Invalid ${label} JSON ${fileName}: ${error}`);
  }
};

const median = (values) => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
};

const medianAbsoluteDeviation = (values) => {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
};

const percentageDelta = (baseline, candidate) =>
  baseline === 0
    ? candidate === 0
      ? 0
      : Number.POSITIVE_INFINITY
    : ((candidate - baseline) / baseline) * 100;

const validateResultRow = (row, minDurationMs) => {
  const identity = EXPECTED_IDENTITIES[row.backend];
  if (
    !REQUIRED_SCENARIOS.includes(row.scenario) ||
    !REQUIRED_BACKENDS.includes(row.backend) ||
    typeof row.fixtureHash !== "string" ||
    row.fixtureHash.length !== 64 ||
    row.compilerVersion !== identity?.compilerVersion ||
    row.apiVersion !== identity?.apiVersion
  ) {
    throw new Error(`Malformed result identity: ${JSON.stringify(row)}`);
  }
  if (
    row.controls?.cleanTeardown !== true ||
    row.controls?.freshTwoEditMetadata !== true ||
    row.controls?.unrelatedSelective !== true ||
    row.controls?.unrelatedInvalidations !== 0 ||
    row.invalidationCounts?.unrelated !== 0
  ) {
    throw new Error(
      `Correctness/selectivity control failed for ${row.scenario}/${row.backend}`,
    );
  }
  const requestCounts = row.requestCounts;
  for (const name of ["analyze", "dispose", "initialize", "update"]) {
    if (!Number.isInteger(requestCounts?.[name]) || requestCounts[name] < 0) {
      throw new Error(
        `Invalid ${name} request count for ${row.scenario}/${row.backend}`,
      );
    }
  }
  if (
    row.backend === "legacy-default"
      ? requestCounts?.checker !== null
      : !Number.isInteger(requestCounts?.checker) || requestCounts.checker < 0
  ) {
    throw new Error(
      `Invalid checker request count for ${row.scenario}/${row.backend}`,
    );
  }
  if (
    !Number.isFinite(row.memory?.processTreeRssBytes) ||
    row.memory.processTreeRssBytes <= 0 ||
    !Number.isFinite(row.memory?.mainProcessRssBytes) ||
    !Number.isFinite(row.memory?.helperProcessRssBytes)
  ) {
    throw new Error(
      `Invalid memory evidence for ${row.scenario}/${row.backend}`,
    );
  }
  if (
    !Number.isInteger(row.sourceRepresentations) ||
    row.sourceRepresentations < 1
  ) {
    throw new Error(
      `Invalid source-representation count for ${row.scenario}/${row.backend}`,
    );
  }
  for (const metric of REQUIRED_METRICS) {
    const value = row.metrics?.[metric];
    if (
      !value ||
      !Number.isInteger(value.repetitions) ||
      value.repetitions < 1 ||
      !Number.isInteger(value.operations) ||
      value.operations < value.repetitions ||
      !Number.isFinite(value.totalMeasuredMs) ||
      (metric !== "teardown" &&
        value.totalMeasuredMs < Math.max(250, minDurationMs)) ||
      !Number.isFinite(value.perOperationMs) ||
      value.perOperationMs <= 0 ||
      Math.abs(
        value.perOperationMs - value.totalMeasuredMs / value.operations,
      ) > 1e-6
    ) {
      throw new Error(
        `Invalid ${metric} timing for ${row.scenario}/${row.backend}`,
      );
    }
  }
};

const validateVitestResult = (result, fileName) => {
  const files = Array.isArray(result?.files) ? result.files : [result?.files];
  const benchmarks = files.flatMap((file) =>
    (file?.groups ?? []).flatMap((group) => group?.benchmarks ?? []),
  );
  if (
    files.length !== 1 ||
    benchmarks.length !== 1 ||
    benchmarks[0]?.name !== "capture paired native-backend evidence" ||
    benchmarks[0]?.sampleCount !== 1
  ) {
    throw new Error(`Malformed Vitest benchmark result ${fileName}`);
  }
};

const loadEvidence = (inputs, minDurationMs) => {
  const samples = [];
  let environmentIdentity;
  const fixtureHashes = new Map();
  const globalIndices = new Set();
  for (const input of inputs) {
    const manifestFile = path.join(input, "run-manifest.json");
    const manifest = parseJson(manifestFile, "run manifest");
    if (
      manifest.schemaVersion !== "native-bench-run-v1" ||
      !Array.isArray(manifest.records) ||
      manifest.records.length !== manifest.samples
    ) {
      throw new Error(`Malformed or incomplete manifest ${manifestFile}`);
    }
    const expectedIndices = Array.from(
      { length: manifest.samples },
      (_, offset) => manifest.startIndex + offset,
    );
    if (
      manifest.records.some(
        (record, index) => record.sample !== expectedIndices[index],
      )
    ) {
      throw new Error(
        `Manifest sample sequence is incomplete in ${manifestFile}`,
      );
    }
    for (const record of manifest.records) {
      if (globalIndices.has(record.sample)) {
        throw new Error(`Overlapping global sample index ${record.sample}`);
      }
      globalIndices.add(record.sample);
      const vitestResult = parseJson(record.vitestResult, "Vitest result");
      validateVitestResult(vitestResult, record.vitestResult);
      const custom = parseJson(record.customResult, "custom result");
      if (
        custom.schemaVersion !== "native-bench-v1" ||
        custom.runId !== manifest.runId ||
        custom.sample !== record.sample ||
        custom.order !== record.order ||
        !Array.isArray(custom.results)
      ) {
        throw new Error(
          `Cross-file metadata mismatch for sample ${record.sample}`,
        );
      }
      const environment = custom.environment;
      if (
        typeof environment?.architecture !== "string" ||
        typeof environment?.node !== "string" ||
        typeof environment?.os !== "string"
      ) {
        throw new Error(
          `Missing environment identity for sample ${record.sample}`,
        );
      }
      const currentEnvironment = JSON.stringify(environment);
      environmentIdentity ??= currentEnvironment;
      if (currentEnvironment !== environmentIdentity) {
        throw new Error(`Environment changed at sample ${record.sample}`);
      }
      const keys = new Set();
      for (const row of custom.results) {
        validateResultRow(row, minDurationMs);
        const knownHash = fixtureHashes.get(row.scenario);
        if (knownHash && knownHash !== row.fixtureHash) {
          throw new Error(`Fixture hash changed for ${row.scenario}`);
        }
        fixtureHashes.set(row.scenario, row.fixtureHash);
        const key = `${row.scenario}:${row.backend}`;
        if (keys.has(key))
          throw new Error(`Duplicate pair ${key} in sample ${record.sample}`);
        keys.add(key);
      }
      const expectedKeys = REQUIRED_SCENARIOS.flatMap((scenario) =>
        REQUIRED_BACKENDS.map((backend) => `${scenario}:${backend}`),
      );
      if (
        keys.size !== expectedKeys.length ||
        expectedKeys.some((key) => !keys.has(key))
      ) {
        throw new Error(
          `Incomplete backend/scenario pairs in sample ${record.sample}`,
        );
      }
      samples.push(custom);
    }
  }
  if (samples.length < 7)
    throw new Error("At least seven independent paired samples are required");
  return samples;
};

const summarize = (samples) => {
  const summary = {};
  for (const scenario of REQUIRED_SCENARIOS) {
    summary[scenario] = {};
    for (const backend of REQUIRED_BACKENDS) {
      summary[scenario][backend] = {};
      for (const metric of REQUIRED_METRICS) {
        const values = samples.map((sample) => {
          const row = sample.results.find(
            (candidate) =>
              candidate.scenario === scenario && candidate.backend === backend,
          );
          return row.metrics[metric].perOperationMs;
        });
        const center = median(values);
        const mad = medianAbsoluteDeviation(values);
        summary[scenario][backend][metric] = {
          mad,
          madPercent: center === 0 ? 0 : (mad / center) * 100,
          median: center,
          samples: values.length,
        };
      }
    }
  }
  return summary;
};

const evaluate = ({ maxRegression, minImprovement, summary }) => {
  const largeScenarios = ["large-project", "large-design-system"];
  const regressions = [];
  for (const scenario of largeScenarios) {
    for (const metric of REQUIRED_METRICS) {
      const baseline = summary[scenario]["legacy-default"][metric].median;
      const candidate = summary[scenario]["native-stable"][metric].median;
      const delta = percentageDelta(baseline, candidate);
      if (delta > maxRegression) regressions.push({ delta, metric, scenario });
    }
  }
  const eligibleMetrics = ["coldBatch", "importedEdit"];
  const winningMetric = eligibleMetrics.find((metric) =>
    largeScenarios.every((scenario) => {
      const baseline = summary[scenario]["legacy-default"][metric].median;
      const candidate = summary[scenario]["native-stable"][metric].median;
      return percentageDelta(baseline, candidate) <= -minImprovement;
    }),
  );
  return { regressions, winningMetric: winningMetric ?? null };
};

const deltaLedger = (summary) => {
  const ledger = [];
  for (const scenario of REQUIRED_SCENARIOS) {
    for (const metric of REQUIRED_METRICS) {
      const legacy = summary[scenario]["legacy-default"][metric].median;
      const control =
        summary[scenario]["typescript6-control-registry"][metric].median;
      const native = summary[scenario]["native-stable"][metric].median;
      ledger.push({
        controlToNativePercent: percentageDelta(control, native),
        legacyToControlPercent: percentageDelta(legacy, control),
        metric,
        scenario,
      });
    }
  }
  return ledger;
};

try {
  const options = parseArguments();
  const samples = loadEvidence(options.inputs, options.minDurationMs);
  const summary = summarize(samples);
  const decision = evaluate({ ...options, summary });
  const highVariance = [];
  for (const scenario of REQUIRED_SCENARIOS) {
    for (const backend of REQUIRED_BACKENDS) {
      for (const metric of REQUIRED_METRICS) {
        const value = summary[scenario][backend][metric];
        if (value.madPercent > 20)
          highVariance.push({ backend, metric, scenario, ...value });
      }
    }
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        classification:
          decision.regressions.length === 0 && decision.winningMetric
            ? "thresholds-pass"
            : "valid-threshold-failure",
        decision,
        deltas: deltaLedger(summary),
        highVariance,
        inputs: options.inputs,
        sampleCount: samples.length,
        summary,
      },
      undefined,
      2,
    )}\n`,
  );
  process.exitCode =
    decision.regressions.length === 0 && decision.winningMetric ? 0 : 2;
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
}
