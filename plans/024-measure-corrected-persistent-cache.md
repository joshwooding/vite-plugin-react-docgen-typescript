# Plan 024: Measure corrected persistent caching

## Status
DONE at d6553de853530680b0d959120e3b0f9eeeaf8d33 in the isolated worktree;
integrated locally at `6eeed0e`. Priority P3; effort M; risk LOW; category performance decision.
Decision: SIMPLIFY_OR_DEPRECATE from 60 valid samples, no variance extensions.
337 tests, 26 restart checkpoints and four actual watcher rows passed.
See [independent verification](024-verification.md) for results and review disposition.
Planned at 5f448ec8d596854eace55f59faa669193d187310 on 2026-09-05.
Depends on completed 020 and 022. User accepted the recommendation to compare
cache-enabled/disabled restarts and HMR. Plan 023 remains separate.
This plan records evidence and a recommendation; it changes no runtime behavior.

## Why this matters
Plan 022 validates real TypeScript project membership before accepting persistent
metadata, fixing stale restarts but removing the backend-free restart path.
Determine whether the remaining avoided extraction justifies opt-in persistence.
Historical Plan 021 timings were ALL skipped; do not overwrite that evidence.

## Current state
scripts/benchmark-playground.mjs has schemaVersion 2 and benchmarkKind direct-plugin.
Use one mode and --iterations 1 per fresh CLI process. ColdBatch measures config
plus first transforms; warmBatch is same-instance reuse; componentHmr.totalCycleMs
covers direct hook and affected transforms; sessionTotal includes awaited close.
It excludes process launch, fixture creation and separate-process seeding.
Restart seeds identical fixture paths in a separate process and reports seed PID.
The harness checks an updated description for HMR, and React inherited disabled
and shared intent metadata for react-typing. It does not measure browser latency.
--baseline requires identical cache states and cannot compare on versus off.
Identity includes source/build/harness hashes, Git HEAD, dependency versions,
scenario source hash and file count. Cache lifecycle reports initial/final entries.
No existing timing runner exists. Reuse the harness, not another benchmark engine.

Existing ignored probes in the Plan 022 worktree under
.yarn/simplification-evidence/022/{common.mjs,verify-restart-cases.mjs,verify-vite-watcher.mjs}
establish 26 separate-process restart checks and four actual Vite watcher rows.
Copy and adapt into plans/024-evidence with repo path ../.., raw temporary files
under .yarn/simplification-evidence/024 and result files in plans/024-evidence.
They wrap parser extraction for correctness; never import them into timed runs,
and do not interpret compiler-loaded fields from these probes as lazy-load evidence.

Known limitation: initially absent external type files created after startup may
lack watcher events with both cache states. Plan 023 owns that decision. Exclude
that workload explicitly; it must not be presented as fixed or invalidate this
authorized measurement of covered workloads. Existing deletion/recreation probes
allow watcher registration grace, not instantaneous recreation guarantees.

