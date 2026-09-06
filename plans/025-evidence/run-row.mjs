import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidence, "../..");
const [rowArgument, packageArchive] = process.argv.slice(2);
const rowIndex = Number(rowArgument);
const matrix = JSON.parse(
  readFileSync(
    path.join(repo, ".github/runtime-compatibility-matrix.json"),
    "utf8",
  ),
).include;
assert(Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < matrix.length);
assert(path.isAbsolute(packageArchive));
const row = matrix[rowIndex];
assert.equal(process.platform, row.os === "windows-latest" ? "win32" : "linux");
assert(
  row.node === "24"
    ? process.versions.node.startsWith("24.")
    : process.versions.node === row.node,
);
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const expected = JSON.parse(
  readFileSync(path.join(evidence, "artifact.json"), "utf8"),
);
assert.equal(hash(packageArchive), expected.archiveSha256);
const verifier = path.join(repo, "scripts/verify-runtime-compatibility.mjs");
assert.equal(hash(verifier), expected.verifierSha256);
const output = path.join(evidence, "rows");
mkdirSync(output, { recursive: true });
const label = String(rowIndex + 1).padStart(2, "0");
const installedFile = path.join(output, `${label}-installed.json`);
const args = [
  "--import",
  pathToFileURL(path.join(evidence, "observe-install.mjs")).href,
  verifier,
  "--package",
  packageArchive,
  "--typescript",
  row.typescript,
  "--vite",
  row.vite,
  "--modes",
  row.modes.join(","),
];
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, args, {
  cwd: repo,
  encoding: "utf8",
  windowsHide: true,
  timeout: 300_000,
  env: { ...process.env, PLAN025_DEPENDENCY_RECORD: installedFile },
});
writeFileSync(path.join(output, `${label}-stdout.txt`), result.stdout ?? "");
writeFileSync(path.join(output, `${label}-stderr.txt`), result.stderr ?? "");
const record = {
  rowIndex,
  requested: row,
  startedAt,
  completedAt: new Date().toISOString(),
  command: [process.execPath, ...args],
  actual: {
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    osVersion: os.version(),
    linuxRelease:
      process.platform === "linux"
        ? readFileSync("/etc/os-release", "utf8")
        : null,
  },
  archiveSha256: hash(packageArchive),
  verifierSha256: hash(verifier),
  exitCode: result.status,
  error: result.error?.message ?? null,
  status: "FAIL",
};
try {
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1));
  const installed = JSON.parse(readFileSync(installedFile, "utf8"));
  assert.equal(installed.versions.typescript, row.typescript);
  assert.equal(installed.versions.vite, row.vite);
  assert.deepEqual(installed.distFiles, expected.distFiles);
  assert.deepEqual(report.modes, row.modes);
  assert.equal(report.typescript, row.typescript);
  assert.equal(report.vite, row.vite);
  assert.equal(report.result.watcherHandles, 0);
  assert.deepEqual(
    report.result.results,
    row.modes.flatMap((mode) =>
      ["same-project", "project-reference"].map((topology) => ({
        dynamicMembershipEvents: 3,
        edits: 2,
        mode,
        topology,
      })),
    ),
  );
  record.status = "PASS";
  record.report = report;
} catch (error) {
  record.validationError = error.message;
  process.exitCode = 1;
} finally {
  writeFileSync(
    path.join(output, `${label}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  console.log(
    JSON.stringify({
      row: rowIndex + 1,
      status: record.status,
      error: record.validationError ?? record.error,
    }),
  );
}
