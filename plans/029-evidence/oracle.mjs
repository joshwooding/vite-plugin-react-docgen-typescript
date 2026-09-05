import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  applyEdit,
  context,
  dist,
  docSummary,
  evidence,
  identity,
  json,
  metadata,
  options,
  oraclePath,
  relative,
  root,
  targets,
  variant,
  verifyIdentity,
  workload,
  workloadIdentity,
  writeJson,
} from "./common.mjs";

const [, , mode, stage] = process.argv.slice(2);
assert.equal(
  workload,
  "shallow",
  "Salt reuses the independently generated frozen027 semantic oracles",
);
assert.equal(variant, "baseline");
assert(["default", "projectService"].includes(mode));
assert(["baseline", "component", "shared"].includes(stage));
const before = identity();
verifyIdentity(
  before,
  json(path.join(evidence, "identities.json"))[workload][variant],
);
assert(
  !existsSync(oraclePath(mode, stage)),
  "Do not overwrite a generated oracle",
);
const restores = [];
let plugin;
try {
  if (stage !== "baseline") restores.push(applyEdit("component"));
  if (stage === "shared") restores.push(applyEdit("shared"));
  process.chdir(root);
  const { default: createPlugin } = await import(pathToFileURL(dist));
  plugin = createPlugin(options(mode));
  await plugin.configResolved({ command: "serve", root });
  const documents = {};
  for (const file of targets)
    documents[relative(file)] = metadata(
      await plugin.transform.call(context, readFileSync(file, "utf8"), file),
    );
  writeJson(oraclePath(mode, stage), {
    mode,
    stage,
    processId: process.pid,
    workloadIdentity: workloadIdentity(before),
    documents,
    summary: docSummary(documents),
  });
} finally {
  try {
    await plugin?.closeBundle();
  } finally {
    try {
      for (const restore of restores.reverse()) restore();
    } finally {
      verifyIdentity(identity(), before);
    }
  }
}