## Scope and Git ownership
Executor may create ONLY plans/024-evidence/** and
plans/024-persistent-cache-measurement.md in a NEW isolated worktree:
D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan024/vite-plugin-react-docgen-typescript
Branch codex/024-measure-corrected-persistent-cache from exact planned-at SHA.
Root owns this plan and main plans/README.md; do not edit either.
No production, benchmark harness, fixture, dependency, lockfile or historical
evidence changes. Temporary artifacts/build output may use ignored locations.
Do not merge or push. Freeze and report before committing; commit only after
root approval. One-command git -c commit.gpgsign=false commit is permitted.
Do not change Git configuration or remove existing worktrees.
Use sandbox escalation for Git metadata writes/child processes when necessary.

Drift gate: git diff --stat 5f448ec8d596854eace55f59faa669193d187310..HEAD --
scripts/benchmark-playground.mjs packages/vite-plugin-react-docgen-typescript/src
Expected empty. Root has verified base worktree clean and matching SHA.

## Commands and gates
Existing ancestor node_modules is usable; do not install/upgrade.
Build from packages/vite-plugin-react-docgen-typescript in new worktree:
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs
Typecheck from worktree root:
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json
Full suite (ROOT runs once while executor prepares evidence):
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
Expect 337 tests / 13 files. Coordinate build and suite start with root.
Scoped scripts check: node --check for each added script; git diff --check.
Path-sensitive snapshots require preserving repository basename. If tests report
a stat-only snapshot modification, confirm empty diff AND identical normalized
HEAD/working object IDs before an index refresh; never alter snapshot content.

## Steps
1. Create isolated worktree; report readiness to root. Inspect harness and probes.
Build, typecheck and adapt the three correctness probe scripts. Run copied probes;
expect 26 restart PASS and four real watcher PASS. Capture source/build identities
before/after; changed or stale covered results stop all timing. No new fixes here.

2. Add a small standalone sequential runner and deterministic summarizer under
plans/024-evidence. Record exact commands, order, timestamps, child PID, all raw
harness JSON and failures. Before samples, send root runner readiness for inspection.
Validate schema, identity and scenario/parser equality across cache states, one
mode/one run, first measured instance, finite nonnegative metrics, HMR updated,
cache lifecycle (off 0/0; populate 0/positive; restart positive/positive and distinct
seed/measured PIDs). Fresh process per invocation, no TS import in parent. No
heavyweight root or executor work concurrent with timing. ROOT must confirm suite,
runner review and timing readiness before capture begins.

3. Capture 12 combinations: scenarios large-project and react-typing at scale 1,
modes default and projectService, cache off/populate/restart. Five independent
CLI processes per combination, sequentially, rotating cache state order by round.
CLI shape:
node scripts/benchmark-playground.mjs --scenario SCENARIO --scale 1 --modes MODE --cache STATE --iterations 1 --output REPORT
Use identical unchanged workload. Restart seeding is already done by harness;
exclude seed time. Assert fresh processes and matching workload/code identity.
Compute median and median absolute deviation (MAD). Decision metrics are cold,
session and HMR. If any MAD exceeds 20% of median, allow exactly one extension to
10 samples for affected scenario/mode ALL THREE states; persistent excess means
INCONCLUSIVE. No repeated hunting for a favorable result or sample removal.
Record all failed invocations; failure is not a discarded slow sample.

4. Untimed storage diagnostic may run --keep-temp for each scenario/mode restart
and inspect only persistent-cache bytes/file counts after awaited close. Capture
its reports separately so they never enter timing statistics. Validate absolute
temporary path containment within OS temp and exact benchmark directory prefix
before removing that one new fixture. Never recurse through node_modules junctions.
If unavailable, report storage as unavailable with reason. Retained memory is
unmeasured; do not add a memory subsystem or infer memory from disk bytes.

5. Write reproducible measurement/decision document with all 12 rows and raw data
links, median/MAD for cold/warm/HMR/session, affected module and cache entry counts,
identities, methodology, limitations and a bounded next recommendation.
Predetermined criterion: KEEP requires restart cold median saving BOTH >=20% and
>=100ms on at least one workload, AND no material same-workload HMR regression
BOTH >10% and >10ms (assess populate and restart against off across reported rows).
Freshness required in the covered scope. Otherwise recommend SIMPLIFY_OR_DEPRECATE;
persistent excessive decision-metric variance gives INCONCLUSIVE. Report other
rows even when one meets the benefit threshold. No broader speed claims.
Population overhead = median populate session minus median off session.
Restart session saving = median off session minus median restart session.
Break-even = ceil(max(0, population overhead) / positive restart session saving);
otherwise no demonstrated break-even. Label projected reuse sessions, not a
measured repeated-session sequence. Keep raw negative deltas.
No automatic cache removal/default change. Plan 023 stays separate.

6. Verify summary deterministically from raw reports. Include a small negative
validation check for wrong cache/scenario identity, stale HMR or missing samples
so malformed evidence cannot yield a favorable verdict. Not a general framework.
Report changed files and criteria to root for independent review. After approval
commit evidence only with a concise message and report exact SHA/clean status.

## Done criteria
Clean unchanged production/harness/fixtures/lockfile versus base; build/typecheck,
337 tests, 26 restart and four watcher checks pass. Complete valid bounded matrix,
all raw samples preserved, independently reproduced statistics/verdict, no
unsupported claims, storage limitation honest, scoped diff and whitespace clean.
Root reviews full diff and reruns deterministic validation plus representative
fresh-process CLI rows; do not repeat the whole noisy timing matrix unnecessarily.

## STOP conditions
Source/base drift, toolchain mismatch, stale covered metadata, missing real watcher
events, unexplained harness/schema mismatch, unsafe cleanup path, changed source
or build during capture, need to edit out-of-scope files, or checks fail. Diagnose
and report; do not silently relax a gate or introduce a production fix.
Evidence scripts may be revised by root feedback, at most two formal review rounds.

## Methodology amendment: recycled process identifiers

The first capture paused after invocation 26 because an evidence-only global PID
uniqueness guard rejected a recycled Windows PID. Root inspected both records:
invocation 15, PID 26648, ran 12:52:50.046–12:52:53.272 UTC; invocation 26,
PID 26648, ran 12:53:42.325–12:53:45.583 UTC. Both separate, awaited execFile
calls exited 0 and their raw reports passed metadata/workload checks. This does
not demonstrate compiler-state reuse. The global uniqueness assertion was wrong.

Preserve the stopped capture and original runner/validator. Replace that guard
with unique invocation IDs, reported PID equal to the spawned child PID, report
timestamps inside nonoverlapping process lifetimes, and one first-measured
instance per process. Keep the seed/measured PID distinction within each run.
Root authorizes a narrowly scoped continuation only for this recorded guard
failure, after reviewing it and revalidating current fingerprints and all 26 raw
reports. Retain the original failure and record its disposition; include sample
26, then continue at 27. No completed sample is discarded or rerun. Preserve the
pause interval and its potential effect in the report. Matrix, workload, decision
thresholds, ordering, and bounded variance extension remain unchanged.
