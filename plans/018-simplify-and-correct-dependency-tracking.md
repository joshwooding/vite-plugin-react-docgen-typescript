# Plan 018: Simplify and correct dependency tracking

## Status and objective

- Priority: P2; effort: L (several days in three reviewable steps); risk: MED.
- Category: bug / simplification. Depends on: none. Status: DONE (isolated; integrated locally at `6eeed0e`).
- Reconciled at: `1565001bb27c4cc6ea23779a2bfe749a8757892b`, 2026-09-05.
- All three checkpoints are verified and approved. Step 3's UMD review finding
  was reproduced, corrected, verified, and resolved by a clean rereview.
- The user explicitly approved sending diffs for all three Plan 018 checkpoints
  to Codex's automated review service on 2026-09-05.

Make component dependencies complete and consistent with the compiler without
caching incomplete recursive closures. Fix cycles, conditional resolution, and
existing ambient dependencies within the current backend boundary. Retain
selective invalidation for ordinary imports and preserve all supported modes.

## Drift check, scope, and workflow

```sh
git diff --stat 1565001..HEAD -- packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts packages/vite-plugin-react-docgen-typescript/src/__tests__
```

Compare live code with these excerpts; plan 019 touches the same backend.
Only modify:

- `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`
- `packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts`,
  only if a tested compatibility adapter requires it; never widen peer support.
- `src/__tests__/backendContract.test.ts`, `backendParity.test.ts`,
  `typescriptCompatibility.test.ts`, `viteHmr.contract.test.ts`, and
  `support/importedTypeHmrContract.ts` under that package, only for these cases.
- Small fixture files under that package's `src/__tests__/__fixtures__/`.
- One patch changeset under `.changeset/` and index status, when ready.

No changes to `plugin.ts`, the backend DTO/API, persistent-cache storage schema,
parser output shape, runtime defaults, watchers, dependency versions, native
backend, or publishing. Use `codex/018-simplify-dependency-tracking` in a new
isolated worktree; do not modify old experiment worktrees or push/merge/publish.
Use separate logical commits such as `Avoid incomplete dependency closures`.

The implementation base includes verified Plan 017. Drift reconciliation found
only its config-cache tests in the scoped paths; dependency-traversal source is
unchanged from the initial audit. The isolated worktree is
`.yarn/.codex-worktrees/plan018/vite-plugin-react-docgen-typescript`.
Its basename preserves the existing path-sensitive snapshots. As for Plan 017,
verification may invoke installed ancestor binaries from this cwd when Yarn
install state is absent. For step 1, the executor runs focused contracts and
type/lint checks; the reviewer runs the full suite and build once after source
freezes, then the executor commits. Do not duplicate the expensive full run.

## Current state and evidence

The excerpts below record the original audit defects. Live code at `1565001`
uses iterative traversal, compiler-consistent resolution, and shared ambient
inputs including UMD namespace exports. Local verification and all automated
review checkpoints passed. The implementation remains in its isolated branch.

At `legacyBackend.ts:577`, a recursive cycle returns a partial result, while
`:606` caches intermediate results as complete:

```ts
if (pendingFiles.has(currentFile)) {
  return [currentFile];
}
// ... recursive traversal ...
dependencyClosureCache.set(currentFile, resolvedDependencies);
```

Exact-source reproduction: A imports B and C; B imports A. Collecting A gives
`[A,B,C]`; collecting B afterward gives `[A,B]` instead of `[A,B,C]`.

At `:499`, direct dependency resolution is independent from the program and
omits resolution mode. The unresolved collector repeats this at `:650/:663`:

```ts
typescriptModule.resolveModuleName(
  importedFile.fileName, currentFile, compilerOptions,
  typescriptModule.sys, moduleResolutionCache,
);
```

The actual TypeScript resolver selected `cjs.d.ts` with omitted mode and
`esm.d.ts` with ESM mode in a conditional-exports fixture. `:1308` additionally
passes root-project options even when ProjectService supplies another program.
That referenced-project variant needs a regression, not an assumed diagnosis.

