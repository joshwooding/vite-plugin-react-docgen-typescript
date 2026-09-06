# Plan 019: Copy canonical project membership without another cache

## Status and objective

- Priority: P2; effort: S (hours); risk: LOW; category: simplification / perf.
- Depends on: none. Status: DONE — verified in an isolated worktree; integrated locally at `6eeed0e`.
- Planned at: `a360aca38a57b33bc1b08913eeff37216991cfa4`, 2026-09-05.
- Reconciled at: `1565001bb27c4cc6ea23779a2bfe749a8757892b`, 2026-09-05.

Remove repeated physical path resolution and sorting from project-state
materialization. Keep fresh arrays and the current ownership contract. This
should be a very small cleanup, not a new optimization architecture.

## Previous decision that must be preserved

An older candidate cached frozen project-state objects and added host membership
indexes. It was not integrated after an INCONCLUSIVE experiment. Retrieve the
historical record with:

```sh
git show 5163c906efae73f782886e6ecaa7ce7953d9bdbc:docs/project-state-optimization-experiment.md
```

The historical ten-pair comparison retained excessive variance and did not meet
its keep threshold. Do not cherry-pick candidate `129d23e`, add a frozen cached
snapshot, introduce dirty flags or membership indexes, or claim that operation
counts establish elapsed-time improvement. This plan removes work while adding
no persistent state.

## Scope and drift check

```sh
git diff --stat 1565001..HEAD -- packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts
```

Only modify `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`
and the index status. A patch changeset may be added if preparing a release.
No plugin-side changes, cache changes, DTO changes, runtime changes, dependency
upgrades, or new production helpers. If plan 018 has landed, compare the
membership code below and preserve its dependency fixes.

Use `codex/019-copy-canonical-membership` in an isolated worktree. Match the
sentence-case commit style, for example `Avoid renormalizing project snapshots`.
Do not push, merge, modify old worktrees, or delete experiment evidence.

Execution base is the approved Plan 018 result `1565001`, which also contains
Plan 017. The isolated destination is
`.yarn/.codex-worktrees/plan019/vite-plugin-react-docgen-typescript`; preserve
that basename for path-sensitive existing tests. No source changes occur in
the main checkout or earlier worktrees. This is source-only cleanup, not a
release preparation; no additional changeset is needed.

Drift reconciliation found Plan 018 dependency changes in the same file, but
the membership getter and all ingestion/reset sites remain unchanged. The
reviewer verified every set reference: additions flow through `syncFiles`,
and lifecycle reset directly clears the sets. Preserve the dependency changes.

## Current state

`legacyBackend.ts:1033` already normalizes, deduplicates and sorts inputs before
inserting them into each set:

```ts
const syncFiles = (target: Set<string>, fileNames: Iterable<string>) => {
  target.clear();
  for (const fileName of normalizeBoundaryPaths(fileNames))
    target.add(fileName);
};
```

`getProjectState` immediately repeats that work for every snapshot:

```ts
const getProjectState = (): BackendProjectState => ({
  configFiles: normalizeBoundaryPaths(projectConfigFiles),
  docgenFiles: normalizeBoundaryPaths(projectDocgenFiles),
  generation: projectGeneration,
  trackedFiles: normalizeBoundaryPaths(projectTrackedFiles),
});
```

All writes to those three sets currently flow through `syncFiles` or the clears
in `clearProjectContext` at `:1299`. `normalizeBoundaryPaths` in
`docgen/pathIdentity.ts` calls synchronous realpath resolution for each path.
The sets' insertion order is therefore already deterministic.

The desired code shape is the same fresh object with fresh array copies:

```ts
const getProjectState = (): BackendProjectState => ({
  configFiles: [...projectConfigFiles],
  docgenFiles: [...projectDocgenFiles],
  generation: projectGeneration,
  trackedFiles: [...projectTrackedFiles],
});
```

Keep normalization at ingestion. A short comment explaining that `syncFiles`
owns canonical ordering is appropriate. Do not also optimize collectors or
change symlink handling; that would broaden the change.

