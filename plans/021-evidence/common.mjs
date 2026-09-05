import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const evidence = path.join(repo, "plans/021-evidence");
export const raw = path.join(repo, ".yarn/simplification-evidence/021");
export const dist = path.join(repo, "packages/vite-plugin-react-docgen-typescript/dist/index.mjs");
export const require = createRequire(dist);
export const modes = ["default", "projectService"];
export const run = promisify(execFile);
export const json = (file) => JSON.parse(readFileSync(file, "utf8"));
export const writeJson = (file, value) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(value, null, 2) + "\n"); };
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  }).sort();
}
export function removeFixture(directory) {
  const target = path.resolve(directory);
  const relative = path.relative(path.resolve(raw), target);
  if (!relative || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Unsafe cleanup: " + target);
  rmSync(target, { recursive: true, force: true });
}
export async function identity() {
  const sha = (await run("git", ["rev-parse", "HEAD"], { cwd: repo, windowsHide: true })).stdout.trim();
  const source = path.join(repo, "packages/vite-plugin-react-docgen-typescript/src");
  return {
    evaluatedSha: sha,
    lockfileSha256: hash(readFileSync(path.join(repo, "yarn.lock"))),
    sourceSha256: hash(filesUnder(source).map((f) => path.relative(source, f) + ":" + hash(readFileSync(f))).join("\n")),
    buildSha256: hash(readFileSync(dist)),
    benchmarkSha256: hash(readFileSync(path.join(repo, "scripts/benchmark-playground.mjs"))),
    node: process.version,
    os: { platform: os.platform(), release: os.release(), arch: os.arch() },
    versions: Object.fromEntries(["typescript", "typescript6", "vite", "react-docgen-typescript", "react", "@types/react"].map((name) => [name, json(require.resolve(name + "/package.json")).version])),
  };
}
export function options(root, mode, cache) {
  return {
    tsconfigPath: path.join(root, "tsconfig.json"),
    include: ["src/**/*.tsx"], exclude: [],
    docgenMode: mode === "projectService" ? "project-service" : "legacy",
    fileSystemCache: cache ? { directory: path.join(root, ".cache") } : false,
    shouldExtractLiteralValuesFromEnum: true,
  };
}
export function metadata(result) {
  const code = typeof result === "string" ? result : result?.code ?? "";
  const match = code.match(/__docgenInfo\s*=\s*(\{[^\r\n]*\})/);
  if (!match) return null;
  const doc = JSON.parse(match[1]);
  // Paths and declaration locations are not the semantic contract under test.
  return {
    displayName: doc.displayName, description: doc.description,
    props: Object.fromEntries(Object.entries(doc.props).sort(([a], [b]) => a.localeCompare(b)).map(([name, prop]) => [name, {
      name: prop.name, description: prop.description, required: prop.required,
      type: prop.type, defaultValue: prop.defaultValue,
    }])),
  };
}
export const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export async function child(script, manifest, label) {
  const input = path.join(raw, label + ".input.json");
  const output = path.join(raw, label + ".output.json");
  writeJson(input, { ...manifest, output });
  await run(process.execPath, [script, "--child", input], { cwd: repo, windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000 });
  return json(output);
}
export function config() {
  return { compilerOptions: { target: "ES2020", module: "ESNext", moduleResolution: "Bundler", jsx: "preserve", strict: true, skipLibCheck: true, types: [] }, include: ["src/**/*"] };
}
