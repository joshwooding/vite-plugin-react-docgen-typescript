# Plan 021: Decide whether persistent caching earns its complexity

## Status and objective

- Priority: P3; effort: M plus bounded sampling; risk: LOW (decision only).
- Category: performance/design spike. Depends on: plans 017, 018 and 020 DONE.
- Status: DONE — independently verified `CORRECTNESS_GAP` decision at `e698406bf86849263c260a81950af67f021e424d`; integrated locally at `6eeed0e` (the original correctness gaps are superseded by Plan 022). Planned at: `a360aca38a57b33bc1b08913eeff37216991cfa4`, 2026-09-05.
- Reconciled at: `c5b97ae5e1ed33e350c8f4d3a8da77077aa2caf2`, 2026-09-05.

Produce a measured recommendation to keep, simplify, or eventually deprecate
the opt-in filesystem cache. This plan does not remove the feature, change
defaults, or add another cache. Correctness is a prerequisite to counting a
cache hit as a benefit.

## Scope, drift check, and workflow

```sh
git diff --stat c5b97ae..HEAD -- scripts/benchmark-playground.mjs packages/vite-plugin-react-docgen-typescript/src/plugin.ts packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/utils/cache.ts
```

Expected prerequisite changes must match the completed plans. Record the actual
evaluated SHA before sampling; do not benchmark a drifting working tree.

Only create/modify files under `plans/021-evidence/`, a decision record
`plans/021-persistent-cache-decision.md`, and this plan's index status. An
implementation executor may place disposable raw benchmark output under the
ignored `.yarn/simplification-evidence/021/` directory, then retain a compact
validated summary with the decision record. Do not modify production source,
benchmark semantics, dependencies, fixture types, defaults, or public options.
Small plan-local scripts for sampling/validation are allowed; no runner framework.

Use a clean isolated `codex/021-persistent-cache-decision` worktree at the
reviewed prerequisite result. Do not remove existing experiment evidence or
commit/cherry-pick the historical snapshot-cache candidate. No push/merge or
deprecation announcement is authorized by this plan.

Execute at exact base `c5b97ae5e1ed33e350c8f4d3a8da77077aa2caf2` in
`.yarn/.codex-worktrees/plan021/vite-plugin-react-docgen-typescript`, preserving
that basename for existing path-sensitive tests. The reviewed chain includes
017, 018, 019 and 020. Drift matches their approved changes; the persistent
proof implementation itself has not changed. The executor owns evidence and
decision files inside this new worktree. The advisor owns the main plan/index
and independently verifies the decision before authorizing an isolated commit.
No edits to the main source checkout, earlier worktrees, or runtime defaults.

## Current behavior and unresolved questions

In `src/plugin.ts`, identical-source memory hits return immediately, and
persistent proof-bearing hits can return before backend initialization.
That bypass is the main possible value of persistent caching. Cache state is
opt-in and false by default in the README.

Proof creation at `src/utils/cache.ts:392` and validation at `:465` read and hash
the same shared files separately for each component. Namespace creation also
includes versions/config/options. Persisted entries contain generated output,
dependencies, config proofs and unresolved candidates. These mechanisms impose
startup I/O, disk storage and correctness maintenance costs.

Plan 017 fixes live config edits after a cache-only startup. Plan 018 fixes
cycles, conditional resolution, and edits to existing ambient declarations.
Neither automatically proves that a list of previously known dependencies can
detect a new ambient root created while the server was stopped. This case must
be evaluated explicitly; do not equate a green existing suite with safe reuse.

An additional watcher question remains unverified. Inspection during Plan 018
found that `plugin.ts` registers cached config paths with `addWatchFile`, while
`trackModuleDependencies` updates reverse indexes without registering type-file
watches. The new dependency contracts explicitly deliver HMR events, so they do
not establish that Vite observes a type-only declaration outside its root.
Before recommending broader cache use, reproduce an external-root declaration
edit with a real Vite server after both fresh and persistent-only startup. This
is a follow-up question, not a confirmed runtime failure or authorization to
change watchers here; record any demonstrated gap separately from timings.

The initial benchmark never enabled persistence. Plan 020 adds labeled
off/populate/restart states and a React typing fixture. Its direct-plugin
timings must remain distinct from real browser HMR. Historical snapshot-cache
experiments were inconclusive and are not evidence for this separate feature.

## Measurement commands

These commands depend on the flags/scenario implemented by plan 020:

```sh
yarn build
node scripts/benchmark-playground.mjs --scenario large-project --iterations 1 --modes projectService --cache off --output .yarn/simplification-evidence/021/example-off.json
node scripts/benchmark-playground.mjs --scenario large-project --iterations 1 --modes projectService --cache restart --output .yarn/simplification-evidence/021/example-restart.json
```

