import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import {
  salt,
  dist,
  raw,
  evidence,
  targets,
  relative,
  writeJson,
  json,
  hash,
  identity,
  applyEdit,
  edits,
  options,
  context,
  metadata,
  docSummary,
  sentinel,
  slash,
  verifyIdentity,
  verifyMetadata,
  requirePlugin,
} from "./common.mjs";

const [mode, label, profilePhase] = process.argv.slice(2);
assert(["default", "projectService"].includes(mode));
assert(/^[a-z0-9-]+$/.test(label));
assert(!profilePhase || ["cold", "shared", "both"].includes(profilePhase));
const before = identity();
const harnessSha256 = hash(
  ["common.mjs", "driver.mjs"]
    .map((file) => file + ":" + hash(readFileSync(path.join(evidence, file))))
    .join("\n"),
);
const oracles = Object.fromEntries(
  ["baseline", "component", "shared"].map((stage) => [
    stage,
    json(path.join(evidence, "oracles", mode + "-" + stage + ".json")),
  ]),
);
for (const oracle of Object.values(oracles))
  verifyIdentity(oracle.identity, before);
const originalSources = new Map(
  targets.map((file) => [file, readFileSync(file, "utf8")]),
);
const restores = [];
let plugin;
let profiler;
let profileBoundary;
const profiles = {};
let result;
const documents = {};
const metrics = {};
const startIso = new Date().toISOString();
const canonical = (file) => slash(path.resolve(file));
const targetById = new Map(targets.map((file) => [canonical(file), file]));
async function beginProfile(phase) {
  if (
    profilePhase !== phase &&
    !(profilePhase === "both" && ["cold", "shared"].includes(phase))
  )
    return;
  console.log(`Starting ${mode} ${phase} CPU profile`);
  const { Session } = await import("node:inspector/promises");
  profiler = new Session();
  profiler.connect();
  await profiler.post("Profiler.enable");
  profileBoundary = {
    phase,
    startedAt: new Date().toISOString(),
    startPerformanceMs: performance.now(),
  };
  await profiler.post("Profiler.start");
}
async function endProfile(phase) {
  if (
    profilePhase !== phase &&
    !(profilePhase === "both" && ["cold", "shared"].includes(phase))
  )
    return;
  const stopped = await profiler.post("Profiler.stop");
  profileBoundary.endPerformanceMs = performance.now();
  profileBoundary.finishedAt = new Date().toISOString();
  profiler.disconnect();
  profiler = null;
  const file = path.join(raw, "profiles", mode + "-" + phase + ".cpuprofile");
  writeJson(file, stopped.profile);
  profiles[phase] = {
    ...profileBoundary,
    path: file,
    sha256: hash(readFileSync(file)),
    samples: stopped.profile.samples.length,
  };
  console.log(`Saved ${mode} ${phase} CPU profile`);
}
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
function updateDocuments(outputs) {
  for (const [file, output] of outputs)
    documents[relative(file)] = metadata(output);
}
function verify(stage) {
  verifyMetadata(documents, oracles[stage], stage);
}
async function hmr(name) {
  if (profilePhase) console.log(`Starting ${mode} ${name} HMR verification`);
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
  await beginProfile(name);
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
  assert(files.length > 0, "No target files affected by " + name);
  const transformStart = performance.now();
  const outputs = await transform(files);
  const transformMs = performance.now() - transformStart;
  const totalCycleMs = performance.now() - start;
  await endProfile(name);
  updateDocuments(outputs);
  verify(name);
  return {
    hookMs,
    transformMs,
    totalCycleMs,
    affectedTargetCount: files.length,
    invalidatedTargetCount: invalidated.size,
    files: files.map(relative),
    sentinel: sentinel(documents),
    metadataSha256: docSummary(documents).sha256,
  };
}
try {
  process.chdir(salt);
  // Importing the plugin is outside the phase; no plugin instance, hooks, or compiler preflight precede cold initialization.
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
    "Compiler/parser already loaded before cold phase",
  );
  await beginProfile("cold");
  const sessionStart = performance.now();
  const coldStart = performance.now();
  plugin = createPlugin(options(mode));
  const configStart = performance.now();
  await plugin.configResolved?.({ command: "serve", root: salt });
  metrics.configResolvedMs = performance.now() - configStart;
  const firstStart = performance.now();
  const firstOutputs = await transform(targets, originalSources);
  metrics.firstBatchMs = performance.now() - firstStart;
  metrics.coldBatchMs = performance.now() - coldStart;
  await endProfile("cold");
  updateDocuments(firstOutputs);
  verify("baseline");
  const warmStart = performance.now();
  const warmOutputs = await transform(targets, originalSources);
  metrics.warmBatchMs = performance.now() - warmStart;
  updateDocuments(warmOutputs);
  verify("baseline");
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
    mode,
    label,
    profilePhase: profilePhase ?? null,
    startIso,
    finishIso: new Date().toISOString(),
    identity: before,
    harnessSha256,
    metrics,
    componentHmr,
    sharedHmr,
  };
} finally {
  try {
    await plugin?.closeBundle?.();
  } finally {
    profiler?.disconnect();
    try {
      for (const restore of restores.reverse()) restore();
    } finally {
      verifyIdentity(identity(), before);
    }
  }
}
if (profilePhase) result.profiles = profiles;
writeJson(
  path.join(
    evidence,
    profilePhase
      ? "profiles"
      : label.startsWith("probe")
        ? "probes"
        : "samples",
    mode + "-" + label + ".json",
  ),
  result,
);
console.log(
  JSON.stringify({
    mode,
    label,
    profilePhase,
    metrics,
    componentHmrCount: result.componentHmr.affectedTargetCount,
    sharedHmrCount: result.sharedHmr.affectedTargetCount,
  }),
);
