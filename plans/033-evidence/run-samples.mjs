import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidence, "../..");
const raw = path.join(repo, ".yarn/simplification-evidence/033");
const [workload] = process.argv.slice(2);
assert(["salt", "shallow"].includes(workload));
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const fixedFiles = [
  "common.mjs",
  "driver.mjs",
  "identities.json",
  ...["default", "projectService"].flatMap((mode) =>
    ["baseline", "component", "shared"].map(
      (stage) => `oracles/${workload}-${mode}-${stage}.json`,
    ),
  ),
];
const hashes = Object.fromEntries(
  fixedFiles.map((file) => [file, hash(path.join(evidence, file))]),
);
const inputs = JSON.parse(
  readFileSync(path.join(evidence, "identities.json"), "utf8"),
);
const consumerRoot = inputs[workload].baseline.root;
const editFiles =
  workload === "salt"
    ? [
        "packages/core/src/button/Button.tsx",
        "packages/core/src/status-indicator/ValidationStatus.ts",
      ]
    : ["src/components/Button.tsx", "src/shared.ts"];
const originals = new Map(
  editFiles.map((file) => {
    const absolute = path.resolve(consumerRoot, file);
    assert(absolute.startsWith(path.resolve(consumerRoot) + path.sep));
    return [absolute, readFileSync(absolute)];
  }),
);
const rows = [1, 2, 3].flatMap((round) =>
  ["default", "projectService"].flatMap((mode) => {
    const baselineFirst = mode === "default" ? round !== 2 : round === 2;
    return (
      baselineFirst ? ["baseline", "candidate"] : ["candidate", "baseline"]
    ).map((variant) => ({ workload, mode, variant, label: `r${round}` }));
  }),
);
const ledgerPath = path.join(evidence, `${workload}-attempts.json`);
assert(
  !existsSync(ledgerPath),
  "Do not overwrite or silently extend a sampled matrix",
);
const ledger = {
  budget: {
    plannedProcesses: 12,
    rounds: 3,
    timeoutMsPerProcess: 1_200_000,
    noVarianceExtension: true,
  },
  hashes,
  rows,
  startedAt: new Date().toISOString(),
  attempts: [],
};
const save = () =>
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
mkdirSync(path.join(raw, "sample-logs"), { recursive: true });
save();
for (const row of rows) {
  for (const file of fixedFiles)
    assert.equal(
      hash(path.join(evidence, file)),
      hashes[file],
      `Fixed measurement input changed: ${file}`,
    );
  const stem = [workload, row.mode, row.label, row.variant].join("-");
  assert(
    !existsSync(path.join(evidence, "samples", `${stem}.json`)),
    "Existing sample must never be overwritten",
  );
  const attempt = {
    ...row,
    startedAt: new Date().toISOString(),
    log: path.join(raw, "sample-logs", `${stem}.txt`),
  };
  ledger.attempts.push(attempt);
  save();
  console.log(`Starting ${stem}`);
  const log = createWriteStream(attempt.log, { flags: "wx" });
  const child = spawn(
    process.execPath,
    [
      path.join(evidence, "driver.mjs"),
      workload,
      row.variant,
      row.mode,
      row.label,
    ],
    { cwd: repo, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", (chunk) => {
    log.write(chunk);
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    log.write(chunk);
    process.stderr.write(chunk);
  });
  const timeout = setTimeout(() => {
    attempt.timedOut = true;
    child.kill();
  }, ledger.budget.timeoutMsPerProcess);
  const exit = await new Promise((resolve) => {
    child.on("error", (error) =>
      resolve({ code: -1, signal: null, error: error.stack }),
    );
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  await new Promise((resolve) => log.end(resolve));
  const restorationRequired = [];
  for (const [file, original] of originals) {
    if (!readFileSync(file).equals(original)) {
      restorationRequired.push(file);
      // A terminated child cannot run finally; restore only its two owned edit files.
      writeFileSync(file, original);
    }
  }
  Object.assign(attempt, {
    ...exit,
    restorationRequired,
    finishedAt: new Date().toISOString(),
    logSha256: hash(attempt.log),
  });
  save();
  assert.equal(
    restorationRequired.length,
    0,
    "Child did not restore its edits; originals restored and sampling stopped",
  );
  assert.equal(
    exit.code,
    0,
    `Sample failed; stop without replacement: ${stem}`,
  );
}
ledger.finishedAt = new Date().toISOString();
save();
