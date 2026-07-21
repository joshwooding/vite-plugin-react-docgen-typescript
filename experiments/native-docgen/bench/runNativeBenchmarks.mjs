import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const experimentRoot = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);
const repositoryRoot = path.resolve(experimentRoot, "../..");

const parseArguments = () => {
  const values = new Map();
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(`Invalid argument sequence near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }
  const runId = values.get("run-id");
  const output = values.get("output");
  const samples = Number(values.get("samples"));
  const startIndex = Number(values.get("start-index"));
  if (!runId || !/^[a-z0-9][a-z0-9-]*$/i.test(runId)) {
    throw new Error("--run-id must be a simple non-empty identifier");
  }
  if (!output || !path.isAbsolute(output)) {
    throw new Error("--output must be an absolute path");
  }
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error("--samples must be a positive integer");
  }
  if (!Number.isInteger(startIndex) || startIndex < 1) {
    throw new Error("--start-index must be a positive integer");
  }
  return { output: path.resolve(output), runId, samples, startIndex };
};

const isInside = (candidate, directory) => {
  const relative = path.relative(directory, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const parseJson = (fileName, label) => {
  try {
    return JSON.parse(readFileSync(fileName, "utf-8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON (${fileName}): ${error}`);
  }
};

const validateCustomResult = ({ fileName, order, runId, sample }) => {
  if (!existsSync(fileName))
    throw new Error(`Missing custom result ${fileName}`);
  const result = parseJson(fileName, "Custom benchmark result");
  if (
    result.schemaVersion !== "native-bench-v1" ||
    result.runId !== runId ||
    result.sample !== sample ||
    result.order !== order ||
    !Array.isArray(result.results) ||
    result.results.length === 0
  ) {
    throw new Error(`Malformed or mismatched custom result ${fileName}`);
  }
};

const main = () => {
  const { output, runId, samples, startIndex } = parseArguments();
  if (isInside(output, repositoryRoot)) {
    throw new Error(
      `Benchmark evidence must be outside the repository: ${output}`,
    );
  }
  const manifestFile = path.join(output, "run-manifest.json");
  if (existsSync(manifestFile)) {
    throw new Error(`Refusing to overlap an existing run: ${manifestFile}`);
  }
  mkdirSync(output, { recursive: true });

  const records = [];
  const vitestCli = path.join(
    repositoryRoot,
    "node_modules",
    "vitest",
    "vitest.mjs",
  );
  if (!existsSync(vitestCli))
    throw new Error(`Missing Vitest CLI ${vitestCli}`);
  const commandPrefix = [
    process.execPath,
    vitestCli,
    "--config",
    "vitest.bench.config.ts",
    "bench",
    "--run",
  ];
  const manifest = {
    childCommand: `${commandPrefix.join(" ")} --outputJson <unique-vitest-json>`,
    config: path.join(experimentRoot, "vitest.bench.config.ts"),
    experimentRoot,
    repositoryRoot,
    runId,
    samples,
    schemaVersion: "native-bench-run-v1",
    startIndex,
    records,
  };
  writeFileSync(manifestFile, JSON.stringify(manifest, undefined, 2));

  for (let offset = 0; offset < samples; offset += 1) {
    const sample = startIndex + offset;
    const order = sample % 2 === 0 ? "native-first" : "legacy-first";
    const customResult = path.join(output, `native-bench-${sample}.json`);
    const vitestResult = path.join(output, `vitest-${sample}.json`);
    if (existsSync(customResult) || existsSync(vitestResult)) {
      throw new Error(`Overlapping global sample index ${sample}`);
    }
    const args = [
      vitestCli,
      "--config",
      "vitest.bench.config.ts",
      "bench",
      "--run",
      "--outputJson",
      vitestResult,
    ];
    const child = spawnSync(process.execPath, args, {
      cwd: experimentRoot,
      encoding: "utf-8",
      env: {
        ...process.env,
        VPRDTS_NATIVE_BENCH_ORDER: order,
        VPRDTS_NATIVE_BENCH_OUTPUT: customResult,
        VPRDTS_NATIVE_BENCH_RUN_ID: runId,
        VPRDTS_NATIVE_BENCH_SAMPLE: String(sample),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (child.status !== 0) {
      throw new Error(
        `Sample ${sample} failed with ${child.status}: ${child.error ?? ""}\n${child.stdout ?? ""}\n${child.stderr ?? ""}`,
      );
    }
    if (!existsSync(vitestResult))
      throw new Error(`Missing Vitest JSON ${vitestResult}`);
    parseJson(vitestResult, "Vitest result");
    validateCustomResult({ fileName: customResult, order, runId, sample });
    records.push({ customResult, order, sample, vitestResult });
    writeFileSync(manifestFile, JSON.stringify(manifest, undefined, 2));
    process.stdout.write(
      `captured sample ${sample}/${startIndex + samples - 1} (${order})\n`,
    );
  }
};

try {
  main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
}
