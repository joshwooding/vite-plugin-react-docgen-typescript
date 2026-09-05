import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = process.cwd();
const main = "D:/OSS/vite-plugin-react-docgen-typescript";
const oldRepo = path.join(
  main,
  ".yarn/.codex-worktrees/plan027/vite-plugin-react-docgen-typescript",
);
const oldRaw = path.join(oldRepo, ".yarn/simplification-evidence/027");
const raw = path.join(repo, ".yarn/simplification-evidence/029");
const salt = path.join(raw, "salt-ds");
const dependencies = path.join(raw, "consumer-dependencies");
const oldDependencies = path.join(oldRaw, "consumer-dependencies");
const shallow = path.join(os.tmpdir(), "rdt029-react");
const link = (target, destination) => {
  if (existsSync(destination)) {
    assert.equal(realpathSync(destination), realpathSync(target));
  } else symlinkSync(target, destination, "junction");
};
mkdirSync(raw, { recursive: true });
if (!existsSync(salt))
  execFileSync(
    "git",
    [
      "-c",
      "core.longpaths=true",
      "clone",
      "--no-hardlinks",
      path.join(oldRaw, "salt-ds"),
      salt,
    ],
    { windowsHide: true, stdio: "inherit" },
  );
assert.equal(
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: salt, windowsHide: true })
    .toString()
    .trim(),
  "2e1da8e4fbc398b2a7dfffbd357feedf222f7e07",
);
mkdirSync(path.join(dependencies, "node_modules/@salt-ds"), {
  recursive: true,
});
for (const file of ["package.json", "package-lock.json"])
  cpSync(path.join(oldDependencies, file), path.join(dependencies, file));
for (const entry of readdirSync(path.join(oldDependencies, "node_modules"), {
  withFileTypes: true,
})) {
  if (entry.name.startsWith(".") || entry.name === "@salt-ds") continue;
  assert(entry.isDirectory());
  link(
    path.join(oldDependencies, "node_modules", entry.name),
    path.join(dependencies, "node_modules", entry.name),
  );
}
for (const name of ["core", "icons", "styles", "window"])
  link(
    path.join(salt, "packages", name),
    path.join(dependencies, "node_modules/@salt-ds", name),
  );
link(path.join(dependencies, "node_modules"), path.join(salt, "node_modules"));
const config = path.join(salt, "packages/core/tsconfig.json");
mkdirSync(path.join(raw, "original-configs"), { recursive: true });
if (!existsSync(path.join(raw, "original-configs/core.tsconfig.json")))
  cpSync(config, path.join(raw, "original-configs/core.tsconfig.json"));
cpSync(path.join(oldRaw, "salt-ds/packages/core/tsconfig.json"), config);
for (const [variant, sourceRepo] of [
  ["baseline", main],
  ["candidate", repo],
]) {
  const artifact = path.join(raw, "artifacts", variant);
  assert(!existsSync(artifact), `Do not overwrite frozen artifact: ${variant}`);
  mkdirSync(artifact, { recursive: true });
  cpSync(
    path.join(sourceRepo, "packages/vite-plugin-react-docgen-typescript/dist"),
    path.join(artifact, "dist"),
    { recursive: true },
  );
  cpSync(
    path.join(
      sourceRepo,
      "packages/vite-plugin-react-docgen-typescript/package.json",
    ),
    path.join(artifact, "package.json"),
  );
}
assert(!existsSync(shallow), "Shallow fixture must be a new owned directory");
cpSync(path.join(repo, "benchmarks/fixtures/react-typing"), shallow, {
  recursive: true,
});
link(path.join(main, "node_modules"), path.join(shallow, "node_modules"));
writeFileSync(
  path.join(raw, "setup.json"),
  `${JSON.stringify(
    {
      repo,
      oldRepo,
      salt,
      dependencies,
      shallow,
      artifactRoots: Object.fromEntries(
        ["baseline", "candidate"].map((variant) => [
          variant,
          path.join(raw, "artifacts", variant),
        ]),
      ),
      copiedNpmLock: path.join(dependencies, "package-lock.json"),
      npmResolutionReuse: oldDependencies,
      note: "New Salt namespace with owned package junctions; only pinned npm packages reuse existing installation. Shallow fixture uses main installed React types.",
    },
    null,
    2,
  )}\n`,
);
console.log(JSON.stringify({ salt, shallow, dependencies }, null, 2));