The collector at `:494` follows imports/explicit references only. The existing
`AmbientDeclaration.tsx` uses `AmbientDeclarationTone` without importing
`AmbientDeclaration.types.d.ts`. A read-only reproduction changed fresh enum
values from info/warning to success/danger, while the dependency list omitted
the tracked ambient file and the old persistent proof still validated.

The existing backend-contract test at `:319` builds temporary same-project and
referenced-project fixtures, checks exact dependency sets, performs two edits,
and disposes in `finally`. Follow it. Keep sorted physical paths at the backend
boundary. Existing exact ordinary-import tests must not be weakened to accept
the entire project. TypeScript JavaScript API support remains `>=4.3 <7`;
modern resolution helpers must be capability-checked with a real lower-bound
test, not added unconditionally to required APIs.

## Commands

| Purpose | Command | Expected |
| --- | --- | --- |
| Focused contracts | `yarn test run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --exclude '**/.yarn/**' --pool=threads --maxWorkers=2` | All pass after each completed fix |
| Typecheck | `yarn typecheck` | Exit 0 |
| Full suite | `yarn test run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2` | All pass |
| Source lint | `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts` | Exit 0; also lint each changed test file |
| Build | `yarn build` | Exit 0 in implementation worktree |
| Whitespace | `git diff --check` | Exit 0 |

For a fresh worktree use `yarn install --immutable` if needed. Never use a
formatter or installer during the planning-only phase.

## Step 1: Replace partial closure caching with a simple traversal

Add cycle regressions in both transform orders, including a self-cycle and a
diamond graph. Assert exact dependency sets and fresh metadata after editing
the shared leaf. Verify: focused tests fail on the omitted edge, not fixture
or module-resolution errors.

Replace recursive per-node closure memoization with one iterative visited-set
walk per component. Reuse the existing per-program **direct** dependency cache.
Remove `dependencyClosureCacheByProgram`, its resets and parameter plumbing.
Deduplicate and sort only the final component result. Do not add an SCC engine,
a second closure cache, or project-wide invalidation for ordinary cycles.

Verify: focused contracts and typecheck pass; this scan returns no matches
(expected rg exit 1):
`rg -n 'dependencyClosureCacheByProgram' packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`.
Review/checkpoint this step independently before changing resolution.

## Step 2: Use compiler-consistent module resolution

Add NodeNext import/require conditional-target regressions, plus a ProjectService
referenced project whose paths differ from the referencing root. Assert the
actual declaration used by the parser is included and a wrong conditional
target is not substituted. Add edit assertions, not just resolver unit tests.
Verify: new tests identify current missing/wrong edges; prior cycle tests pass.

Read the installed TypeScript declarations/source before selecting APIs. Prefer
the active program's resolved import information where supported. If a public
compatible fallback must resolve again, use the owning program's compiler
options, the per-import resolution mode, and a resolution cache scoped to those
options. Do not use a single root-options cache for different project options.
Use syntax nodes where the mode depends on an import attribute or source format;
text preprocessing alone is insufficient there. Align unresolved-candidate
collection with the same resolution decision to avoid contradicting it.

Keep any compatibility adapter local and small. Do not assume an undocumented
program property is stable across supported TypeScript versions. Run an actual
TypeScript 4.3 ordinary-import backend case in addition to modern NodeNext
cases; accepting the compiler module in a validator test is insufficient.
Verify: focused contracts, the real lower-bound case, and typecheck pass.

## Step 3: Track existing ambient and augmentation inputs conservatively

Add tests for a global script declaration, `declare global` in an external
module, and a module augmentation included as a root without an explicit
component import. The existing ambient fixture is the smallest starting point.
Verify: tests demonstrate fresh parser output differs while current dependency
tracking omits the changed input.

