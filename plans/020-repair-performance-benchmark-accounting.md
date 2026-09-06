# Plan 020: Repair benchmark accounting and add restart coverage

## Status and objective

- Priority: P2; effort: M (roughly a day); risk: LOW; category: tests / perf.
- Depends on: none. Status: DONE — verified in an isolated worktree; integrated locally at `6eeed0e`.
- Planned at: `a360aca38a57b33bc1b08913eeff37216991cfa4`, 2026-09-05.
- Reconciled at: `2f7d6a9aaaf600d1fa310ce47e6f372a6cc03a0a`, 2026-09-05.

Measure all affected HMR work, await cleanup, reject stale results, and expose
the persistent-cache lifecycle. Keep this an extension of the current direct
plugin benchmark. It is not a replacement for real-Vite contract tests or an
invitation to create another benchmark framework.

## Scope, drift check, and workflow

```sh
git diff --stat 2f7d6a9..HEAD -- scripts/benchmark-playground.mjs package.json benchmarks/fixtures
```

Only modify:

- `scripts/benchmark-playground.mjs`
- `scripts/__tests__/benchmark-playground.test.ts` (new, focused harness tests)
- `benchmarks/fixtures/react-typing/` (new compact realistic fixture)
- `package.json`, only to fix the existing stale `benchmark:playground` path
  or add a benchmark smoke invocation if required.
- `plans/020-benchmark-verification.md` (short execution evidence) and index status.

No package runtime code, dependency upgrades, lockfile changes, publishing,
release/security workflow changes, or edits to existing fixture semantics.
Use `codex/020-repair-performance-benchmarks` in an isolated worktree. Make
small sentence-case commits; do not push/merge or overwrite existing evidence.

Execute from approved Plan 019 commit `2f7d6a9`, which includes Plans 017 and
018, in `.yarn/.codex-worktrees/plan020/vite-plugin-react-docgen-typescript`.
Keep that basename for existing path-sensitive tests. Drift review confirmed
no changes to the benchmark, package scripts or fixtures since the planned
base; every finding below remains present. The advisor owns all plan/index
edits and verification notes; the executor edits only the scoped source and
fixture files. Leave the main checkout and earlier worktrees unchanged.

## Current state and conventions

At `scripts/benchmark-playground.mjs:537`, the harness ignores the hook result:

```js
await plugin.handleHotUpdate?.({
  file: workspace.changedFile,
  modules: [{ file: workspace.changedFile, id: workspace.changedFile }],
  server,
});
```

The real plugin returns affected modules at `src/plugin.ts:926`. The fake
server only records explicit `invalidateModule` calls. If that set is empty,
`:431` transforms only the changed file. HMR time and affected counts therefore
omit work. `:553` records `stale` but `main` still exits successfully.

`warmMode` at `:500` and `measureModeIteration` at `:565` call asynchronous
`closeBundle` without awaiting it. `createModeConfig` at `:383` never enables
`fileSystemCache`; `:524/:528` simply transform twice on the same instance.
The current warm metric is in-memory reuse, not a persistent restart. The
unmeasured `warmMode` call also loads compiler code into the same process;
it must not run before samples advertised as a fresh-process restart.

Temporary fixtures at `:323` exclude node_modules. The two large scenarios use
minimal JSX shims. A representative fixture must have resolvable real React
declarations before its timing is accepted. Root dependencies already include
React, @types/react, TypeScript and Vite; no new dependency is required.

Follow existing script style: ESM, small named functions, builtin Node APIs,
JSON reports and temporary-workspace cleanup in `finally`. For tests use Vitest
as in `scripts/__tests__/snapshot-workflow.test.ts`, but test behavior with a
fake plugin rather than matching source strings. Expose only the minimal
script helpers needed for tests and guard the CLI entry point so importing the
module does not execute a benchmark. Do not introduce a reusable runner layer.

## Commands

