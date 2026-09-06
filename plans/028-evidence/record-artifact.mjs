import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidence, "../..");
const archive = process.argv[2];
if (!archive || !path.isAbsolute(archive))
  throw new Error("Pass an absolute archive path");
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
const files = (root) => {
  const result = {};
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else
        result[path.relative(root, file).split(path.sep).join("/")] =
          hash(file);
    }
  };
  walk(root);
  return result;
};
const sourceFiles = files(
  path.join(repo, "packages/vite-plugin-react-docgen-typescript/src"),
);
const previous = JSON.parse(
  readFileSync(path.join(repo, "plans/025-evidence/artifact.json"), "utf8"),
);
assert.equal(hash(archive), previous.archiveSha256);
assert.deepEqual(sourceFiles, previous.sourceFiles);
const record = {
  createdAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
  }).trim(),
  archive: path.basename(archive),
  archiveSha256: hash(archive),
  verifierSha256: hash(
    path.join(repo, "scripts/verify-runtime-compatibility.mjs"),
  ),
  matrixSha256: hash(
    path.join(repo, ".github/runtime-compatibility-matrix.json"),
  ),
  lockfileSha256: hash(path.join(repo, "yarn.lock")),
  sourceSha256: createHash("sha256")
    .update(JSON.stringify(sourceFiles))
    .digest("hex"),
  sourceHashMethod:
    "SHA256 of JSON object mapping recursively sorted slash-relative source paths to byte SHA256 digests",
  sourceFiles,
  distFiles: previous.distFiles,
  distIdentitySource:
    "The identical Plan025 archive; each installed row verifies every dist file against Plan025's recorded hashes.",
};
writeFileSync(
  path.join(evidence, "artifact.json"),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    archiveSha256: record.archiveSha256,
    sourceSha256: record.sourceSha256,
  }),
);
