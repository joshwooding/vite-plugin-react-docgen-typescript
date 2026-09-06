import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  evidence,
  raw,
  json,
  writeJson,
  hash,
  dist,
  slash,
} from "./common.mjs";
const modes = ["default", "projectService"];
function owner(frame) {
  const url = slash(frame.url ?? "");
  if (url.includes("/typescript/lib/")) return "TypeScript compiler";
  if (url.includes("/react-docgen-typescript/"))
    return "react-docgen-typescript extraction";
  if (
    url.endsWith(slash(dist)) || url.includes(slash(path.dirname(dist)) + "/chunks/")
  )
    return "Plugin";
  if (url.startsWith("node:fs") || url.includes("internal/fs"))
    return "Node filesystem";
  if ((url.includes("/plans/032-evidence/") || url.includes("/plans/029-evidence/"))) return "Profile driver";
  if (frame.functionName === "(garbage collector)")
    return "V8 garbage collection";
  if (url.startsWith("node:") || url.startsWith("internal/"))
    return "Other Node runtime";
  if (url.includes("/node_modules/")) return "Other dependency";
  if (!url && /realpath/i.test(frame.functionName))
    return "Native filesystem: realpath";
  if (!url && /existsSync/i.test(frame.functionName))
    return "Native filesystem: existsSync";
  return "V8 / unattributed";
}
function summarize(profile) {
  assert(profile.samples.length === profile.timeDeltas.length);
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node.id);
  const describe = (frame) => ({
    functionName: frame.functionName || "(anonymous)",
    url: slash(frame.url ?? ""),
    lineNumber: frame.lineNumber + 1,
    owner: owner(frame),
  });
  const responsibleFrames = new Map();
  for (const original of profile.nodes) {
    const chain = [];
    let node = original;
    while (node) {
      const group = owner(node.callFrame);
      if (group === "Plugin" || group === "react-docgen-typescript extraction")
        chain.push(describe(node.callFrame));
      node = nodes.get(parents.get(node.id));
    }
    responsibleFrames.set(original.id, chain.slice(0, 8));
  }
  const owners = new Map();
  const frames = new Map();
  const callers = new Map();
  const nativeCalls = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const nodeId = profile.samples[i];
    const frame = nodes.get(nodeId).callFrame;
    const weight = profile.timeDeltas[i];
    total += weight;
    const group = owner(frame);
    owners.set(group, (owners.get(group) ?? 0) + weight);
    const key = JSON.stringify(describe(frame));
    frames.set(key, (frames.get(key) ?? 0) + weight);
    const chain = responsibleFrames.get(nodeId);
    if (chain.length) {
      const callerKey = JSON.stringify(chain[0]);
      callers.set(callerKey, (callers.get(callerKey) ?? 0) + weight);
    }
    const nativeKind =
      !frame.url && /realpath/i.test(frame.functionName)
        ? "native realpath"
        : !frame.url && /existsSync/i.test(frame.functionName)
          ? "native existsSync"
          : null;
    if (nativeKind) {
      const nativeKey = JSON.stringify({
        nativeKind,
        nearestCaller: chain[0] ?? null,
        responsibleCallChain: chain,
      });
      nativeCalls.set(nativeKey, (nativeCalls.get(nativeKey) ?? 0) + weight);
    }
  }
  return {
    sampleCount: profile.samples.length,
    totalWeightedSampleMs: total / 1000,
    phaseProfileDurationMs: (profile.endTime - profile.startTime) / 1000,
    ownership: [...owners]
      .map(([owner, weight]) => ({
        owner,
        weightedSelfMs: weight / 1000,
        percent: (100 * weight) / total,
      }))
      .sort((a, b) => b.weightedSelfMs - a.weightedSelfMs),
    topSelfFrames: [...frames]
      .map(([key, weight]) => ({
        ...JSON.parse(key),
        weightedSelfMs: weight / 1000,
        percent: (100 * weight) / total,
      }))
      .sort((a, b) => b.weightedSelfMs - a.weightedSelfMs)
      .slice(0, 30),
    nearestResponsibleCallers: [...callers]
      .map(([key, weight]) => ({
        ...JSON.parse(key),
        weightedAttributedMs: weight / 1000,
        percent: (100 * weight) / total,
      }))
      .sort((a, b) => b.weightedAttributedMs - a.weightedAttributedMs)
      .slice(0, 30),
    nativeFilesystemByCaller: [...nativeCalls]
      .map(([key, weight]) => ({
        ...JSON.parse(key),
        weightedNativeSelfMs: weight / 1000,
        percent: (100 * weight) / total,
      }))
      .sort((a, b) => b.weightedNativeSelfMs - a.weightedNativeSelfMs),
  };
}
const rows = [];
for (const mode of modes)
  for (const phase of ["cold", "shared"]) {
    const report = json(
      path.join(evidence, "profiles", `salt-${mode}-post029-candidate.json`),
    );
    const phaseProfile = report.profiles[phase];
    const target = path.resolve(phaseProfile.path);
    const relative = path.relative(path.resolve(raw, "profiles"), target);
    assert(
      relative && !relative.startsWith("..") && !path.isAbsolute(relative),
      "Profile outside owned raw directory",
    );
    assert.equal(hash(readFileSync(target)), phaseProfile.sha256);
    const profile = json(target);
    rows.push({
      mode,
      phase,
      identity: report.identity,
      profile: phaseProfile,
      ...summarize(profile),
    });
  }
writeJson(path.join(evidence, "profile-summary.json"), {
  scope:
    "Separate untimed V8 inspector CPU samples for the named plugin phases. Time-delta-weighted self samples describe ownership, not exact wall-clock attribution or promised savings. Ancestor attribution assigns each sample to its nearest plugin/parser frame and is distinct from caller self time; native realpath/existsSync retain their responsible stack chains. Source/build identities and raw profile hashes are retained.",
  rows,
});
console.log(
  JSON.stringify(
    rows.map((row) => ({
      mode: row.mode,
      phase: row.phase,
      samples: row.sampleCount,
      ownership: row.ownership,
    })),
    null,
    2,
  ),
);