Use both default and ProjectService modes, large-project and react-typing
scenarios, and off/populate/restart cache states. Exactly one mode and one
measured iteration per child process are required for independent samples;
verify each accepted row has `processFirstMeasuredInstance: true`. Record the process startup
definition: the existing cold-batch metric begins around plugin setup/transform,
not Node process launch. Do not describe it as total application startup time.

For correctness controls run:

```sh
yarn typecheck
yarn test run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
git diff --check
```

Expected: all pass. Building/installing occurs only in the isolated execution
worktree; if dependencies are absent, `yarn install --immutable` is the known
setup command. No network/install failure is a successful verification.

Installed ancestor dependencies can be reused in this nested worktree. Use:

- Tests: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs`
  followed by the prescribed arguments.
- Typecheck: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json`.
- Build: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs`
  from the worktree's package directory.

The executor builds, runs typecheck and checks the benchmark fixture. The
advisor runs the 309-test full-suite control once in the new worktree. Evidence
authoring can proceed meanwhile, but no timing samples start until controls
and all correctness cases pass. Review is local and evidence-based for this
decision-only plan: inspect the probes, independently rerun them and validate
the summary. No external review service is required. Freeze the evidence and
decision before the advisor's review; commit only after approval. One-command
unsigned committing is permitted without changing Git configuration.

## Steps

1. Confirm prerequisites and run correctness controls. Record evaluated commit,
   lockfile identity, Node/TS/Vite/RDT versions, OS, mode and scenario definitions
   in the decision note. Verify all control commands pass and the plan-020 smoke
   scenarios validate real metadata. If a prerequisite is missing, stop before
   sampling.
2. Write a small reproduction under `plans/021-evidence/` for each restart case:
   unchanged input; imported-type edit; config edit; existing ambient edit;
   creation of a new ambient declaration/module augmentation while stopped;
   creation of a previously unresolved import; deletion/recreation of a dependency;
   and a same-size/preserved-mtime content rewrite. Use temporary fixture files
   and compare cache-enabled output to a fresh cache-disabled oracle. Follow
   `src/__tests__/backendContract.test.ts` fixture/teardown conventions. Validate
   these are actual differing metadata inputs before judging invalidation.
   Proposed verifier command: `node plans/021-evidence/verify-restart-cases.mjs`.
   It must write per-case pass/fail JSON and exit nonzero on stale output. Known
   failure is valid investigation evidence, not permission to change production.
   If a failure occurs, skip performance sampling, record each timing row as
   `SKIPPED_CORRECTNESS_GAP`, and proceed directly to the correctness-gap decision.
   Complete the remaining correctness cases in both stable modes even after a
   valid freshness failure. Exercise both a new global declaration and a new
   module augmentation. Separate seed, cached restart and fresh oracle in new
   processes at the same paths; compare semantic metadata, not temporary path
   strings. Include the real-Vite external-root watcher check described above,
   after fresh and persistent-only startup, without manually invoking the HMR
   hook or pre-registering the type file merely to make the test pass. Record
   observed event delivery separately from stale metadata and timing conclusions.
3. Capture five independent process samples per scenario/mode/cache state,
   alternating state order across samples. Seed restart caches in a different
   process at identical component paths, fully await teardown, and exclude seed
   time from restart timing. Verify no compiler warm-up ran in the measurement
   process. Report cold batch, same-instance warm batch, affected HMR time,
   whole-session duration through awaited close, and cache population cost.
   Use the same workload for off/populate/restart. Define population overhead as
   the median whole-session duration for populate minus off; define session
   restart saving as off minus restart. Record cache bytes and file count after
   completion. Fixture restore/copy time is outside all three session totals.
   Report retained memory only if consistently measured; unavailable is not zero.
   For hash/read attribution, use a separate diagnostic probe, not instrumented
   samples mixed into timing results. Proposed runner:
   `node plans/021-evidence/measure.mjs --samples 5`.
   Expected: complete JSON rows for all defined combinations, with correct
   output. If step 2 failed, this runner is not invoked and timing rows carry
   the explicit skipped reason instead of invented values.
   Do not build the timing runner or hashing diagnostics if correctness has
   already failed; only the small validator and skipped-row summary are needed.
4. Summarize medians and median absolute deviations (MAD), retaining individual
   samples and source/version identity. Proposed command:
   `node plans/021-evidence/summarize.mjs`.
   It must reject silently missing/mismatched rows and emit a machine-readable
   verdict. Explicit skipped rows are permitted only with reproducible linked
   freshness failures and a `CORRECTNESS_GAP` verdict.
   The thresholds below are proposed decision rules, not measured facts. Define
   them before capture and do not adjust them after seeing the outcome.
5. Write the decision and update the index. Verify the summary command reproduces
   the written verdict and `git diff --name-only` stays within plan/evidence scope.
   Report each failed freshness case separately from performance conclusions.

## Proposed bounded decision rules

Apply in this order:

1. Any stale metadata: **CORRECTNESS_GAP**. Record the smallest remediation
   proposal and its effect on the backend-free hit benefit. Do not recommend
   wider cache adoption regardless of measured speed.
2. For a decision timing row, MAD exceeding 20% of its median after five samples
   permits one extension to ten total samples. Persistent excessive variance:
   **INCONCLUSIVE**. Do not keep sampling indefinitely.
3. A practical **KEEP** recommendation requires both at least 20% and at least
   100 ms median restart cold-batch saving on at least one realistic workload,
   correctness in every required restart case, and no material HMR regression
   on the same workload. Define material regression as both >10% and >10 ms;
   report small absolute changes without overstating percentages. Other rows
   must be reported even if they fail to benefit.
4. Otherwise recommend **SIMPLIFY_OR_DEPRECATE** for maintainer consideration.
   Report population overhead and break-even number of restarts as well as
   the cache-hit benefit. Use
   `ceil(max(0, population session overhead) / restart session saving)` when
   saving is positive; otherwise there is no demonstrated break-even point.
   Name this a break-even estimate for the benchmark's fixed session workload,
   not for every user's development session. A recommendation does not remove a
   supported feature or change its default.

If correctness requires a new project-membership inventory, compare that design
against validating project membership once through the existing backend and
against disabling persistence. Do not implement a new content-hash cache to
rescue an unproven cache design. Cost estimates and unresolved API questions
must be explicit in the decision.

## Done criteria, stop conditions, and maintenance

- A reproducible verdict and complete sample summary exist at the evaluated SHA,
  or reproducible freshness failures justify explicit skipped timing rows and
  a terminal `CORRECTNESS_GAP` decision. Both are completed investigations.
- Restart freshness cases compare against real fresh output, including new roots.
- Reports distinguish current failures, historical evidence, measured values,
  unavailable metrics and proposed future designs.
- No production feature, default, peer range, or storage contract changed.
- The result names the next bounded action: retain as-is with evidence, author
  a specific correctness/simplification plan, or schedule deprecation separately.

Stop timing if outputs are invalid. A proven cache freshness failure completes
the investigation through the correctness-gap route above; a broken fixture
or unresolved fixture dependency instead blocks the investigation. Stop
and preserve evidence if the required source changes during capture, versions
diverge, subprocesses cannot run, or variance remains high after the one bounded
extension. No huge CI attestation or experiment-management layer is needed.
Future cache optimizations should cite this record and preserve the freshness
cases rather than restarting the same discussion from operation counts.

## Completed investigation and independent review

Completed on 2026-09-05 at evidence commit
`e698406bf86849263c260a81950af67f021e424d`, branch
`codex/021-persistent-cache-decision`. Evaluated production source remains
`c5b97ae5e1ed33e350c8f4d3a8da77077aa2caf2`.

- [Decision](D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan021/vite-plugin-react-docgen-typescript/plans/021-persistent-cache-decision.md)
  and [machine-readable summary](D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan021/vite-plugin-react-docgen-typescript/plans/021-evidence/summary.json).
- All 20 restart checkpoints were independently rerun: 16 passed; new global
  declarations and module augmentations produced stale metadata in both stable
  modes. Seed, cached restart and fresh oracle used separate processes at the
  same paths. Exact size/mtime preservation passed in both modes.
- All four real-Vite watcher rows were independently rerun: an external type-only
  declaration edit produced zero watcher events/hot hooks and stale metadata
  after fresh and persistent-only startup in both modes. In-root positive
  controls succeeded. Persistent-only startup left TypeScript unloaded. This is
  a separate delivery gap, reproduced on Windows/Vite 8, with a five-second
  observation window.
- Build and real React fixture checks passed; the advisor ran 309 tests across
  11 files and independently reran typecheck and both fixture checks.
- Both correctness probes intentionally exited 1 with complete failure reports.
  Summary verification exited 0 and recorded all 12 timing combinations as
  `SKIPPED_CORRECTNESS_GAP`. No timing or hash-attribution work was performed.
- Seven negative summary checks rejected missing/duplicate rows, identity
  mismatch, false freshness status, altered mtime, missing watcher control, and
  compiler loading in a claimed cache-only start. Inputs were fully restored.
  Raw review evidence is in the worktree's ignored
  `.yarn/simplification-evidence/021/reviewer-summary-validation.json`.
- One review revision made the next proposal explicit: reuse existing backend
  membership discovery with a complete persisted baseline and conservative
  rejection of unsupported proofs, accept losing backend-free startup, then
  measure any remaining extraction savings. Watch registration is a separate
  fix. No runtime implementation is part of this completed decision.

The isolated commit contains exactly 11 decision/evidence files. Staged and
committed whitespace checks passed, post-commit summary verification passed,
the worktree is clean, and production-source drift from the evaluated commit
is empty. Main source remains at `a360aca`; nothing was merged or pushed.
