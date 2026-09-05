import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { directory, median, readJson, summarize, validateReport } from "./summarize.mjs";

const originalLfHash = (content) => createHash("sha256").update(content.replaceAll("\r\n", "\n")).digest("hex");
const capture = readJson("capture.json");
assert.equal(capture.stage, "final");
const actual = summarize(capture);
assert.deepEqual(actual, readJson("summary.json"), "Saved summary differs from raw evidence");
assert.equal(median([3, 1, 2]), 2);
assert.equal(median([1, 4, 2, 3]), 2.5);
const sample = capture.samples[0];
const report = readJson(sample.report);
validateReport(report, sample);
const wrongCache = structuredClone(report);
wrongCache.cache = "restart";
assert.throws(() => validateReport(wrongCache, sample), "Wrong cache must be rejected");
const wrongScenario = structuredClone(report);
wrongScenario.scenario.sourceSha256 = "0".repeat(64);
assert.throws(() => validateReport(wrongScenario, sample, report), "Wrong scenario fingerprint must be rejected");
const stale = structuredClone(report);
stale.results[0].runs[0].componentHmr.status = "stale";
assert.throws(() => validateReport(stale, sample), "Stale HMR must be rejected");
assert.throws(() => summarize({ ...capture, samples: capture.samples.slice(1) }), "Missing sample must be rejected");
const badExtension = structuredClone(capture);
badExtension.extendedGroups.push("invented/group");
assert.throws(() => summarize(badExtension), "Unjustified extension must be rejected");
const duplicateInvocation = structuredClone(capture);
duplicateInvocation.samples[1].invocation = 1;
assert.throws(() => summarize(duplicateInvocation), "Duplicate invocation must be rejected");
if (capture.pidGuardAmendment) {
  const stopped = readJson(capture.pidGuardAmendment.preservedStop);
  assert.equal(stopped.failures[0].message, "AssertionError [ERR_ASSERTION]: Measured PID reused");
  assert.equal(stopped.samples.length, 26);
  for (let i = 0; i < 26; i++) {
    const current = structuredClone(capture.samples[i]);
    if (i === 25) { current.status = "FAILED"; delete current.controlRecovery; }
    assert.deepEqual(current, stopped.samples[i], "Pre-pause invocation was changed");
  }
  for (const [file, sha256] of Object.entries(capture.pidGuardAmendment.retainedReportSha256)) assert.equal(originalLfHash(readFileSync(path.join(directory, file), "utf8")), sha256, "Pre-pause raw report changed");
  const [firstPath, firstHash] = Object.entries(capture.pidGuardAmendment.retainedReportSha256)[0];
  const original = readFileSync(path.join(directory, firstPath), "utf8");
  assert.equal(originalLfHash(original.replace(/\r?\n/g, "\r\n")), firstHash, "Git CRLF checkout must retain the original-LF hash");
  const mutated = original.replace('"schemaVersion": 2', '"schemaVersion": 9');
  assert.notEqual(mutated, original, "Hash mutation control must change data");
  assert.notEqual(originalLfHash(mutated), firstHash, "Data mutation must change the preserved hash");
}
console.log(`PASS: deterministic summary, six negative validations, EOL tolerance and data-mutation check, preserved pre-pause samples, ${capture.samples.length} raw samples, verdict ${actual.verdict}`);