## Commands and steps

Run from the implementation worktree root. Existing dependencies can be used;
use `yarn install --immutable` only if a new worktree needs installation.

For this worktree, use the already installed ancestor binaries when Yarn's
install state is absent. From the implementation root:

- Tests: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs`
  followed by the test arguments below.
- Typecheck: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json`.
- Lint: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/@biomejs/biome/bin/biome ci packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`.

The executor runs focused tests/typecheck/lint and then freezes the source.
The reviewer runs the full suite once, independently verifies the done
criteria, and authorizes the isolated commit after checks pass. Do not
duplicate the full run. Existing behavioral tests plus independent source
review are proportionate for this three-expression change; no new test
harness or external review service is required by this plan.

1. Verify every mutation site before editing:

   `rg -n 'syncFiles|projectConfigFiles\.|projectDocgenFiles\.|projectTrackedFiles\.' packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`

   Expected: additions only through normalized `syncFiles`, with direct clears
   in lifecycle reset. If another mutation exists, stop and reconcile rather
   than adding another invalidation mechanism.
2. Change only the three snapshot array expressions, preserving fresh copies.
   Verify `yarn typecheck` exits 0 and `git diff --stat` shows the narrow scope.
3. Run existing behavioral coverage:

   `yarn test run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --exclude '**/.yarn/**' --pool=threads --maxWorkers=2`

   Expected: all pass, covering sorted canonical paths, referenced membership,
   resets, newly created files, persistent-cache parity and HMR. Use existing
   tests; do not add implementation-mirroring tests or a large snapshot harness
   for a three-expression cleanup. If a missing behavioral contract becomes
   necessary, report it before expanding scope.
4. Run:

   - `yarn test run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2`
   - `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`
   - `git diff --check`

   Expected: all exit 0. The reviewed Plan 018 baseline is 289 tests. Read the
   final diff and update the index (the advisor owns index edits).

## Done criteria and stop conditions

- The snapshot getter performs no path normalization or sorting.
- Normalization at all set-ingestion boundaries remains intact.
- Every call still returns independent arrays; no shared mutable array leaks.
- Full existing tests, typecheck, changed-file lint and whitespace pass.
- No cached snapshot, dirty flag, new index or public contract was introduced.

Stop if set contents/order are not canonical at ingestion, if preserving path
semantics requires a broader change, or if tests show changed membership or
metadata. Do not advertise a timing percentage without a separately measured
comparison using plan 020's repaired harness. Future direct set writes must
honor canonical ordering; the ownership comment should make that explicit.

## Execution result

Completed on 2026-09-05 at `2f7d6a9aaaf600d1fa310ce47e6f372a6cc03a0a`
on branch `codex/019-copy-canonical-membership`, based on approved Plan 018
commit `1565001bb27c4cc6ea23779a2bfe749a8757892b`.
Worktree: `D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan019/vite-plugin-react-docgen-typescript`.

The source diff is one file, four insertions and three deletions: the three
membership arrays now copy their canonical sets, with a short ownership
comment. Independent review checked every set reference and confirmed that
normalization, deduplication and ordering remain at ingestion. Every getter
call still creates independent arrays. No snapshot cache, dirty flag, index,
helper, public contract, changeset or new test was added.

Verification against the frozen source:

- Executor focused contracts: four files, 122 tests passed (52.01s).
- Reviewer full suite: ten files, 289 tests passed (106.14s).
- Executor and reviewer typecheck, scoped Biome and whitespace checks passed.
- Independent source review found no actionable issue. No external review
  service or new test harness was needed for the three-expression cleanup.
- The full suite marked the existing snapshot dirty through an EOL/index
  artifact only; its diff was empty and normalized blob matched HEAD
  (`be29172562fb6497b81d0a554e96f3ae0b311aac`). Snapshot content was unchanged.

No benchmark was run and no elapsed-time gain is claimed. Plan 020 must repair
measurement accounting before timing comparisons. The isolated commit is
unsigned; it has not been merged or pushed, and the main source checkout is
unchanged.