| Purpose | Command | Expected |
| --- | --- | --- |
| Harness tests (new) | `yarn test run scripts/__tests__/benchmark-playground.test.ts --exclude '**/.yarn/**' --pool=threads --maxWorkers=2` | All pass after implementation |
| Full suite | `yarn test run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2` | All pass |
| Typecheck | `yarn typecheck` | Exit 0 |
| Build | `yarn build` | Exit 0 in implementation worktree |
| Existing smoke | `node scripts/benchmark-playground.mjs --scenario large-project --iterations 1 --modes default,projectService` | All HMR statuses updated, exit 0 |
| Watch smoke | `node scripts/benchmark-playground.mjs --scenario playground --iterations 1 --modes watch` | Updated, clean awaited teardown |
| Lint | `yarn exec biome ci scripts/benchmark-playground.mjs scripts/__tests__/benchmark-playground.test.ts` | Exit 0 |
| Whitespace | `git diff --check` | Exit 0 |

The new flags below are proposed and must be implemented/tested before use.
If a fresh worktree needs dependencies, use `yarn install --immutable`; stop
if unavailable. Do not mistake the historical Plan 016 runner, absent at this
HEAD, for an existing command.

This nested worktree can use the installed ancestor dependencies without a
fresh installation. Use these concrete local equivalents if Yarn's install
state is unavailable:

- Tests: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs`
  with the prescribed test arguments.
- Typecheck: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json`.
- Build: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs`
  from the worktree's `packages/vite-plugin-react-docgen-typescript` directory.
- Lint: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/@biomejs/biome/bin/biome ci`
  with the changed files as arguments.

The executor runs regression proofs, focused tests, typecheck, build, scoped
lint and all smoke scenarios, then reports SOURCE FROZEN before committing.
The advisor independently reviews the full diff, reruns the done criteria and
executes the full suite once. Do not duplicate the full-suite run. Use only
one structured closeout review, with follow-up reviews if an accepted finding
requires a scoped correction. Commit only after the advisor's approval; the
isolated commit may disable unavailable signing for that one command without
changing Git configuration.

## Steps

1. Add fake-plugin harness tests: a hook returns two affected modules without
   calling `invalidateModule`; a hook explicitly invalidates a module; a hook
   returns undefined; transformed metadata remains stale; asynchronous teardown
   has not yet completed. Verify the new harness-test command fails on each
   relevant current bug rather than setup errors.
2. Use the returned affected-module list when provided; otherwise use the
   incoming-module fallback, combining any explicitly invalidated modules and
   deduplicating by file identity. Preserve an explicit empty list rather than
   treating it as undefined. Ensure all selected component files are transformed
   before stopping HMR timing. Report affected count and freshness separately.
   Await teardown in both `finally` blocks before restoring the edited fixture
   or deleting the workspace, and propagate correctness/teardown errors to
   process failure. Verify all harness tests pass and existing smoke
   commands still produce fresh metadata. Label timings as direct-plugin data.
3. Add proposed flag `--cache off|populate|restart`, default `off`.
   `populate` measures a new instance with an empty isolated persistent cache;
   `restart` seeds and fully closes an instance in a separate child process,
   then measures a new instance using the same directory in the measurement
   process. A small internal seed-only invocation of this script is sufficient;
   do not add a worker framework. Keep component paths and configuration fixed
   across seed/restart. Do not call `warmMode` or start a compiler backend in the
   measurement process before its first measured batch. Seeding, clearing and
   teardown are outside the measured cold batch. Clear independent iterations so
   requested lifecycle is reproducible. Keep `warmBatchMs` as same-instance
   memory reuse and add a cache-state label to JSON. Also record `sessionTotalMs`
   from immediately before config setup through the identical first/warm/HMR
   workload and awaited close; exclude seed-process, fixture copy and restore
   time. This gives a matching whole-session cost for all three cache states.
   Cache writes are synchronous today, but close must still be included in this
   total. Record build/source identity, relevant dependency versions, parser
   options, scenario/scale, mode and whether a sample is the process's first
   measured instance. Bump the report schema because cold-sample warm-up changed;
   reject old baseline reports rather than silently comparing unlike metrics.
   Verify harness tests establish instance counts and ordering, then run each
   proposed cache state once against large-project/default and ProjectService.