Include applicable global/augmentation source files from the active program in
the component dependencies. A conservative shared ambient set per program is
acceptable; ordinary external modules must retain selective import tracking.
Use TypeScript syntax/module classification, excluding default libraries as
appropriate, rather than treating every `.d.ts` as either global or irrelevant.
Include relevant referenced inputs. Let existing reverse dependencies and
persistent proofs consume the resulting complete list without changing DTOs.

Implementation reconciliation: `isExternalModule` alone does not identify
CommonJS JavaScript. Avoid reproducing the compiler's binder rules. A guarded
use of the current public checker `resolveName` API can identify the file's
own `exports` module symbol. This API exists at runtime in actual TypeScript
4.3.5 although its older declarations do not expose it; test that lower bound
and retain conservative tracking if the optional method is absent. Do not add
it as a required compiler capability. The fallback may over-invalidate on a
compiler without that method, but must not omit a potentially global input.

Test a live edit and an offline edit followed by a new plugin instance. The old
cache proof must be rejected for the existing changed declaration. Keep an
unrelated ordinary-module edit selective. Record the separate new-ambient-root
problem for plan 021: hashing old files cannot detect newly introduced files.
Verify: focused contracts and typecheck pass, then full suite, lint/build and
whitespace checks all pass.

## Done criteria

- Both cycle analysis orders produce the same complete dependency sets.
- ESM/CJS conditional imports track the declaration actually used by the parser.
- Referenced-project compiler options are verified by a concrete regression.
- Existing global/augmentation edits refresh live and restarted-cache metadata.
- Ordinary unrelated modules are not broadly invalidated.
- Real TypeScript 4.3 behavior and the full existing runtime/HMR suite pass.
- No partial closure cache, new public API, or changed metadata schema exists.
- Each changed test asserts observable behavior; no snapshot refresh hides a
  metadata regression. Final diff stays within scope; index status is updated.

## Stop conditions and maintenance

Stop a checkpoint and report if resolving a supported import requires a broad
TypeScript-internals abstraction, if correctness needs a backend-contract
change, or if the fallback cannot work on TypeScript 4.3. Stop after two failed
focused repair attempts rather than loosening expectations. Do not combine
other HMR, cache-schema, or package-version work into this plan.

Time the simpler traversal using the repaired harness from plan 020 before
claiming a speed improvement. Correctness is required even if traversal timing
is neutral. If a material slowdown is measured, consider retaining only
**completed entry** closures in a separately reviewed change; never restore
partial recursive memoization. Future resolution and ambient classification
changes must preserve the same parser/dependency agreement tests.

## Step 1 execution evidence (2026-09-05)

- Base: verified Plan 017 commit `548a2b6b6b9168176d8c8920a0b33f4fdb48610b`.
- Branch: `codex/018-simplify-dependency-tracking`.
- Worktree: `.yarn/.codex-worktrees/plan018/vite-plugin-react-docgen-typescript`.
- Frozen scope: `legacyBackend.ts` (10 added/35 removed production lines),
  `backendParity.test.ts` (195 added test lines), and
  `.changeset/complete-cyclic-dependencies.md`.
- Six new cases cover both A/B transform orders in default, watch, and
  ProjectService modes. Each also covers a self-cycle, a diamond, an unrelated
  component, and two shared-leaf edits through the public plugin update hook.
- Before the fix, A-then-B failed in all three modes: B's dependencies omitted
  `Shared.ts`, although its generated metadata used that type. Reverse order
  passed. No fixture or module-resolution error explained these failures.
- After the fix: executor focused contracts passed 93 tests; reviewer full
  suite passed 268 tests across 10 files. Independent TypeScript 6 typecheck,
  scoped Biome CI, whitespace, and removed-cache-name checks passed.
- Package build passed using the ancestor unbuild CLI from the implementation
  package directory. The sandbox initially blocked esbuild process creation
  with `spawn EPERM`; the approved outside-sandbox retry succeeded. Build
  artifacts stay in the worktree's ignored `dist` directory.
