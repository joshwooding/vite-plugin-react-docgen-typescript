import {
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const raw = path.join(repo, ".yarn/simplification-evidence/027");
const salt = path.join(raw, "salt-ds");
const deps = path.join(raw, "consumer-dependencies");
const expectedCommit = "2e1da8e4fbc398b2a7dfffbd357feedf222f7e07";
if (
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: salt, windowsHide: true })
    .toString()
    .trim() !== expectedCommit
)
  throw new Error("Salt commit differs from the pinned workload");
const lock = readFileSync(path.join(salt, "yarn.lock"), "utf8");
const names = [
  "@floating-ui/react",
  "@floating-ui/core",
  "@types/react",
  "@types/react-dom",
  "@types/node",
  "@types/use-sync-external-store",
  "react",
  "react-dom",
  "clsx",
  "compute-scroll-into-view",
  "dom-accessibility-api",
  "tabbable",
  "use-sync-external-store",
  "vite",
];
const dependencies = {};
for (const name of names) {
  const blocks = lock
    .split(/\r?\n\r?\n/)
    .filter((block) => block.startsWith('"' + name + "@npm:"));
  const versions = blocks
    .map((block) => block.match(/\r?\n  version: (.+)/)?.[1])
    .filter(Boolean);
  if (!versions.length) throw new Error("Unresolved lock version: " + name);
  // Root/core declare the latest major in the pinned lock for these multiply resolved names.
  dependencies[name] = versions
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .at(-1);
}
mkdirSync(deps, { recursive: true });
writeFileSync(
  path.join(deps, "package.json"),
  JSON.stringify(
    {
      name: "salt-core-docgen-profile-dependencies",
      version: "0.0.0",
      private: true,
      dependencies,
    },
    null,
    2,
  ) + "\n",
);
if (
  existsSync(path.join(deps, "node_modules")) &&
  !existsSync(path.join(salt, "node_modules"))
)
  symlinkSync(
    path.join(deps, "node_modules"),
    path.join(salt, "node_modules"),
    "junction",
  );
if (existsSync(path.join(deps, "node_modules"))) {
  const namespace = path.join(deps, "node_modules/@salt-ds");
  mkdirSync(namespace, { recursive: true });
  for (const name of ["core", "icons", "styles", "window"]) {
    const target = path.join(salt, "packages", name),
      link = path.join(namespace, name);
    if (!existsSync(link)) symlinkSync(target, link, "junction");
    if (realpathSync(link) !== realpathSync(target))
      throw new Error("Workspace link points outside pinned source: " + name);
  }
}
// Core normally consumes built workspace declarations. Analyze the actual source instead,
// preserving its original includes/excludes and base compiler options for both backends.
const original = execFileSync(
  "git",
  ["show", "HEAD:packages/core/tsconfig.json"],
  { cwd: salt, windowsHide: true },
).toString();
mkdirSync(path.join(raw, "original-configs"), { recursive: true });
writeFileSync(path.join(raw, "original-configs/core.tsconfig.json"), original);
const config = JSON.parse(original);
config.compilerOptions = {
  ...config.compilerOptions,
  paths: Object.fromEntries(
    ["core", "icons", "styles", "window"].map((name) => [
      "@salt-ds/" + name,
      [(name === "core" ? "./" : "../" + name + "/") + "src/index.ts"],
    ]),
  ),
};
writeFileSync(
  path.join(salt, "packages/core/tsconfig.json"),
  JSON.stringify(config, null, 2) + "\n",
);
console.log(JSON.stringify({ salt, dependencies, config }, null, 2));