4. Add proposed `react-typing` scenario: a small component using
   `React.ComponentPropsWithoutRef<'button'>`, a wrapper with imported props,
   and multiple consumers of a shared type. Make the installed pinned React
   types resolvable inside the temporary fixture with a cross-platform local
   dependency link or explicit fixture resolution. Never copy the whole installed
   tree per iteration. The plugin's default prop filter removes parents from
   node_modules. Use an explicit benchmark-only `propFilter` that retains
   `disabled` for this scenario, and record that parser configuration in every
   report; do not change the plugin default. Assert the inherited boolean prop
   and an imported union before accepting a sample. Run compiler/metadata
   preflight in the separate seed/validation process, not as a hidden compiler
   warm-up in the measured process. A JSX-only shim or unresolved React import
   is a failed fixture, not a fast benchmark. Verify the scenario in all three
   cache states and both stable runtime modes.
5. Run the full suite, typecheck, build, lint and whitespace commands. Record
   exact smoke commands and their exit/status results in the verification note.
   One-iteration smoke is correctness coverage only; do not add noisy CI timing
   thresholds. Read the final diff for scope and update the index.

Proposed smoke command after implementation:

```sh
node scripts/benchmark-playground.mjs --scenario react-typing --iterations 1 --modes default,projectService --cache restart --output .yarn/simplification-evidence/react-restart.json
```

## Done criteria and maintenance

- Returned HMR modules contribute to transformed files and affected counts.
- Explicit empty and undefined hook results have distinct tested behavior.
- Stale metadata, fixture resolution failures, and teardown failures exit nonzero.
- Cleanup completes before fixture restoration, workspace deletion or the next
  measured instance.
- Off/populate/restart cache states are distinct and tested; restart uses a
  separate process for seeding and the same component paths. The measured
  restart process has not initialized a backend or run a compiler warm-up.
- Whole-session cost includes awaited close and uses the same workload in
  cache-disabled and cache-enabled states.
- The React fixture proves real inherited metadata exists.
- Existing CLI behavior remains available; any report-schema change is explicit
  and old baseline reports are rejected clearly rather than compared incorrectly.
- All final gates pass and evidence states no runtime speedup was measured here.

Stop if this needs a production plugin diagnostic API, broad runtime edits, an
external service, or a new benchmark framework. Existing real-Vite HMR tests
remain the source of end-to-end delivery correctness; the direct hook benchmark
must never be described as browser-visible HMR timing. Plan 021 uses the repaired
harness for bounded independent-process measurements.

## Execution result

Completed on 2026-09-05 at `c5b97ae5e1ed33e350c8f4d3a8da77077aa2caf2`
on `codex/020-repair-performance-benchmarks`, based on approved Plan 019
commit `2f7d6a9`. The worktree is
`D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan020/vite-plugin-react-docgen-typescript`.
It is clean; the isolated commit is unsigned and has not been merged or pushed.

All eight changed files match the scope. The harness now counts returned HMR
modules, awaits teardown, rejects invalid results, distinguishes cache states
with child-process seeding/validation, and validates real inherited React
metadata. Schema 2 records raw runs, process warmth, whole-session cost,
cache-entry counts and build/source/configuration identity. Old or mismatched
baselines are rejected, and the stale package command is corrected.

Independent review reproduced and corrected one directory-alias matching
failure. Final validation passed 309 tests, typecheck, build, scoped lint,
whitespace, the 13-case smoke matrix and an additional real React WatchProgram
case. The initial automated review was clean. The follow-up review's single
late-watch-invalidation finding was rejected after checking the current
awaited hook contract, rerunning its controlled pending-update test, and
confirming the named wrapper case in the real CLI. No accepted actionable
findings remain; the raw reviews and rationale are retained.

See [020-benchmark-verification.md](020-benchmark-verification.md) for exact
commands, hashes, review evidence and scope decisions. No runtime speedup or
cache-retention conclusion was established. Plan 021 remains separate.
