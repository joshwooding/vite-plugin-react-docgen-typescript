# Plan 016: Cache project-state snapshots and index host membership

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. A dispatching
> reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8682855..HEAD -- packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/plugin.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts scripts/benchmark-playground.mjs scripts/compare-benchmark-results.mjs`
> Reconcile only reviewed Plan 015 changes. Any other semantic drift is a STOP
> condition.

## Status

- **Status**: DONE
- **Outcome**: INCONCLUSIVE — candidate not integrated
- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 015
- **Category**: performance experiment
- **Planned at**: final Plan 015 commit `8682855`, 2026-07-28

## Why this matters

The legacy backend owns three normalized `Set<string>` collections for config,
docgen, and tracked project files. `getProjectState()` currently normalizes,
sorts, and allocates all three arrays every time `initialize()`, `analyze()`, or
a ready `update()` returns, even when project membership is unchanged. The
plugin then repeatedly performs linear `.includes()` membership checks on
those arrays.

Large projects amplify both costs. The proposed optimization is deliberately
narrow:

1. publish one immutable `BackendProjectState` snapshot until the backend
   mutates membership or generation; and
2. build host-side `Set` indexes once whenever the snapshot object changes.

This is an experiment, not an assumed improvement. Keep it only if independent
paired direct-plugin evidence crosses the authored threshold without
correctness, HMR, lifecycle, memory, or timing regressions. The unchanged
real-Vite contracts remain mandatory correctness gates; the timing harness is
not described as a real Vite server.

## Hypothesis and attribution

Primary hypothesis: ProjectService `coldBatchMs` improves because repeated
state materialization and host membership scans are removed from the transform
path.

Secondary diagnostics: default legacy mode, `warmBatchMs`, and component HMR.
They may improve, but they cannot substitute for the ProjectService cold-batch
decision rows.

The experiment must compare:

- **baseline**: the final approved Plan 015 production commit, unchanged; and
- **candidate**: exactly the snapshot/index implementation plus its
  deterministic tests.

Do not combine parser, dependency discovery, cache-policy, watcher, TypeScript,
fixture, or benchmark-shape changes with the candidate. Otherwise attribution
is invalid.

## Current state

At final Plan 015 commit `8682855`:

- `src/docgen/legacyBackend.ts:783-788` rebuilds three normalized sorted arrays
  in every `getProjectState()` call.
- `syncInitialProjectFiles()`, `syncProjectFilesFromProgram()`, project reset,
  and `projectGeneration` changes are the state invalidation boundaries.
- `src/plugin.ts` stores the latest `BackendProjectState` but uses `.includes()`
  for config, tracked, and docgen membership.
- The same generation cannot be treated as proof of identical membership:
  WatchProgram or ProjectService may publish changed membership without a new
  project-resolution generation.
- `scripts/benchmark-playground.mjs` emits one-process, one-iteration JSON for
  `coldBatchMs`, `warmBatchMs`, and component-HMR timing/status. It constructs
  a direct plugin/server stub rather than a Vite `createServer()` instance.
- `scripts/compare-benchmark-results.mjs` accepts exactly five or ten
  independent samples per row, reports medians/MAD, rejects a regression over
  the supplied budget, and requests five more pairs when MAD exceeds 20%.
- Neither script currently proves pair order/identity or records a retained
  memory metric. Those are common harness prerequisites, not candidate changes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Harness self-tests | `node scripts/run-project-state-optimization.mjs --self-test`, `node scripts/compare-benchmark-results.mjs --self-test` | both exit 0 |
| Focused contracts | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | all pass |
| Typecheck/full/build | `yarn typecheck`, `yarn test --run`, `yarn build` | all pass |
| Smoke pair | `node scripts/run-project-state-optimization.mjs --baseline-worktree <absolute-baseline> --candidate-worktree <absolute-candidate> --output <durable-evidence-root> --start-index 1 --pairs 1` | complete manifest plus eight JSON reports |
| Primary pairs | same command with `--start-index 1 --pairs 5` and a new output root | exact five-pair manifest plus 40 JSON reports |
| Variance extension | same runner with `--resume-manifest <absolute-manifest-5.json> --start-index 6 --pairs 5 --output <same-durable-evidence-root>` | new `manifest-10.json`/`checksums-10.json`, 40 untouched primary reports, and 40 new reports |
| Paired comparison | `node scripts/compare-benchmark-results.mjs --baseline-dir <absolute-baseline-dir> --candidate-dir <absolute-candidate-dir> --manifest <absolute-manifest.json> --checksums <absolute-checksums.json> --max-regression 5 --max-memory-regression 10 --max-memory-growth-mib 8` | exit 0 before applying the keep threshold |
| Lint/whitespace | direct changed-file Biome check and `git diff --check` | exit 0 |

## Scope

**Candidate source/test scope**:

- `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`
- `packages/vite-plugin-react-docgen-typescript/src/plugin.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts`
  only if needed to prove same-generation membership replacement
- one patch `.changeset/*.md` only after a `KEEP` verdict

**Common harness/evidence scope**:

- `scripts/benchmark-playground.mjs`
- `scripts/run-project-state-optimization.mjs`
- `scripts/compare-benchmark-results.mjs`
- focused script tests under `scripts/__tests__/` if needed
- `docs/project-state-optimization-experiment.md`
- `plans/README.md` status only, maintained by the dispatching reviewer

The harness commit is shared unchanged by baseline and candidate. It may add
only manifest validation, awaited teardown, and the defined retained-heap
metric; it must not change fixtures, transform/HMR behavior, or timing
boundaries.

**Out of scope**:

- parser or docgen-output changes;
- dependency graph, persistent-cache, HMR delivery, watcher, or membership
  semantics;
- changing defaults, options, peer ranges, dependencies, or package exports;
- TypeScript 7/native work;
- retaining a neutral candidate because it looks cleaner;
- committing raw benchmark JSON, worktrees, installs, or archives.

## Git and evidence workflow

1. Freeze Plan 015 only after its final cold review and all required runtime
   gates pass. Record its full SHA as `P`.
2. Create a clean `codex/016-project-state-harness` worktree from `P`. Add and
   test only the common harness changes in Step 1, then commit them as
   `Add paired project-state benchmark controls`. Record the full SHA as `H`.
3. From `H`, create:
   - a detached clean baseline worktree;
   - `codex/016-cache-project-state` candidate worktree; and
   - `codex/016-project-state-verdict` verdict worktree.
4. Run `yarn install --immutable` and `yarn build` in baseline and candidate.
   Confirm `yarn.lock` remains unchanged.
5. Implement deterministic candidate tests first, then source changes. Commit
   the candidate as `Experiment with cached project state`. Record its full SHA
   as `C`. The only baseline/candidate package-source difference must be the
   in-scope candidate patch.
6. Store raw evidence under
   `<repository>/.yarn/plan016-evidence/<UTC-run-id>/`, which is ignored by Git
   but is not a temporary directory and must not be automatically deleted.
   Use separate `baseline` and `candidate` directories.
7. Retain that evidence until the resulting pull request is merged and its
   release verification completes. Cleanup requires an explicit maintainer
   action after the committed decision document contains the checksum-file
   SHA-256 and its manifest/report digest inventory.
8. Do not edit baseline or candidate between primary and variance samples.

## Steps

### Step 1: Build and freeze the common evidence harness

Before candidate work, update the direct-plugin benchmark and comparator on the
harness branch:

- `benchmark-playground.mjs` gains an explicit memory-measurement mode that
  requires `global.gc`, awaits `closeBundle`, forces GC at the defined
  steady-state point while the initialized plugin remains live, and emits
  `steadyStateHeapUsedBytes`. It must not move the existing cold, warm, or HMR
  timing boundaries. The exact sample point is after component-HMR status
  resolution completes and before `closeBundle`; forced GC and
  `process.memoryUsage()` sampling occur after the HMR timer stops and are
  excluded from every timing metric.
- `run-project-state-optimization.mjs` launches every measurement as a new
  `node --expose-gc` process, one mode per process. It owns pair, side, scenario,
  and mode ordering and writes a schema-versioned manifest containing `P`, `H`,
  `C`, clean-tree checks, lockfile hash, Node executable/version, OS/CPU,
  TypeScript/Vite versions, exact command, start/end time, and relative report
  path for each invocation.
- Immediately before capture, the runner executes immutable install and build
  in both measured worktrees, then records SHA-256 for the exact ignored
  `dist/index.mjs` files it will execute and the relevant Yarn install-state
  artifacts. It rechecks those hashes after capture and on variance resume;
  clean Git state alone is not artifact identity.
- The runner proves baseline `HEAD === H`, candidate `HEAD === C`, `H` is the
  sole parent of `C`, and `P` is the sole parent of `H`; it records full SHAs,
  never user-supplied labels alone.
- The runner resolves its own checkout through `import.meta.url`, requires that
  control worktree to be clean at `H`, and records hashes for runner,
  comparator, and benchmark scripts. Baseline/candidate benchmark-script bytes
  must equal the recorded `H` script. The comparator similarly self-attests at
  `H` and verifies all control/artifact hashes before producing rows.
- The runner rejects a dirty worktree, an unexpected SHA, mismatched lockfile or
  dependencies, non-`updated` HMR, missing/duplicate tuple, or failed process.
- After atomically writing a complete five- or ten-pair manifest, the runner
  writes the matching `checksums-5.json` or `checksums-10.json` containing
  SHA-256 for that manifest and every referenced raw report. The manifest does
  not reference the checksum file. Ten-pair files never replace five-pair
  files.
- Odd pairs run baseline then candidate; even pairs reverse sides. Scenario and
  mode order also reverse by pair parity.
- The comparator accepts `--manifest`, verifies exact
  `{pair, side, scenario, mode}` coverage and environment identity, then
  verifies the manifest/report bytes against `--checksums` before reading
  values. It includes retained heap in its median/MAD rows.
- Memory fails only when candidate median growth exceeds both 10% and 8 MiB,
  equivalently `growth > max(baseline * 0.10, 8 MiB)`.
- Self-tests prove duplicate/missing tuples, wrong order, SHA/lock/runtime
  mismatch, stale/foreign build output, install-state drift, modified control
  scripts, checksum mismatch, invalid sample count, timing regression, memory
  regression, and high MAD are rejected.

Commit `H` before creating baseline/candidate/verdict worktrees. Any later
harness edit invalidates all evidence and requires new worktrees and samples.

### Step 2: Lock the snapshot and index invariants

Add deterministic contracts before optimizing:

1. repeated state reads with no intervening membership/generation mutation
   return the same snapshot object;
2. every published array and snapshot is immutable to consumers;
3. a real membership change returns a different snapshot, including a change
   that can occur at the same project generation;
4. reset/reinitialization cannot reuse a stale snapshot;
5. the host replaces all three indexes when the snapshot object changes, even
   when `generation` is unchanged;
6. config, tracked, and docgen decisions observe the replacement immediately;
   and
7. repeated unchanged state does not rebuild host indexes.

Use observable backend/plugin behavior or a small private test seam. Do not
export compiler objects or a new public API merely to count internal work.

**Verify**: the identity/rebuild tests fail on the final Plan 015 baseline for
the expected allocation/linear-membership reasons, while all pre-existing
behavior tests pass.

### Step 3: Cache one immutable backend project-state snapshot

In `legacyBackend.ts`, retain a cached `BackendProjectState` and invalidate it
at every mutation boundary:

- any sync/clear of `projectConfigFiles`, `projectDocgenFiles`, or
  `projectTrackedFiles`;
- `projectGeneration` change;
- project-context clear/reset/dispose; and
- program-driven membership refresh, including same-generation changes.

`getProjectState()` may return the cached object only while none of those
boundaries has occurred. When rebuilding:

- normalize and sort each collection exactly as before;
- publish new arrays that are not subsequently mutated;
- freeze the arrays and outer snapshot, or provide an equivalently proven
  runtime immutability guarantee; and
- preserve byte-for-byte ordering and values.

An eager dirty mark is acceptable when a sync writes identical contents. A
stale snapshot is not.

Do not change compiler/project lifecycle, program reuse, dependency caches, or
generation semantics.

### Step 4: Replace host linear membership with snapshot-scoped indexes

In `plugin.ts`, route every project-state assignment through one private setter.
The setter must:

- compare snapshot object identity, not generation alone;
- on a new snapshot, replace config/docgen/tracked indexes with new normalized
  `Set` instances;
- on `undefined`, clear both state and all indexes; and
- leave indexes untouched for the same snapshot object.

Replace only membership `.includes()` calls with the corresponding `.has()`.
Keep arrays as the backend-neutral DTO and cache-proof input; do not expose
mutable sets across the backend seam.

Audit every current assignment from initialization, ready update, ignored
creation reinitialization, pending completion, analysis, project reset, and
teardown. A direct assignment bypassing the setter is a test failure.

### Step 5: Close deterministic correctness and lifecycle gates

Run the focused contracts, full suite, typecheck, build, direct non-writing
Biome on exact changed files, and `git diff --check`.

At minimum, the unchanged Plan 015 real-Vite contract must still prove:

- create/delete/recreate membership in same-project and referenced-project
  topologies;
- warm persistent-cache recovery;
- exact ordinary-edit selectivity;
- one logical revision across environments;
- no standalone-component broad invalidation; and
- clean watcher/backend teardown.

Also run the final Plan 015 packed lower and upper boundary rows against one
candidate archive. Both must retain all selected modes/topologies, three
dynamic-membership events, two ordinary edits, and zero watcher handles.

Any output, ordering, cache, HMR, membership, or teardown change is a STOP
condition.

### Step 6: Capture five alternating independent pairs

Run only on an otherwise idle machine. Close development servers and other
CPU-heavy work. Use the same Node executable and dependency lock in both
worktrees.

First run one smoke pair into its own evidence directory and validate it. It
does not count toward primary evidence.

Then have the frozen runner capture pair indices 1–5:

- odd pair: baseline then candidate; even pair reverses sides;
- odd pair: `large-project` then `large-design-system`; even pair reverses
  scenarios;
- odd pair: default then ProjectService; even pair reverses modes;
- invoke a new Node process for every side/scenario/mode tuple;
- use `--iterations 1` and exactly one mode per invocation; and
- write one manifest-owned JSON file per tuple.

Do not count an in-process iteration as an independent sample. Do not delete an
outlier or rerun only one side of a pair.

Run the manifest validator/comparator with the authored timing and memory
budgets. It must prove every baseline and candidate HMR status is `updated`.

If any decision row has MAD above 20% of its median, collect exactly five more
alternating pairs, indices 6–10, without changing code or environment. Use
`--resume-manifest` against the validated five-pair manifest and the same
evidence root. The runner must reject an unexpected existing report, duplicate
tuple, changed identity, any start index other than 6, or an attempt to
overwrite pairs 1–5. It writes reports 6–10 under a new extension directory,
then atomically creates `manifest-10.json` and `checksums-10.json`; it never
replaces `manifest-5.json`, `checksums-5.json`, or primary reports. The
comparator reads only manifest-owned report paths, not arbitrary directory
contents. Compare all ten. If collection fails, incomplete unreferenced
extension files may be preserved for diagnosis, while the original five-pair
manifest/checksums/reports remain valid and untouched; retry in a new evidence
root. If MAD still exceeds 20%, record `INCONCLUSIVE` and do not keep the
candidate.

The runner owns report/manifest checksums. Independently compute and record the
final `checksums-5.json` or `checksums-10.json` SHA-256 in the decision
document, avoiding self-reference.

### Step 7: Apply the ordered keep/reject verdict

Evaluate in this order:

1. **INCONCLUSIVE**: sample identity/count, status, correctness, lifecycle, or
   variance controls fail. Do not keep the candidate.
2. **REJECT**: any timing row regresses by more than 5%, retained heap exceeds
   its combined 10%/8-MiB budget, or the primary improvement threshold below is
   not met.
3. **KEEP**: all controls pass and ProjectService `coldBatchMs` improves:
   - at least 5% on both large fixtures; **or**
   - at least 10% on either large fixture,
   while every other measured row remains within the 5% regression budget.

The candidate-to-baseline delta is
`(candidate median - baseline median) / baseline median * 100`; improvement is
negative.

Write `docs/project-state-optimization-experiment.md` for every valid or
inconclusive outcome. Include:

- baseline/candidate full SHAs and exact diff scope;
- Node, TypeScript, Vite, OS, CPU, and lockfile identity;
- commands, order, sample count, and external raw-output paths;
- medians, deltas, and MAD for every scenario/mode/metric;
- HMR statuses and deterministic verification results;
- the ordered verdict and reason.

The verdict branch starts at `H` and is the only final integration target.

For `KEEP`, cherry-pick `C` onto the verdict branch, add a patch changeset and
decision document, rerun all deterministic gates, and commit as
`Keep cached project-state optimization`.

For `REJECT` or `INCONCLUSIVE`, do not cherry-pick `C`. Add only the decision
document on top of `H`, verify package source is byte-identical to `P`, and
commit as `Record rejected project-state optimization` or
`Record inconclusive project-state optimization`.

## Done criteria

- [x] Baseline package source is byte-identical to final cold-approved Plan 015
      commit `P`; its only additional commit is the shared harness commit `H`.
- [x] A frozen common harness commit validates exact pair identity/order,
      environment identity, executed artifact/control hashes, HMR status,
      content checksums, and retained heap.
- [x] Candidate changes only snapshot caching, membership indexes, and their
      deterministic tests.
- [x] Cached snapshots are immutable, invalidated at every state mutation, and
      reusable only while state is unchanged.
- [x] Host indexes replace on object identity, including same-generation
      membership changes, and clear on reset/teardown.
- [x] Plan 015 correctness, HMR, cache, packed-boundary, and teardown controls
      remain green.
- [x] Five valid alternating independent pairs exist, or ten after the one
      prescribed variance retry.
- [ ] Every measured row stays within the 5% regression budget. **Failed; the
      candidate was not integrated.**
- [x] Retained heap stays within `max(10%, 8 MiB)` growth.
- [x] A `KEEP`, `REJECT`, or `INCONCLUSIVE` decision record exists with exact
      evidence identity and SHA-256 checksums; raw evidence is durably retained
      through merge and release verification.
- [x] Optimization source remains in production only after `KEEP`; neutral,
      losing, or invalid evidence leaves Plan 015 source unchanged.

## STOP conditions

Stop and report if:

- Plan 015 has not received final cold approval;
- the candidate requires a backend API change or exposes mutable sets/compiler
  objects across the neutral seam;
- a state mutation cannot be paired with an explicit snapshot invalidation;
- correctness requires generation-only index identity;
- output, cache, project membership, HMR delivery, or teardown changes;
- the candidate needs benchmark/fixture edits after evidence collection starts;
- baseline and candidate cannot use identical dependencies and machine state;
- the manifest validator cannot prove exact tuple/order/SHA/runtime identity;
- a correctness/status gate fails;
- variance remains above 20% after ten pairs; or
- raw evidence or its checksum manifest is lost.

## Maintenance notes

- Snapshot object identity is now a private optimization contract. Generation
  remains a project-lifecycle value, not a complete membership version.
- Backend arrays remain the stable neutral DTO. Host indexes are derived and
  replaceable implementation details.
- If retained, future membership mutations must dirty the backend snapshot and
  replace the host indexes in the same change.
- Re-run this paired gate after material project-lifecycle or TypeScript
  upgrades; do not assume the win is permanent.
