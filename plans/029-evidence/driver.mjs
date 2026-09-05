import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  applyEdit,
  context,
  dist,
  docSummary,
  edits,
  evidence,
  hash,
  identity,
  json,
  metadata,
  options,
  oraclePath,
  raw,
  relative,
  requirePlugin,
  root,
  slash,
  targets,
  variant,
  verifyIdentity,
  verifyMetadata,
  workload,
  workloadIdentity,
  writeJson,
} from "./common.mjs";

const [, , mode, label] = process.argv.slice(2);
assert(["default", "projectService"].includes(mode));
assert(/^[a-z0-9-]+$/.test(label));
const output = path.join(
  evidence,
  "samples",
  `${[workload, mode, label, variant].join("-")}.json`,
);
const failureOutput = path.join(
  raw,
  "failures",
  `${[workload, mode, label, variant].join("-")}.json`,
);
assert(
  !existsSync(output) && !existsSync(failureOutput),
  "Do not overwrite a completed or failed attempt",
);
const before = identity();
verifyIdentity(
  before,
  json(path.join(evidence, "identities.json"))[workload][variant],
);
const harnessSha256 = hash(
  ["common.mjs", "driver.mjs"]
    .map((file) => `${file}:${hash(readFileSync(path.join(evidence, file)))}`)
    .join("\n"),
);
const oracles = Object.fromEntries(
  ["baseline", "component", "shared"].map((stage) => [
    stage,
    json(oraclePath(mode, stage)),
  ]),
);
for (const oracle of Object.values(oracles))
  verifyIdentity(oracle.workloadIdentity, workloadIdentity(before));
const originalSources = new Map(
  targets.map((file) => [file, readFileSync(file, "utf8")]),
);
const restores = [];
const documents = {};
const metrics = {};
const startIso = new Date().toISOString();
const canonical = (file) => slash(path.resolve(file));
const targetById = new Map(targets.map((file) => [canonical(file), file]));
let plugin;
let result;
async function transform(files, sourceMap) {
  const outputs = new Map();
  for (const file of files)
    outputs.set(
      file,
      await plugin.transform.call(
        context,
        sourceMap?.get(file) ?? readFileSync(file, "utf8"),
        file,
      ),
    );
  return outputs;
}
function verify(outputs, stage) {
  for (const [file, output] of outputs)
    documents[relative(file)] = metadata(output);
  verifyMetadata(documents, oracles[stage], stage);
}
async function hmr(name) {
  restores.push(applyEdit(name));
  const invalidated = new Set();
  const graph = {
    getModulesByFile(file) {
      const target = targetById.get(canonical(file));
      return target
        ? new Set([{ file: target, id: target, url: target }])
        : undefined;
    },
    invalidateModule(module) {
      invalidated.add(canonical(module.file ?? module.id));
    },
  };
  const incoming =
    name === "component"
      ? [
          {
            file: edits[name].file,
            id: edits[name].file,
            url: edits[name].file,
          },
        ]
      : [];
  const start = performance.now();
  const affected = await plugin.handleHotUpdate.call(context, {
    file: edits[name].file,
    modules: incoming,
    server: { moduleGraph: graph },
  });
  const hookMs = performance.now() - start;
  const ids = new Set([
    ...(affected ?? incoming).map((module) =>
      canonical(module.file ?? module.id),
    ),
    ...invalidated,
  ]);
  const files = targets.filter((file) => ids.has(canonical(file)));
  assert(files.length > 0, `No target files affected by ${name}`);
  const transformStart = performance.now();
  const outputs = await transform(files);
  const transformMs = performance.now() - transformStart;
  const totalCycleMs = performance.now() - start;
  verify(outputs, name);
  const expectedAffected =
    workload === "salt" ? 215 : name === "component" ? 2 : 3;
  assert.equal(
    files.length,
    expectedAffected,
    "Affected target selection changed",
  );
  console.log(
    JSON.stringify({
      workload,
      variant,
      mode,
      label,
      completed: name,
      totalCycleMs,
      affected: files.length,
    }),
  );
  return {
    hookMs,
    transformMs,
    totalCycleMs,
    affectedTargetCount: files.length,
    invalidatedTargetCount: invalidated.size,
    files: files.map(relative),
    metadataSha256: docSummary(documents).sha256,
  };
}
try {
  process.chdir(root);
  // Import stays outside cold; no plugin instance, hooks, parser, or compiler preflight precede it.
  const { default: createPlugin } = await import(pathToFileURL(dist));
  const compilerModulesBeforeCold = Object.keys(requirePlugin.cache).filter(
    (file) =>
      /node_modules[\\/](?:typescript|react-docgen-typescript)[\\/].*\.js$/.test(
        file,
      ),
  );
  assert.equal(
    compilerModulesBeforeCold.length,
    0,
    "Compiler/parser loaded before cold phase",
  );
  const sessionStart = performance.now();
  const coldStart = performance.now();
  plugin = createPlugin(options(mode));
  const configStart = performance.now();
  await plugin.configResolved?.({ command: "serve", root });
  metrics.configResolvedMs = performance.now() - configStart;
  const firstStart = performance.now();
  const firstOutputs = await transform(targets, originalSources);
  metrics.firstBatchMs = performance.now() - firstStart;
  metrics.coldBatchMs = performance.now() - coldStart;
  verify(firstOutputs, "baseline");
  console.log(
    JSON.stringify({
      workload,
      variant,
      mode,
      label,
      completed: "cold",
      coldBatchMs: metrics.coldBatchMs,
    }),
  );
  const warmStart = performance.now();
  const warmOutputs = await transform(targets, originalSources);
  metrics.warmBatchMs = performance.now() - warmStart;
  verify(warmOutputs, "baseline");
  const componentHmr = await hmr("component");
  const sharedHmr = await hmr("shared");
  const closeStart = performance.now();
  await plugin.closeBundle?.();
  plugin = null;
  metrics.closeMs = performance.now() - closeStart;
  metrics.harnessElapsedMs = performance.now() - sessionStart;
  metrics.pluginSessionTotalMs =
    metrics.coldBatchMs +
    metrics.warmBatchMs +
    componentHmr.totalCycleMs +
    sharedHmr.totalCycleMs +
    metrics.closeMs;
  result = {
    schemaVersion: 1,
    benchmarkKind: "direct-plugin",
    cache: false,
    processFirstMeasuredInstance: true,
    compilerModulesBeforeCold,
    processId: process.pid,
    workload,
    variant,
    mode,
    label,
    startIso,
    finishIso: new Date().toISOString(),
    identity: before,
    harnessSha256,
    metrics,
    componentHmr,
    sharedHmr,
  };
} catch (error) {
  writeJson(failureOutput, {
    startIso,
    finishIso: new Date().toISOString(),
    identity: before,
    harnessSha256,
    metrics,
    error: error.stack ?? String(error),
  });
  throw error;
} finally {
  try {
    await plugin?.closeBundle?.();
  } finally {
    try {
      for (const restore of restores.reverse()) restore();
    } finally {
      verifyIdentity(identity(), before);
    }
  }
}
writeJson(output, result);
console.log(JSON.stringify({ completed: output, metrics }));
