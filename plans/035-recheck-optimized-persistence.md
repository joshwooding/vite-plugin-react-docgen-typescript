# Plan 035: Recheck disk persistence on the optimized runtime

Status: DONE. Selected by the user on 2026-09-06; all 60 measured processes,
true-hit/freshness controls and independent raw-statistics verification pass.
Result: SIMPLIFY_OR_DEPRECATE on the two declared fixtures. Evidence is integrated
locally; no product behavior changed. See [verification](035-verification.md).
Priority P3; effort M; risk LOW; performance evidence only.
Planned at `ec7455ac7bf3986610b7f79291dd1acae644beba`.
Depends on completed 024/033/034 and the evidence-freshness gate in proposal 026.

## Purpose and decision boundary

Plan024 measured the pre-029/033 runtime. Those two accepted optimizations changed
both extraction and persistent-hit validation paths, so its timings cannot establish
the current benefit. Recheck the same two fixtures on the current artifact using
the unchanged corrected benchmark. Produce KEEP, SIMPLIFY_OR_DEPRECATE or
INCONCLUSIVE under the predeclared rule below. This authorizes measurement and
an evidence-backed recommendation, not deprecation, removal or a default change.

The original fixtures are `large-project` at scale1 (16 component files) and
`react-typing` at scale1 (three component files). Their small scope is intentional
for comparison with024. There is no Salt-specific, browser-latency, macOS/Linux or
universal cache-benefit claim. The unchanged CLI has no external-consumer argument.
Do not invent a Salt adapter or extend the scenario list during this experiment.

## Workspace and ownership

MAIN is `D:/OSS/vite-plugin-react-docgen-typescript`.
Executor worktree is
`MAIN/.yarn/.codex-worktrees/plan035/vite-plugin-react-docgen-typescript`, on
`codex/035-recheck-optimized-persistence`, starting at the exact planned SHA.
Preserve the repository basename. Parent `node_modules` is available; do not
install or upgrade packages. Use Node `C:/nvm4w/nodejs/node.exe` and Python
`C:/Python311/python.exe`; PowerShell login is disabled.

Executor may create only `plans/035-evidence/**` and
`plans/035-persistent-cache-measurement.md`, plus standard ignored build/temp output
under its own worktree. Root owns this plan, index/backlog and independent report.
No edits to runtime, tests, benchmark harness, fixtures, manifests, lockfile,
Changesets or any historical evidence. Do not commit until root approval. The
user's prior unsigned local-commit authorization persists; use only the per-command
override, never alter persistent signing configuration. No push or publication.

Use `.gitattributes` with `* -text` inside new evidence to retain exact hashes.
Read/write Python text explicitly as UTF-8. Validate absolute owned fixture paths
before recursive deletion. Unlink a temporary dependency junction itself before
fixture cleanup; never recurse into installed dependencies. Keep failed outputs.

## Current implementation and reusable proof

Read these files before adapting evidence:

- `scripts/benchmark-playground.mjs`: schema2/direct-plugin. CLI accepts scenario,
  scale, one mode, cache off/populate/restart and iterations1. Its exported
  `warmMode`, `prepareIteration` and `measureModeIteration` allow untimed observation
  without editing the timed harness. `createWorkspace` at382-429 is private;
  a small evidence-only fixture constructor must mirror the two selected scenarios.
- `measureModeIteration` at716-819 constructs the plugin, performs first and warm
  batches, changes the documented component description, runs direct HMR and
  affected transforms, awaits close, and restores the file in finally.
- `prepareIteration` at851-874 clears owned cache and seeds restart in a separate
  awaited process at identical paths. React validation also runs in a child.
  Cold excludes fixture setup/seeding/process launch; HMR excludes marker write;
  session includes configuration through awaited close and marker write.
- `plans/024-evidence/{run-matrix,summarize,verify-evidence,common}.mjs` provide
  the existing sequential launcher, statistics, malformed-evidence controls and
  full semantic projection. Adapt into035; never execute against024 output paths.
- `plans/033-evidence/compatibility/artifact.json` gives the exact accepted archive
  and five dist hashes. Archive SHA256 is
  `a7aa4620b18c2eebfffbeab4cb623d94f91b4f0371b684b37eacd52ee901dfbe`.
  Index SHA256 is
  `0039755d18125248d78268a266405aded347fa1dfbd8034f2e08e9b5363bb1cb`.