- Commit: `f9518beec67115ff866675fd2f7fde9c690ec157`, unsigned local commit,
  `Avoid incomplete dependency closures`. Worktree is clean; not merged/pushed.
- Local source review found no actionable issue. After explicit user approval
  for all Plan 018 reviews, the structured helper ran with `--mode branch
  --base 548a2b6b6b9168176d8c8920a0b33f4fdb48610b --engine codex
  --stream-engine-output`, exited 0, and reported no actionable findings.
  [Review result](018-step1-autoreview.json). Step 1 verdict: **APPROVE**.
- No elapsed-time improvement is claimed; benchmarks remain Plan 020 work.
  Subsequent checkpoints are recorded below.

## Step 2 execution evidence (2026-09-05)

- Base: step 1 commit `f9518beec67115ff866675fd2f7fde9c690ec157`; same isolated
  worktree and branch. Step 1 was approved before these source edits began.
- Direct targets now come from the active program's public type checker when
  available. Syntax nodes preserve each import's mode; a capability-checked
  helper supplies that mode to fallback and unresolved-candidate resolution.
- The two direct-dependency maps and two root-scoped resolver caches are now
  one per-program cache object. Resolver options and lifetime follow that
  program; no private compiler API or extra cache tier was introduced.
- Seven red cases demonstrated substituted CJS targets for NodeNext ESM
  imports, missing unresolved ESM candidates, and ProjectService using root
  path mappings for a referenced project. Metadata assertions showed which
  declaration the parser actually used before dependency assertions failed.
- Tests cover import-equals, source package format, explicit resolution mode,
  two modes for the same specifier in one file, two declaration edits, and
  resolved/unresolved referenced paths after root analysis.
- Local review caught two lost preprocessing behaviors before completion:
  AMD define arrays and external-module augmentation targets. One scoped
  revision restored both with syntax branches. Real TypeScript 4.3.5 and
  6.0.3 backend cases failed with the three omitted files before that fix and
  passed afterward; they also cover ordinary require and metadata updates.
- Executor focused suite: 102 tests across 4 files passed. After fixture-only
  declarations removed unrelated missing-name diagnostics, all 9 new cases
  passed again. Final typecheck, scoped Biome CI and whitespace checks passed.
- Reviewer full suite: 277 tests across 10 files passed in 80.27 seconds.
  Package build passed using the same approved esbuild worker invocation.
  Full diff and preserved syntax were independently reviewed; no remaining
  local findings. No snapshots were changed.
- Commit: `083e2dde9fbb30eae78791f111f95869d4158989`, unsigned local commit,
  `Follow compiler-consistent dependency resolution`. Worktree was clean at
  the checkpoint; not merged or pushed.
- Structured Codex review against `f9518be` exited 0 with no actionable
  findings: [review result](018-step2-autoreview.json). Step 2 verdict:
  **APPROVE**. The user's existing all-Plan-018 review approval covered it.
- Step 3 evidence follows. No elapsed-time improvement is claimed.

## Step 3 execution evidence (2026-09-05)

- Base: approved step 2 commit `083e2dde9fbb30eae78791f111f95869d4158989`;
  same isolated worktree and branch.
- Existing global script and declare-global inputs now seed the existing
  iterative traversal, including external types imported by those inputs.
  Their file list is computed once in the existing per-program cache object.
  Default libraries, ordinary external declarations, and local namespaces
  are excluded. No second traversal, public API, or storage schema was added.
- Nine cases cover global scripts, declare-global inputs with an imported
  leaf, and unimported root augmentations across all three runtime modes.
  Before the fix, global and declare-global changes produced fresh backend
  metadata while the plugin returned the initial cached metadata. After an
  offline edit, the old proof incorrectly allowed another backend-free hit.
- The augmentation component case already worked after step 2; it remains
  covered. Sharing augmentation inputs with other components is the planned
  conservative policy, not a newly claimed parser fix.
