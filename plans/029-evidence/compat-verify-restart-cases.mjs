import { mkdirSync, mkdtempSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { child, config, dist, equal, evidence, filesUnder, identity, json, metadata, modes, observeExtractions, options, raw, removeFixture, writeJson } from "./compat-common.mjs";

const script = fileURLToPath(import.meta.url);
const cases = ["unchanged", "imported-type-edit", "config-edit", "existing-ambient-edit", "new-global-declaration", "new-module-augmentation", "unresolved-import-creation", "dependency-deletion-recreation", "same-size-preserved-mtime", "existing-unrelated-becomes-global", "existing-unrelated-becomes-augmentation", "configured-type-root-created"];
const component = (type) => "export const Component = (_props: " + type + ") => null;\n";
const imported = "import type { Props } from './types';\n" + component("Props");
const beforeType = "export interface Props { label: string }\n";
const afterType = "export interface Props { label: number }\n";

async function transform(manifest) {
  const extractionCount = observeExtractions();
  const { default: pluginFactory } = await import(pathToFileURL(dist).href);
  const { root, mode, cache } = manifest;
  process.chdir(root);
  const plugin = pluginFactory(options(root, mode, cache));
  const watchFiles = [];
  let result;
  try {
    await plugin.configResolved({ command: "serve", root });
    const file = path.join(root, "src/Component.tsx");
    result = await plugin.transform.call({ addWatchFile(file) { watchFiles.push(file); }, warn(message) { throw new Error(String(message)); } }, readFileSync(file, "utf8"), file);
  } finally { await plugin.closeBundle?.(); }
  // Observe actual metadata extraction calls; watcher registration now happens on fresh paths too.
  return { pid: process.pid, root, cache, metadata: metadata(result), extractions: extractionCount(), persistedHit: extractionCount() === 0, watchFiles };
}

function setup(root, name) {
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeJson(path.join(root, "tsconfig.json"), config());
  writeFileSync(path.join(root, "src/Component.tsx"), imported);
  writeFileSync(path.join(root, "src/types.ts"), beforeType);
  if (name === "same-size-preserved-mtime") {
    const timestamp = new Date("2026-01-01T00:00:00.000Z");
    utimesSync(path.join(root, "src/types.ts"), timestamp, timestamp);
  }
  if (name.includes("ambient") || name === "new-global-declaration") {
    writeFileSync(path.join(root, "src/Component.tsx"), component("GlobalProps"));
    writeFileSync(path.join(root, "src/globals.d.ts"), "interface GlobalProps { label: string }\n");
  }
  if (name === "existing-unrelated-becomes-global" || name === "configured-type-root-created") {
    writeFileSync(path.join(root, "src/Component.tsx"), component("GlobalProps"));
    writeFileSync(path.join(root, "src/globals.d.ts"), "interface GlobalProps { label: string }\n");
  }
  if (name.startsWith("existing-unrelated-becomes-")) writeFileSync(path.join(root, "src/unrelated.d.ts"), "export {};\n");
  if (name === "configured-type-root-created") {
    const cfg = config();
    cfg.compilerOptions.types = ["extra"];
    cfg.compilerOptions.typeRoots = ["./typing-packages"];
    writeJson(path.join(root, "tsconfig.json"), cfg);
  }
  if (name === "config-edit") {
    const cfg = config();
    cfg.compilerOptions.paths = { "@props": ["./src/types.ts"] };
    writeJson(path.join(root, "tsconfig.json"), cfg);
    writeFileSync(path.join(root, "src/alternate.ts"), afterType);
    writeFileSync(path.join(root, "src/Component.tsx"), imported.replace("./types", "@props"));
  }
  if (name === "unresolved-import-creation") {
    writeFileSync(path.join(root, "src/Component.tsx"), "import type { Missing } from './missing';\n" + component("{ label: string; variant?: Missing }"));
  }
}

function edit(root, name, checkpoint) {
  const file = path.join(root, "src/types.ts");
  if (name === "unchanged") return { operation: "none" };
  if (name === "existing-unrelated-becomes-global") {
    writeFileSync(path.join(root, "src/unrelated.d.ts"), "interface GlobalProps { added: boolean }\n");
    return { operation: "existing included module becomes global" };
  }
  if (name === "existing-unrelated-becomes-augmentation") {
    writeFileSync(path.join(root, "src/unrelated.d.ts"), "import './types';\ndeclare module './types' { interface Props { added: boolean } }\nexport {};\n");
    return { operation: "existing included module gains augmentation" };
  }
  if (name === "configured-type-root-created") {
    mkdirSync(path.join(root, "typing-packages/extra"), { recursive: true });
    writeFileSync(path.join(root, "typing-packages/extra/index.d.ts"), "interface GlobalProps { added: boolean }\n");
    return { operation: "create configured type-root package outside include" };
  }
  if (name === "config-edit") {
    const cfg = json(path.join(root, "tsconfig.json"));
    cfg.compilerOptions.paths["@props"] = ["./src/alternate.ts"];
    writeJson(path.join(root, "tsconfig.json"), cfg);
  } else if (name === "existing-ambient-edit") writeFileSync(path.join(root, "src/globals.d.ts"), "interface GlobalProps { label: number }\n");
  else if (name === "new-global-declaration") writeFileSync(path.join(root, "src/added-global.d.ts"), "interface GlobalProps { added: boolean }\n");
  else if (name === "new-module-augmentation") writeFileSync(path.join(root, "src/added-augmentation.d.ts"), "import './types';\ndeclare module './types' { interface Props { added: boolean } }\nexport {};\n");
  else if (name === "unresolved-import-creation") writeFileSync(path.join(root, "src/missing.ts"), "export type Missing = 'created' | 'available';\n");
  else if (name === "dependency-deletion-recreation" && checkpoint === "deleted") unlinkSync(file);
  else if (name === "same-size-preserved-mtime") {
    const before = statSync(file);
    writeFileSync(file, afterType);
    utimesSync(file, before.atime, before.mtime);
    const after = statSync(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("Failed to preserve size/mtime");
    return { operation: "rewrite", before: { size: before.size, mtimeMs: before.mtimeMs }, after: { size: after.size, mtimeMs: after.mtimeMs } };
  } else writeFileSync(file, afterType);
  return { operation: checkpoint };
}

async function main() {
  mkdirSync(raw, { recursive: true });
  const evaluated = await identity();
  const rows = [];
  for (const mode of modes) for (const name of cases) {
    const root = mkdtempSync(path.join(raw, "restart-" + mode + "-" + name + "-"));
    try {
      setup(root, name);
      const seed = await child(script, { root, mode, cache: true }, mode + "-" + name + "-seed");
      const cacheEntries = filesUnder(path.join(root, ".cache")).length;
      if (!seed.metadata?.props?.label || cacheEntries === 0 || seed.persistedHit) throw new Error("Invalid seed: " + mode + "/" + name);
      const checkpoints = name === "dependency-deletion-recreation" ? ["deleted", "recreated"] : ["restart"];
      let previous = seed;
      for (const checkpoint of checkpoints) {
        const mutation = edit(root, name, checkpoint);
        const cached = await child(script, { root, mode, cache: true }, mode + "-" + name + "-" + checkpoint + "-cached");
        const oracle = await child(script, { root, mode, cache: false }, mode + "-" + name + "-" + checkpoint + "-oracle");
        if (new Set([seed.pid, cached.pid, oracle.pid]).size !== 3 || cached.root !== oracle.root || cached.root !== seed.root) throw new Error("Process/path isolation failed");
        const oracleChanged = !equal(previous.metadata, oracle.metadata);
        if (name !== "unchanged" && !oracleChanged) throw new Error("Ineffective fixture mutation: " + mode + "/" + name + "/" + checkpoint);
        if (name === "unchanged" && (oracleChanged || !cached.persistedHit)) throw new Error("Unchanged control failed");
        const row = { mode, case: name, checkpoint, status: equal(cached.metadata, oracle.metadata) ? "PASS" : "STALE_METADATA", oracleChanged, mutation, cacheEntries, seed, cached, oracle };
        rows.push(row);
        console.log(mode + "/" + name + "/" + checkpoint + ": " + row.status);
        previous = oracle;
      }
    } finally { removeFixture(root); }
  }
  if (!equal(evaluated, await identity())) throw new Error("Evaluated source, build, versions or SHA changed during probes");
  const report = { schemaVersion: 1, identity: evaluated, cases, rows, verdict: rows.some((r) => r.status === "STALE_METADATA") ? "CORRECTNESS_GAP" : "PASS" };
  writeJson(path.join(evidence, "restart-results.json"), report);
  if (report.verdict === "CORRECTNESS_GAP") process.exitCode = 1;
}

if (process.argv[2] === "--child") {
  const manifest = json(process.argv[3]);
  writeJson(manifest.output, await transform(manifest));
} else await main();
