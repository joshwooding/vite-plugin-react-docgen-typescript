# Plan 023: Decide how to observe initially missing external types

## Status and scope

- Status: DONE — independently reviewed decision/evidence at 02d8da23454bbbce3d1d05038a1200a1b0df673a.
  Verdict NEEDS_DESIGN; the production gap remains open. Two 18-server runs
  reproduce baseline 0/12, unreliable exact candidates 1/12 then 2/12, and parent
  prototype 30/30 with 25–26 extra directories and 121–122 entries. Existing 25 watcher/HMR
  tests also pass independently. See 023-missing-external-type-watch-decision.md
  in the evidence commit for scope, raw reports and next design choices.
- Priority: P2; effort: M; risk: MED; category: correctness/performance.
- Planned at: `d6553de853530680b0d959120e3b0f9eeeaf8d33`, 2026-09-05.
  Scoped runtime drift from the original 5f448ec base is empty.
- Depends on completed Plan 022. Its isolated branch contains Plans 017–022;
  the main working checkout has not integrated them.
- During Plan 022 closeout the user was offered a scope choice. No answer arrived
  during the optional clarification window, so the stated recommended default
  was to keep the verified file-level fix and plan this additional case separately.
- Goal: establish a reliable, bounded watcher design or document why broader
  directory watching requires a separate product/performance decision. Do not
  automatically ship recursive external-directory watches.

## Problem and demonstrated evidence

With a Vite root `fixture/app`, a component importing the relative type
`../../shared/types` can start while `fixture/shared/types.d.ts` is absent. The
plugin records unresolved candidate paths in its reverse dependency index, but
only existing paths are registered with the development watcher. Creating that
file later produces no external add event, and metadata stays stale. The same
case arises after deleting a declaration offline or recreating it with another
candidate extension. This gap existed at Plan 022's base; it was not introduced
by the committed fix for edits to existing external files.

Plan 022's external review reported this P2 finding. The advisor independently
reproduced four failing rows in both stable modes with cache off/on, including a
real persisted hit seeded while the declaration was absent. Each in-root watcher
control succeeded; a cache-disabled oracle showed the newly created number prop.
The executor separately reproduced six cases, including offline deletion followed
by creation of a `.ts` candidate instead of `.d.ts`.

Evidence is retained in:
`D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan022/vite-plugin-react-docgen-typescript/.yarn/simplification-evidence/022/`

- `autoreview-round1.json` / `.txt`: structured review and its single finding.
- `reviewer-missing-startup.mjs` and `reviewer-missing-startup-baseline.json`:
  standalone built-plugin reproduction with four real filesystem cases.
- `executor-round1-missing-baseline.log`: six intended baseline failures.
- `executor-round1-watch-hmr.log`: failed attempted fix and recreation regressions.
- `review-round1-exploration.patch`: the attempted two-file change plus six tests.
  **Do not apply this as a working fix**: it failed all fourteen external rows.
- `executor-round1-restored-watch-hmr.log`: recovery to the committed candidate;
  original eight external and seventeen strict HMR tests pass.

## Why the obvious change failed

Moving the existence guard to only the build/direct addWatchFile fallback allowed
every unresolved candidate through `server.watcher.add(exactPath)`. That did not
deliver the missing-file events and also broke existing recreation checks.

Read the installed primary watcher source at:
`D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vite/dist/node/chunks/node.js`.
Use `rg -n '_handleRead|_handleDir|disableGlobbing|dirname\(item\)'` to find the
current locations; observed Vite 8.1.5 locations were around 9447, 9508, 10216 and
25788. Its bundled Chokidar missing-file fallback installs a parent-directory
reader filtered to one target filename. A directory-wide readdir throttle can
suppress the readers for other candidate names. One successful exact missing-file
watch is therefore not evidence that multiple candidates work. Vite also disables
glob handling by default. Do not override user/global watcher settings or use
private watcher internals to bypass these contracts.

Registering a parent directory directly is a distinct tradeoff: the shared Vite
watcher can recursively scan/watch unrelated descendants. A seemingly small
external import may have a large repository directory as its parent. This must
be investigated before increasing default watch scope in a performance-focused
change.

