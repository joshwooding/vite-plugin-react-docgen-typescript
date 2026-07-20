# Plan 008: Repair imported-type HMR in the legacy backend

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Use Plan 005 to identify symptoms, then implement only causal
> branches proven by this plan's isolation tests. If anything in the "STOP
> conditions" section occurs,
> stop and report — do not improvise. When done, update the status row for this
> plan in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ffd553b..HEAD -- packages/vite-plugin-react-docgen-typescript/src/plugin.ts packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts packages/vite-plugin-react-docgen-typescript/src/docgen/pathIdentity.ts packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/backendParityCorpus.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts .changeset/fresh-imported-type-hmr.md`
> Plans 004–006 intentionally create or change these paths first. Confirm all
> three are `DONE`, compare the live backend contract and Plan 005 ledgers with
> this plan, and STOP on any unrelated semantic drift. The changeset is expected
> not to exist.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/004-unify-project-file-selection.md`, `plans/005-lock-backend-hmr-contract.md`, `plans/006-introduce-docgen-backend-seam.md`
- **Category**: bug
- **Planned at**: commit `ffd553b`, revised 2026-07-20
- **Execution gate**: Mandatory while the legacy backend remains the default,
  an opt-in, or a documented rollback/supported path, regardless of Plan 007's
  verdict. It may run before or after the native spike. It can be superseded
  only by a separately approved production plan that both makes native the
  default and formally repairs or removes legacy support; the feasibility
  spike and an opt-in native release cannot waive this plan.

## Why this matters

