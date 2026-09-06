import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  salt,
  dist,
  raw,
  evidence,
  targets,
  relative,
  writeJson,
  identity,
  applyEdit,
  options,
  context,
  metadata,
  docSummary,
  sentinel,
} from "./common.mjs";
const [mode, stage] = process.argv.slice(2);
if (
  !["default", "projectService"].includes(mode) ||
  !["baseline", "component", "shared"].includes(stage)
)
  throw new Error("Usage: oracle.mjs <mode> <baseline|component|shared>");
const before = identity();
const restores = [];
let plugin;
try {
  if (stage !== "baseline") restores.push(applyEdit("component"));
  if (stage === "shared") restores.push(applyEdit("shared"));
  process.chdir(salt);
  const { default: createPlugin } = await import(pathToFileURL(dist));
  plugin = createPlugin(options(mode));
  await plugin.configResolved?.({ command: "serve", root: salt });
  const documents = {};
  for (const file of targets)
    documents[relative(file)] = metadata(
      await plugin.transform.call(context, readFileSync(file, "utf8"), file),
    );
  const result = {
    mode,
    stage,
    processId: process.pid,
    identity: before,
    summary: docSummary(documents),
    sentinel: sentinel(documents),
  };
  writeJson(
    path.join(raw, "oracles", mode + "-" + stage + ".metadata.json"),
    documents,
  );
  writeJson(
    path.join(evidence, "oracles", mode + "-" + stage + ".json"),
    result,
  );
  console.log(
    JSON.stringify(
      {
        mode,
        stage,
        metadataFileCount: result.summary.metadataFileCount,
        componentCount: result.summary.componentCount,
        sentinel: result.sentinel,
      },
      null,
      2,
    ),
  );
} finally {
  try {
    await plugin?.closeBundle?.();
  } finally {
    try {
      for (const restore of restores.reverse()) restore();
    } finally {
      if (JSON.stringify(identity()) !== JSON.stringify(before))
        throw new Error("Identity drift after oracle");
    }
  }
}