## Relevant code and ownership

All source paths below are relative to
`packages/vite-plugin-react-docgen-typescript/src/`.

- `plugin.ts`: `collectUnresolvedRelativeDependencies` creates exact extension
  and index candidates; `trackModuleDependencies` maintains the existing reverse
  index; `watchFiles` registers existing paths with the public server watcher in
  serve mode and addWatchFile in build/direct contexts. The unlink handler
  re-registers one already-known external path and owns its async work through
  existing teardown machinery.
- `docgen/legacyBackend.ts`: `collectUnresolvedModuleDependencies` reuses compiler
  resolution and records failed non-node_modules TypeScript candidates. Do not
  replace it with a new scanner or parser.
- `__tests__/externalTypeWatch.test.ts`: real Vite integration pattern, actual
  filesystem writes, effective in-root control, ordinary transformRequest,
  metadata/extraction checks, awaited server close. Existing eight rows cover
  both modes/cache states and single/two-reference project layouts.
- `__tests__/support/importedTypeHmrContract.ts` and
  `__tests__/viteHmr.contract.test.ts`: strict existing HMR delivery/selectivity
  assertions. Do not weaken them to accommodate a watcher design.

## Ordered work for a future executor

1. Create a same-basename isolated worktree from exact commit `d6553de853530680b0d959120e3b0f9eeeaf8d33` under
   `.yarn/.codex-worktrees/plan023/vite-plugin-react-docgen-typescript`, branch
   `codex/023-missing-external-type-watch-decision`. Verify the base and clean
   source before work. Leave main, older worktrees and historical evidence alone.

2. Reproduce with a disposable fixture: app/src/Component.tsx imports Props from
   ../../shared/types; shared directory exists, declaration does not. Transform
   normally, verify initial metadata lacks label, then create a number label prop.
   Require a real in-root control change, real external add and fresh metadata.
   Exercise both modes, cache off, cache seeded while absent, and offline deletion
   followed by an alternate extension. Use fresh cache-disabled oracles at the
   same paths. Preserve the expected baseline failures.

3. Read the actual watcher implementations used by the supported Vite versions
   before proposing a public API solution. Do not infer reliable delivery from
   one missing path. Test multiple unresolved candidates and multiple component
   imports sharing a parent. Include delete/recreate cycles and shutdown.

4. If considering parent-directory registration, prototype it only in disposable
   verification code. Include unrelated nested directories/files under that
   parent and report the added watched directories/files. Include an import whose
   parent is the repository directory, not just a tiny shared fixture. Record
   event selectivity, normal HMR delivery and cleanup. No global ignore/depth
   changes, filesystem-root scans, private APIs or second watcher subsystem.
   Do not call operation counts an elapsed-time improvement.

5. Write a decision with evidence: either a supported bounded solution that merits
   a separately reviewable implementation, or NEEDS_DESIGN with the exact missing
   public contract and concrete directory-watch cost. A remaining gap is a valid
   outcome; a falsely green or weakened test is not. Do not broaden production
   watch scope or add a new option/backend protocol under this decision plan.

## Commands and done criteria

Use PowerShell with login disabled. Ancestor dependencies are installed; no install
or package upgrade is needed. Observed environment: Node 24.10.0, TypeScript 6.0.3,
typecheck alias 6.0.2, Vite 8.1.5, react-docgen-typescript 2.2.2.

- Build from the worktree package directory:
  `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs`
- Full existing suite from worktree root:
  `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2`
  Baseline is 337 passing tests in thirteen files.
- Typecheck:
  `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json`
- Whitespace: `git diff --check`.
- New standalone probe scripts must exit nonzero for missing events, stale
  metadata, failed positive controls or leaked server lifecycle work.
- Source/package/lockfile/snapshot/benchmark drift must remain empty for the
  decision-only plan. Store prototypes/raw results in ignored
  `.yarn/simplification-evidence/023`; decision documents may live under plans.
- No commit before advisor review; no push, merge, issue creation or release.

The final decision must explicitly retain the distinction between an existing
external file edit, one watched file being recreated, and several unresolved
candidates being created. A fix for one does not prove the others.