[Open issue #57](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/issues/57)
reports that editing imported props types leaves Storybook controls stale until
the component itself is touched. Plans 005 and 006 deliberately separate the
observable Vite contract from compiler-specific lifecycle, so this repair can
change only the layer proven wrong: legacy dependency discovery/path identity,
legacy compiler freshness, Vite delivery, or a combination.

A successful non-shipping native spike does not fix the default backend or
close the issue. While legacy remains supported in any role, this plan removes
every legacy known-failure ledger entry and remains the issue's release-ready
resolution.

## Current state after Plans 004–006

- `packages/vite-plugin-react-docgen-typescript/src/plugin.ts` owns Vite hooks,
  transform caches, the component-to-dependency/reverse dependency index,
  warning deduplication, code generation, affected-node return/delivery, and
  the Vite-core module-invalidation contract.
- `src/docgen/legacyBackend.ts` owns TypeScript project/config resolution,
  default/watch/project-service state, parsing/targets, exact dependency paths,
  update readiness, resets, and disposal.
- `src/docgen/backend.ts` expresses `ready`, `pending`, `project-reset`, and
  `ignored` update outcomes without exposing Vite objects. This contract should
  already be sufficient; changing it is a STOP-and-review event.
- `src/__tests__/viteHmr.contract.test.ts` runs same-project and referenced-
  project imported props through Vite's public watcher pipeline. Its exact
  failure ledger names delivery, invalidation, freshness, and delivery/
  invalidation selectivity per edit. Graph identity, initial metadata, recovery,
  hot errors, rejected cycles, and cleanup are hard controls, not allowlists.
- `src/__tests__/backendParity.test.ts` locks legacy metadata, target,
  dependency, project membership, option, and lifecycle behavior.
- Plan 006 preserved current HMR observations intentionally. Do not treat the
  mere existence of a ledger entry as permission to implement every hypothesis
  below; use the observation and focused tests to select the causal branch.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Planned baseline | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | Passes with the exact reviewed eight-row Plan 005 legacy ledgers before implementation |
| Backend focus | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts -t "dependency|update|fresh|identity|isolation" --testTimeout=60000` | New causal isolation tests fail before their selected branch is fixed, then pass |
| HMR resolution | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | Every fixed legacy row has empty actual/expected failures and passes two dependency-only edits |
| Existing integration | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts` | Existing cache, mode, target, selection, and snapshot cases pass unchanged |
| Full tests | `yarn test --run` | All tests pass without open handles |
| Typecheck | `yarn typecheck` | Exit 0, no errors |
| Build | `yarn build` | Package builds successfully |
| Benchmark smoke | `yarn benchmark:ci` | All scenarios/modes complete; this command is smoke only and is not the freshness/selectivity gate |
| Ledger scan | `rg -n ':\s*\[\s*["'']' packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts` | No output and expected `rg` exit 1; the fixed-matrix contract test is the authoritative empty-ledger gate |
| Whitespace check | `git diff --check` | Exit 0 |
| Scope check | `git status --short` | Only selected in-scope source/tests, any causally required dependency-only corpus rows, the changeset, and plan-index status update appear |

No dependency or lockfile change is expected. The current Windows checkout has
a known line-ending-only Biome baseline: full `yarn biome:ci` exits 1 with 16
pre-existing `format` diagnostics. Changed-file Biome and `git diff --check`
must exit 0; Linux CI must remain fully green.

## Scope

**In scope** (modify only the files selected by the proven branch):

- `packages/vite-plugin-react-docgen-typescript/src/plugin.ts`
- `packages/vite-plugin-react-docgen-typescript/src/docgen/pathIdentity.ts` — only if the identity isolation test selects that branch
- `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/backendParityCorpus.ts` — only if Step 2 proves an existing exact dependency expectation omitted a semantically influencing path; change only those dependency fields
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts` — only replace legacy ledger arrays with `[]`
- `.changeset/fresh-imported-type-hmr.md` — create

**Read-only contract/support files** (changing any is a STOP condition):

- `packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts`

**Out of scope**:

- File include/exclude or project membership semantics; Plan 004 owns them.
- Weakening the Plan 005 contract, changing its failure-code computation, or
  deleting a scenario instead of making it pass.
- A native backend, TypeScript 7 unstable API dependency, public backend
  selector, peer range, parser option, package export, or changeset for
  experimental work.
- File create/delete handling or Vite's environment `hotUpdate` hook.
- Storybook, Nx, browser automation, private Vite APIs, or broad invalidation of
  every transformed component.
- Persistent-cache schema/lifecycle work unrelated to deleting the exact
  affected component entries.

## Git workflow

- Branch: `codex/008-repair-legacy-imported-type-hmr`
- Start from completed Plans 004–006. If Plan 007 ran first, rebase its decision
  record only; do not import prototype-native code into this repair.
- Make one logical bug-fix commit with a title-style subject, for example
  `Fix imported type HMR refresh`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Re-run the contract and write a causal branch table

Run Plan 005's full contract three times on the same checkout. The normalized
determinism signatures and ledgers must be identical. Treat its named delivery,
invalidation, freshness, and selectivity failures as symptoms, not proof of a
layer. Before production edits, add this ordered isolation sequence using the
Plan 006 factory seam:

1. **Direct backend, host caches bypassed**: initialize the real legacy backend,
   analyze the dependent, apply each props-file update with exact source and
   revision, await readiness, and analyze again. Record exact dependencies and
   both metadata revisions. Missing dependencies selects Step 2; complete
   dependencies plus stale direct metadata selects the compiler portion of
   Step 3.
2. **Fresh fake backend through the real host**: return complete dependencies
   and distinct fresh metadata for two revisions while exercising memory and
   persistent cache deletion. If the host still returns old metadata, select
   only the host-cache portion of Step 3.
3. **Fake backend plus real-shaped module graph**: return exact dependencies and
   inspect, separately per revision, reverse-index lookup, dependent/unrelated
   invalidation counts, and dependent/unrelated delivery counts. A missing
   lookup with exact dependencies selects the comparison-key portion of Step 2;
   correct lookup/invalidation but wrong delivery selects Step 4; unrelated
   lookup identifies the exact reverse-index/selectivity branch.

Every isolation probe must produce a determinate pass/fail result. A healthy
layer is expected to pass and receives no speculative production edit; only a
failing named transition gets a regression assertion and implementation
change. Different modes or transitions may prove more than one independent
fault. After each correction, rerun the full ordered sequence so a repaired
upstream layer cannot hide a downstream fault. Use public host/backend inputs
and observable outputs; do not expose private production state solely for a
test. Record an evidence table mapping every Plan 005 symptom to each probe's
result and one or more causal branches (or “resolved by upstream causal fix”)
in the commit/PR notes.

Missing actual hot delivery remains a legitimate delivery failure even when a
forced transform is fresh and selects Step 4. STOP for a Storybook-faithful
probe only if actual hot delivery and normal transformed metadata are both
correct and the sole difference is the directly observed hook-return shape.

**Verify before implementation**:
Focused isolation tests classify every named transition and identify one or
more independently proven faulty layers without ambiguity; three baseline
contract runs produce identical normalized determinism signatures. STOP if a
failing transition cannot be assigned to a layer with the existing seam before
editing production code.

### Step 2: Correct only proven dependency discovery or identity failures

Skip this step if Step 1 shows that the legacy backend returns the complete
dependency set and the host finds the dependent graph node.

When dependency discovery is incomplete:

- resolve imports/type references using the active program's
  `getCompilerOptions()` and `getCurrentDirectory()`, not root-project options
  assumed to apply to a referenced program;
- keep resolution cache pairs per active Program in a `WeakMap`, constructed
  with that program's directory/options, and discard them with the program;
- preserve Plan 006's exact closure over active tracked files: exclude
  TypeScript default libraries and unreachable/unrelated files, but retain
  relevant external declarations (`node_modules/@types`, React) and linked/
  workspace package sources that influence extraction; and
- keep dependency arrays available on no-component and recoverable-error
  results.

When—and only when—the module-graph isolation proves path identity diverges,
extend Plan 006's shared `pathIdentity.ts` with a separate Node-only comparison
key:

- define one Node-only canonical comparison key available before compiler
  initialization: `path.resolve`, then `realpathSync.native` for an existing
  path, then Vite-style forward-slash normalization; fall back to normalized
  resolved path when realpath fails;
- leave the backend's raw dependency DTO paths unchanged and derive the same
  comparison key only when the host inserts into or queries its reverse index;
- retain separate original/resolved paths for transform-cache deletion and
  Vite module-graph lookup—never lowercase or rewrite the path handed to Vite;
  and
- add Windows separator plus symlink/case cases only when the current platform
  proves those divergences.

Do not make every component depend on every project file. The Plan 005
unrelated-component requirement and benchmark selectivity are hard gates.

If—and only if—the pre-fix direct-backend isolation plus the corpus fixture
proves an existing exact dependency golden omitted a source that actually
influences its metadata, migrate that corpus row in the same commit. Record the
old/new tokenized dependency arrays and the causal import/type path. Change only
the affected row's dependency fields; metadata, targets, ordering, options,
project state, and unrelated rows remain byte-for-byte unchanged. Add a
negative assertion that the unrelated component/path remains absent. A broad or
unexplained golden update is a STOP condition, not an invitation to regenerate
the corpus.

**Verify**:
Focused dependency/identity tests pass; returned dependencies contain the
component and exact imported/transitive props paths, exclude the unrelated
component, and the host locates the existing dependent `ModuleNode`.

### Step 3: Correct only proven legacy compiler/cache freshness failures

Skip mode branches whose two normal post-edit transforms are already fresh.

For every affected component, delete both its in-memory transform entry and its
exact persisted cache entry before Vite can request it again. Preserve unrelated
cache entries.

Then fix only the stale runtime modes:

- **Default builder**: preserve the reusable builder design, but invalidate the
  program state needed for the next analysis and prove the replacement Program
  contains the edited dependency text before returning `ready`.
- **Watch**: retain the backend contract's `pending.ready` barrier. It resolves
  only after the watch Program contains every changed file's current contents;
  only the latest `ready` generation may delete affected transform/cache
  entries and return modules for Vite core to invalidate. An older completion
  resolves `superseded`, performs no host action, and contributes its affected-
  component set to the newer generation's carried-forward union; disposal
  resolves pending work as `disposed` and performs no host action. If the
  isolation sequence proves that Vite must receive modules from the same hook
  cycle, this plan explicitly authorizes the async `handleHotUpdate` hook to
  await backend readiness, delete only host transform/cache entries, and return
  the affected nodes without module-graph pre-invalidation. A callback cannot
  “return later” after the hook has finished;
  do not use a late-send workaround, fixed delay, or production timeout. The
  contract's 10-second phase deadline is test infrastructure only.
- **Project service**: refresh only non-closed owning projects associated with
  the changed dependency/affected components. Invalidate stale file-to-project
  associations before update, temporarily open/close the changed dependency
  only when required, and keep full `reloadProjects()` as a tested fallback—not
  the normal edit path. Do not recreate the service per change.

Run two successive imported props edits in each changed mode. Each ordinary
analysis/transform must contain its distinct union and JSDoc value without
component-source changes. Assert unrelated analysis/cache remains untouched and
teardown has no pending work. Add an overlapping-update test in which the older
revision completes after the newer request, plus disposal during pending work;
assert superseded/disposed outcomes trigger no invalidation or delivery and the
latest ready generation carries the union of affected components from both
revisions exactly once.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts -t "fresh|update|imported type|isolation" --testTimeout=60000`
→ each implemented mode sees both edits, unrelated work is retained, and
disposal is clean.

### Step 4: Correct Vite delivery only when the real contract proves it causal

Skip this step if Vite already delivers the dependent and only freshness/
identity failed. Also skip it when correcting the causal backend branch makes
the full delivery requirements pass without a hook-return change.

If actual hot delivery remains missing after fresh metadata is proven, make the
host's affected-module lookup return every real dependent `ModuleNode`,
deduplicated by object identity, without calling any environment or legacy
compatibility module-graph `invalidateModule` method itself. In
`handleHotUpdate`, union those dependent nodes with `context.modules` and
preserve normal Vite modules rather than replacing them. Vite core owns the one
client-environment module-graph invalidation after the hook returns; the host
still deletes its own affected transform/cache entries.

Required semantics:

- dependency updates return only affected dependent components plus existing
  context modules;
- dependency updates never pre-invalidate returned module nodes; Plan 005
  observes exactly one Vite-core invalidation per dependent;
- watch-mode nodes are not exposed for retransformation until backend readiness
  has completed;
- irrelevant files with no context/dependent modules return `undefined`, never
  an empty array that suppresses Vite handling;
- config resets preserve the existing full invalidation behavior; and
- unrelated components are absent.

Extend `backendContract.test.ts`/`index.test.ts` with a complete public
`HmrContext`: `file`, `timestamp`, `modules`, `read`, and `server`. Assert the
dependent appears exactly once, the unrelated node is absent, and an original
component `context.modules` entry survives. The real Plan 005 pipeline remains
authoritative; a mocked nonempty return alone is insufficient.

**Verify**:

1. Direct host tests pass with exact module unions.
2. The real contract observes the dependent exactly once, no unrelated
   component, and fresh metadata on both edits.

### Step 5: Remove every proven legacy ledger entry

In `support/legacyHmrExpectations.ts`, replace every one of the eight fixed
legacy row arrays with `[]`. This is the only Plan 005 file this plan may edit.
Do not change the registration matrix, helper, topology, controls, row-key
meta-test, failure calculation, or expected/actual comparison. Run both
topologies in default, watch, project-service, and both-flags precedence modes.

Every row must now satisfy:

- no infrastructure errors;
- dependent graph identity present;
- exactly one dependent and zero unrelated deliveries/invalidations;
- first and second dependency-only edits produce their fresh union and JSDoc;
- component-touch recovery remains fresh; and
- server/backend disposal leaves no handle.

If a row still has a failure, return to the proven branch; never leave a
different allowlist merely to make CI pass.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000`
→ the fixed-key meta-test passes and all eight legacy
`actualSemanticFailures`/expected arrays are empty.

### Step 6: Add a patch changeset

Create `.changeset/fresh-imported-type-hmr.md` with exactly one patch entry for
`@joshwooding/vite-plugin-react-docgen-typescript`. State the user-visible
outcome: edits to imported TypeScript props refresh dependent component docgen
metadata through Vite HMR, including the verified referenced-project/project-
service topology. Mention only causal branches actually implemented; do not
claim an identity, delivery, or lifecycle fix that tests disproved. Do not edit
`CHANGELOG.md` directly.

**Verify**:
`Get-Content -Raw .changeset/fresh-imported-type-hmr.md`
→ frontmatter contains only the plugin package at `patch`, followed by a concise
user-facing summary.

### Step 7: Run repository-wide verification

Run, in order:

1. full Plan 005 HMR contract with `--testTimeout=60000` (the authoritative
   freshness, delivery, invalidation, and selectivity gate)
2. focused backend contract/parity tests
3. existing `index.test.ts` and Plan 004 selection tests
4. `yarn typecheck`
5. `yarn test --run`
6. `yarn build`
7. `yarn benchmark:ci` as a completion/performance smoke test only; it does not
   fail on stale HMR and is not a correctness oracle
8. Biome on every changed TypeScript file
9. `yarn biome:ci` on Linux CI; apply the documented Windows baseline locally
10. the empty-ledger scan (expected no output and `rg` exit 1)
11. `git diff --check`
12. `git status --short`

Expected: all eight legacy HMR rows have an empty ledger and two fresh selective
edits; metadata/target/project parity remains unchanged, with at most the
causally proven dependency-only corpus rows migrated; all tests/builds and
benchmark smoke completes without open handles; no dependency/lockfile/public API
change occurs; and only selected in-scope files, the changeset, and plan-index
status update are modified.

## Test plan

- Use Plan 005's real Vite pipeline as the acceptance oracle; direct tests only
  localize the causal layer.
- Keep same-project and real referenced-project topologies.
- Require two dependency-only edits, updated union and JSDoc, exact dependent
  delivery, and unrelated exclusion in every legacy mode.
- Add only branch-specific backend/host tests selected by observed failures.
- Preserve canonical legacy metadata, targets, dependencies, parser options,
  project membership, caches, and runtime-mode precedence.
- Exercise repeated update/reset/disposal without open handles.

## Done criteria

- [ ] Deterministic Plan 005 symptoms are each mapped to an isolation test that
      proves every implemented causal branch.
- [ ] Every legacy HMR row now has empty actual and expected failure arrays.
- [ ] Two imported-type edits produce fresh union and JSDoc metadata without
      touching component source.
- [ ] Dependent components are delivered/invalidated once; unrelated components
      and cache entries remain untouched.
- [ ] Any canonical identity stays separate from Vite-facing and cache paths;
      any resolution caches are scoped to the active Program/options.
- [ ] Changed watch/project-service/default lifecycle paths are fresh and close
      without pending work; superseded/disposed work has no host side effects,
      and the latest ready generation carries all affected components.
- [ ] Both experimental flags retain project-service precedence.
- [ ] No backend contract, HMR helper/matrix, selection semantics, public API,
      dependency, lockfile, native code, or existing output snapshot changes;
      only the legacy expectation arrays change in the Plan 005 oracle, plus
      narrowly proven dependency fields in the parity corpus when Step 2
      actually corrects an omitted influencing dependency.
- [ ] A precise patch changeset exists; `CHANGELOG.md` is untouched.
- [ ] Focused tests, full tests, typecheck, build, benchmark, formatting, Linux
      CI, and scope gates pass.
- [ ] Issue #57 can be closed only after this fix is released, or after a
      separately approved production plan formally removes legacy support and
      ships an equivalent native resolution—not merely when tests land.
- [ ] `plans/README.md` marks Plan 008 `DONE`, unless the dispatching reviewer
      explicitly owns the index update.

## STOP conditions

Stop and report if:

- Plans 004–006 are incomplete, Plan 005 observations are nondeterministic, or
  the backend contract/helper drifted.
- All eight Plan 005 baseline ledgers are already empty and no isolation probe
  fails; do not manufacture a production diff or changeset without a reproduced
  release bug.
- Actual hot delivery and normal transformed metadata are both correct after
  dependency-only edits, and only the directly observed hook-return shape
  differs. Missing actual delivery remains an authorized Step 4 failure.
- Initial metadata or component-touch recovery is stale, or the fixture leaks
  infrastructure handles.
- The required fix cannot be mapped by isolation to a named identity/dependency,
  freshness/cache, delivery, or selectivity transition.
- Correctness requires changing Plan 004 selection, the Plan 006 backend
  contract, public options/exports, a dependency/lockfile, or native code.
- A canonical key would change Vite-facing IDs, broad invalidation is required,
  or unrelated components cannot remain cached.
- A dependency-corpus change would touch metadata/targets/options/project state,
  unrelated rows, or cannot be tied to an omitted semantically influencing
  path proven by Step 1.
- Watch/reference correctness would claim ownership of a file absent from the
  active compiler project.
- A verification fails twice after one focused correction.

## Maintenance notes

- Manual Vite invalidation, hot-update delivery, dependency identity, transform
  cache freshness, and compiler freshness are separate concerns. Keep their
  tests separate even when one patch touches multiple proven layers.
- Preserve the reverse dependency index's selectivity. Invalidating every
  transformed component would hide future dependency bugs and erase the value
  of both legacy and native backends on large Storybooks.
- Keep the legacy HMR contract for as long as the legacy backend is shipped or
  supported. Native opt-in or default status does not waive its correctness
  gate; only a separately approved formal removal can retire it.
- A future Vite environment-API migration should reuse the same two-edit
  contract rather than replacing it with framework-specific tests.