- 033's 26 fresh-process restart checkpoints and native watcher checks, plus034's
  eight native boundary rows, already passed on exactly this runtime. Verify that
  identity and reuse this evidence; do not repeat their whole matrices or the full
  suite. The new workload-specific controls below are the additional required gate.
- The measured `typescript` package is6.0.3; installed typecheck alias `typescript6`
  is6.0.2. Record actual resolution separately rather than conflating the versions.

Benchmark modes `default` and `projectService` select stable legacy and project
service behavior through the existing compatible options. Do not modernize their
option spelling or otherwise change the harness to run this evidence task.

## Exact verification commands

From the new worktree root unless noted:

1. `git diff --stat ec7455ac7bf3986610b7f79291dd1acae644beba..HEAD -- scripts/benchmark-playground.mjs packages/vite-plugin-react-docgen-typescript/src benchmarks/fixtures package.json yarn.lock`
   Expected empty at entry; final in-scope inputs remain unchanged.
2. Build once from `packages/vite-plugin-react-docgen-typescript`:
   `node MAIN/node_modules/unbuild/dist/cli.mjs`.
   All five resulting dist hashes must match the033 archive. No repack needed.
3. Check every new `.mjs` with `node --check plans/035-evidence/NAME.mjs`.
   If adding Python, parse its AST without creating bytecode. Expected exit0.
4. Timed CLI shape, only after root approves gates:
   `node scripts/benchmark-playground.mjs --scenario SCENARIO --scale 1 --modes MODE --cache STATE --iterations 1 --output REPORT`.
   Do not use `--baseline` to compare differing cache states; it rejects them.
5. Execute the named new control, capture, summarize and evidence-validation
   commands from the runner/report. Record concrete commands and exit codes.
6. `git diff --check` on authored plan/report/script changes, recognizing retained
   CRLF evidence with per-command `-c core.whitespace=cr-at-eol` if necessary.
   Do not rewrite historical data or raw reports to satisfy whitespace checks.

## Ordered execution gates

1. Freeze current source, harness, both fixture trees, package/lockfile, Node and
   resolved dependency versions/hashes. Build once and verify all five dist hashes.
   Record unchanged runtime Git content, accounting explicitly for existing checkout
   line endings. Source hashes may differ from033 because034 added tests; distinguish
   test-only source-tree differences from actual runtime drift.

2. Add a bounded untimed control using the unchanged harness exports and real
   plugin. Build the two fixtures with exactly the harness's tsconfig, component
   selection, marker strings and dependency junction behavior. Place new control
   fixtures under os.tmpdir() with an owned035 prefix, matching the timed topology;
   do not inherit repository node_modules through a worktree-descendant fixture.
   Retain exact fixture paths in manifests. For each of the
   four scenario/mode groups, use one shared owned fixture path and fresh awaited
   child processes for off, populate, seed and restart. Never warm timed processes.
   Cache states must start as specified; seed before restart without HMR mutation.
   Observe `Parser.getComponentInfo` only in these untimed children: off/populate
   first batches extract positively, seeded restart first batch extracts zero.
   Record initial/final entry counts. A positive file count alone is not hit proof.

   Capture complete normalized semantic metadata (component names/descriptions;
   prop name, description, required, type, defaultValue) for first, warm and HMR
   states. First/warm/restart must equal fresh cache-off extraction at identical
   paths. Compare post-edit metadata to another independent fresh cache-disabled
   extraction with the effective edited source, not solely the existing description
   sentinel. Untouched components must remain unchanged. Capture actual affected,
   invalidated and transformed file identities in relative form, and assert equal
   work across cache states, not merely equal counts. Wrapper observations must
   forward hooks/results and never repair invalidation. Preserve ordinary harness
   scope: these are direct-plugin controls, not native delivery measurements.

   Await all closes; restore original source before the next state. Reject missing
   metadata, warnings, stale output, no-op edits, missing true hits or unequal work.
   Preserve all control outputs and exact script hashes; controls never enter timing
   statistics. Frozen033/034 native/offline proofs cover unchanged runtime behavior.