- Each case verifies exact dependencies, a live edit, selective ordinary TS
  and alias-export CommonJS edits, an unchanged persistent warm hit, and an
  offline ambient edit that creates a backend and returns fresh metadata.
  Unimported CommonJS require/defineProperty files and ordinary external
  `.d.ts`/local namespace files guard against project-wide invalidation.
- ProjectService's referenced-path test now uses distinct root/referenced
  ambient declarations and checks matching metadata and exact owning paths.
- The real TypeScript 4.3.5/6.0.3 backend cases now assert an ambient-only prop
  as well as imported-prop updates and exact dependencies. Both exclude an
  unrelated CommonJS root. The optional current-public `resolveName` query
  avoids copying CommonJS binder rules; its guarded older-runtime use and
  conservative fallback are recorded above. Read-only probes matched the
  compiler on 18 CommonJS/global forms in both versions.
- Executor final focused suite: 111 tests across 4 files passed in 49.02s.
  Final TypeScript typecheck, scoped Biome CI and whitespace passed.
- Reviewer full suite: 286 tests across 10 files passed in 102.07s. Package
  build passed. Final source, compatibility tests, referenced-program test,
  changeset and whitespace were independently reviewed with no local finding.
- Commit: `74fc7ba000ee5f0649094f4426e07b0836c11979`, unsigned local commit,
  `Track existing ambient dependency inputs`. The four-file checkpoint is
  clean and contains 50 added/1 removed production lines. No snapshot changed;
  no merge or push occurred.
- First structured automated review against `083e2dd` found one actionable
  omission: external declarations using `export as namespace` were not shared.
  [First review result](018-step3-autoreview.json). Public TypeScript 4.3/6
  declaration and AST checks confirmed that NamespaceExportDeclaration is a
  separate supported form. The scoped correction is recorded below.
- Newly introduced ambient roots remain a separate Plan 021 issue: proofs of
  existing files do not discover new files. Timing measurements remain Plan
  020 work; no speed improvement is claimed here.

## Step 3 review correction and final acceptance (2026-09-05)

- The UMD regression uses a legal `.d.ts` declaration with `export as namespace
  AmbientLib`, enables `allowUmdGlobalAccess`, and consumes `AmbientLib.Props`
  without an import. It reproduced the omitted proof dependency in all three
  runtime modes and actual TypeScript 4.3/6 backend cases. Parser metadata was
  already correct; live/offline plugin output stayed stale and incorrectly
  avoided backend creation before the fix.
- One predicate extension, `isNamespaceExportDeclaration`, recognizes this
  additional ambient form. The existing matrix now covers 12 combinations,
  including live edits, a valid warm hit, an offline edit, and selective ordinary
  TS/CommonJS changes. Both real compiler cases assert UMD-only metadata and
  exact dependencies. No new adapter, cache, or option was introduced.
- Executor final focused verification: 114 tests across 4 files, 51.34s, exit 0.
  Typecheck, scoped Biome CI and whitespace passed. Reviewer full suite: 289
  tests across 10 files, 104.31s, exit 0. Package build and final diff review
  passed. These suite durations are verification records, not speed benchmarks.
- Correction commit: `1565001bb27c4cc6ea23779a2bfe749a8757892b`, unsigned local
  commit, `Track UMD namespace dependency inputs`; four scoped files, no
  snapshot changes. The complete step 3 diff was rereviewed against `083e2dd`.
- Final structured review exited 0 with no actionable findings and explicitly
  confirmed the UMD correction: [final review result](018-step3-autoreview-round2.json).
  Step 3 and overall Plan 018 verdict: **APPROVE / DONE**.
- Root independently confirmed the implementation worktree is clean at
  `1565001`. The main checkout remains `a360aca` on
  `codex/simplify-changesets-publish`, with only the untracked plan artifacts.
  Nothing was merged, pushed, or published.
- Plans 019/020/021 remain TODO. Plan 021 also records an unverified question
  about real Vite watcher coverage for type-only declarations outside its root;
  manually delivered HMR contracts do not establish that coverage. New ambient
  file discovery and measured performance remain follow-up work.