3. Adapt024's sequential runner/summarizer without its historical hard-coded
   identities or PID-recovery special case. Send root the ready scripts, frozen
   identity and passing controls BEFORE timing. Root reads the actual assertions
   and independently reviews the protocol. Timing starts only after root's explicit
   readiness message, not a new user permission request. No heavy work concurrently.

4. Capture exactly60 initial measured CLI invocations: two scenarios x two modes
   x three cache states x five rounds. Rotate cache-state order by round as024:
   off/populate/restart, populate/restart/off, restart/off/populate, then repeat.
   Use one mode and iterations1 in each fresh Node process. Seed/validation children
   are additional untimed processes and must be reported separately.
   Record unique invocation IDs, actual child PID, timestamps, exact arguments,
   stdout/stderr, exits and raw report hashes. PID reuse across nonoverlapping
   process lifetimes is legal; assert reported PID equals spawned PID and process
   lifetimes do not overlap. Seed/measured PID must differ within the same run.
   Never overwrite, discard, replace or silently rerun a sample.

   Validate schema2/direct-plugin, exact identity and parser/scenario hashes,
   first measured instance, one mode/run, finite nonnegative metrics, updated HMR,
   matched affected counts and cache lifecycle. Compare source/build/fixtures and
   runner fingerprints before/after capture and on every invocation. Stable workload
   file hashes must match after the harness restores source.

5. Calculate median and MAD for cold, warm, HMR and session. If any cold/HMR/session
   MAD exceeds20% of its median in a group after the first five samples, allow one
   extension to ten samples for ALL THREE states of exactly that scenario/mode
   group. Maximum120 measured invocations. No second extension. Continued excess
   yields INCONCLUSIVE. Preserve initial statistics and deterministic extension
   selection. If a true correctness/identity failure occurs, stop timing and report;
   do not turn it into a performance result. Document setup failures separately.

6. Apply the original024 implemented retention rule explicitly: KEEP requires
   restart cold saving BOTH >=20% and >=100ms in at least one scenario/mode group,
   AND no material populate/restart HMR regression in ANY reported group. A material
   HMR regression requires BOTH >10% and >10ms versus off. Freshness is mandatory.
   Otherwise SIMPLIFY_OR_DEPRECATE, unless variance makes the result INCONCLUSIVE.
   Report per-group eligibility as well as the aggregate so the conservative policy
   does not hide a workload that benefits. Zero cold/HMR/session medians make
   ratio-based decisions INCONCLUSIVE; report that reason, never serialize a
   nonfinite ratio as null or let it satisfy a threshold. Do not infer all consumers would benefit
   from removal. Population overhead is median populate session minus off; restart
   saving is off minus restart. Projected break-even is ceil(max(0, overhead)/positive
   saving); otherwise no demonstrated break-even. Keep negative deltas visible.

7. Reuse deterministic evidence validation and add meaningful negative mutations
   for wrong cache/scenario identity, stale HMR, missing sample, unequal affected
   work and an unjustified variance extension. Independently recompute statistics
   from raw data. A small untimed four-group storage check may reuse024's existing
   --keep-temp path guards; omit it with reason if unnecessary for the decision.
   No retained-memory claim or new measurement subsystem.

8. Write the full bounded measurement report with12 rows, medians/MAD, counts,
   identities, true-hit controls, scope limits and verdict. Root independently
   audits raw data/statistics/controls and source identity, then integrates evidence
   and updates026's rationale/backlog. No runtime changes, deprecation notice or
   removal is part of this plan. Preserve024 unchanged. No external review-service
   upload is pre-authorized for035; the required closeout here is independent local
   evidence review rather than repeating a product-code review on unchanged code.

## Done and stop conditions

DONE: unchanged production/harness/fixtures/dependencies; exact current artifact;
passing workload-specific hit/freshness/affected-work controls; complete bounded
matrix or honest INCONCLUSIVE result; validated raw data and independently reproduced
decision; evidence integrated with updated status. Do not repeat old benchmark,
TS7, Storybook, watcher or full-suite work beyond these named gates.

Stop on stale metadata, non-genuine hits, unequal affected work, unsafe path cleanup,
runtime/harness drift, script changes after sampling starts, unexplained schema or
toolchain mismatch, or need for a new product contract. Diagnose and preserve evidence;
do not broaden scope or silently lower thresholds. Root may authorize correction of
an evidence-only setup error after reviewing it, preserving any successful samples.
