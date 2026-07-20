# Plan 004: Unify project membership and file-selection semantics

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ffd553b..HEAD -- README.md packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/utils/options.ts packages/vite-plugin-react-docgen-typescript/src/utils/fileSelection.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts .changeset/steady-project-selection.md`
> If an existing in-scope file changed, compare the "Current state" excerpts
> below with the live code. Any semantic mismatch is a STOP condition. The
> selection helper, focused test, and changeset are expected not to exist.
> If Plan 002 is already `DONE`, its compatibility loader, TypeScript 6 root
> alias, diagnostic, and documentation in `src/index.ts`/`README.md` are
> expected. Rebase onto it and preserve those changes while moving selection;
> unexpected behavior outside that overlap remains a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ffd553b`, revised 2026-07-20

## Why this matters

[Open issue #77](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/issues/77)
reports that TSX sources in a referenced sibling project are rejected as not
belonging to the active TypeScript project, even though the plugin already
parses the reference metadata. [Open issue #80](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/issues/80)
reports a runtime crash when a loosely typed caller supplies a `RegExp` pattern:
the public plugin type says `string[]`, but the invalid value reaches `globSync`
before any clear configuration diagnostic.

Both failures come from maintaining two different selection systems: root-based
glob enumeration for TypeScript roots and Vite's filter for transforms. The fix
must establish one documented, compiler-neutral string-glob contract, apply it
directly to parsed root and referenced-project files, and preserve explicit
empty arrays without mixing transform eligibility into TypeScript's broader
dependency graph. Plan 006 will pass this same predicate into any legacy or
native backend rather than letting each compiler implementation invent its own
selection rules.

## Current state

- `packages/vite-plugin-react-docgen-typescript/src/index.ts:61-63` defines
  `DEFAULT_INCLUDE = ["**/*.tsx"]` and
  `DEFAULT_EXCLUDE = ["**/*.stories.tsx"]`.
- `src/index.ts:105-124` enumerates include globs with `globSync` using
  `cwd: rootDir` and forwards the raw `excludeArray` to `ignore`.
- `src/index.ts:141-184` recursively gathers both referenced config files and
  their parsed project files.
- `src/index.ts:186-212` then intersects those project files with the earlier
  root-scoped enumeration, so referenced sources outside the Vite root are
  discarded despite being known TypeScript project members.
- `src/index.ts:261-281` uses that intersection as `rootFiles`, conflating
  TypeScript program inputs with files eligible for docgen transforms.
- `src/index.ts:1430-1463` independently creates Vite's filter with
  `createFilter(includeArray, excludeArray)` and no explicit root.
- `src/index.ts:1507-1516` gates transforms against the initialization-time
  `projectRootFiles` set and emits the misleading message "not included in the
  active TypeScript project" even when the file was excluded only by the
  plugin's root-scoped glob pass.
- `src/index.ts:1118-1143` refreshes tracked program/config files from a new
  `Program`, but not the set eligible for docgen. A matching file created after
  initialization therefore remains rejected until restart. Cross-version file
  creation/deletion handling is recorded as a separate follow-up because Vite 8
  sends those events to `hotUpdate`, not legacy `handleHotUpdate`.
- `src/index.ts:1647-1664` ignores a new TypeScript file when a configured
  project has not yet added it to `projectTrackedFiles`.
- `src/utils/options.ts:57-61` already exposes `include?: string[]` and
  `exclude?: string[]`; RegExp support is not part of the public plugin API.
- `README.md:30-31` describes glob arrays, but does not state their base,
  empty-array meaning, referenced-project behavior, or runtime rejection of
  non-string values. Its displayed include and exclude defaults also differ
  from the code.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Existing baseline | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts` | Exit 0 before implementation |
| Focused selection tests | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts` | All root, reference, pattern, validation, empty-array, and declaration-boundary cases pass after implementation |
| Typecheck | `yarn typecheck` | Exit 0, no errors |
| Full tests | `yarn test --run` | All tests pass |
| Build | `yarn build` | Package builds successfully |
| Benchmark smoke test | `yarn benchmark:ci` | Exit 0 after the `playground`, `large-project`, and `large-design-system` scenarios each complete once |
| Changed-file formatting/lint | `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/utils/options.ts packages/vite-plugin-react-docgen-typescript/src/utils/fileSelection.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts` | Exit 0 after formatting in-scope code/tests |
| Compiler-neutral boundary | `rg -n 'typescript|react-docgen-typescript' packages/vite-plugin-react-docgen-typescript/src/utils/fileSelection.ts` | No output and the expected `rg` exit code 1; this catches static, dynamic, and `require` references |
| Repository formatting/lint | `yarn biome:ci` | Exit 0 on Linux CI; see the Windows baseline note below |
| Whitespace check | `git diff --check` | Exit 0 |
| Scope check | `git status --short` | Only in-scope files and the plan-index status update appear |

No dependency or lockfile change is expected.

The current Windows checkout has a known line-ending-only Biome baseline: full
`yarn biome:ci` exits 1 with 16 pre-existing `format` diagnostics. Do not rewrite
unrelated files. The changed-file command must exit 0, `git diff --check` must
exit 0, and Linux CI must make the full command green. A Windows full run is
acceptable only when every remaining diagnostic is that same pre-existing
CRLF/`format` class and no new path appears.

## Scope

**In scope** (the only files you should modify):

- `README.md`
- `packages/vite-plugin-react-docgen-typescript/src/index.ts`
- `packages/vite-plugin-react-docgen-typescript/src/utils/options.ts`
- `packages/vite-plugin-react-docgen-typescript/src/utils/fileSelection.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts` — create
- `.changeset/steady-project-selection.md` — create

**Out of scope**:

- Supporting RegExp, callback, or mixed string/RegExp patterns. Reject them.
- Processing files absent from both the root and referenced TypeScript projects
  when a tsconfig is configured.
- Imported-type HMR delivery and TypeScript project freshness after an existing
  dependency edit; Plans 005 and 008 own its acceptance and repair.
- Extracting a backend session or adding native TypeScript. This plan creates
  the compiler-neutral selection input that Plan 006 reuses, but does not move
  compiler lifecycle itself.
- Refreshing configured-project membership after file create/delete events.
  Vite 6–8 route those events through `hotUpdate` while Vite 3–5 expose only
  older hooks; design and test that cross-version lifecycle separately.
- Persistent-cache schema, pruning, or dependency-content validation.
- Changing the default include/exclude values.
- Changing TypeScript or Vite peer ranges.

## Git workflow

- Branch: `codex/004-unify-project-file-selection`
- Make one logical commit with a title-style subject, for example
  `Unify project file selection`.
- Do not implement concurrently in one worktree with Plan 002. If Plan 002
  merged first, rebase and run immutable install, both plans' focused suites,
  `index.test.ts`, typecheck, and build before completing this plan.
- Do not execute this plan concurrently with Plan 006; Plan 006 extracts the
  finalized selection/project boundary from `src/index.ts`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Lock the intended contract with focused failing tests

Create `src/__tests__/projectSelection.test.ts`, following the temporary-project
and cleanup patterns at `src/__tests__/index.test.ts:81-329`. Keep fixtures
temporary so tests can create and remove files without mutating snapshot
fixtures.

Add explicit cases for:

1. A `src/**/*.tsx` include resolves from a supplied Vite root even when the
   process working directory is elsewhere.
2. The default `**/*.tsx` processes a TSX source that belongs to a recursively
   referenced sibling project whose root config uses `files: []`.
3. An explicit parent-directory include selects only its matching referenced
   source; an explicit exclude wins over include; the default story exclusion
   still wins for root and referenced files.
4. `include: []` matches nothing, does not initialize a TypeScript runtime in
   either `serve` or eager `build` configuration, and emits no per-file
   warnings. `exclude: []` removes the default exclusion and otherwise
   preserves inclusion.
5. A whole non-array value such as `include: /x/` or `exclude: "x"`, supplied
   through an intentional `as unknown as Options` cast, throws a
   configuration-time `TypeError` naming the option and received type. A
   non-string element inside an array names the option and failing index. No
   `globSync` stack or `invalid pattern` message may escape.
6. Declaration files remain available as TypeScript program inputs but are not
   eligible transform targets. A transitive imported `.ts` source can be
   tracked for analysis without being promoted to a docgen target merely
   because it appears in `program.getSourceFiles()`.
7. A configured nonmatching, non-declaration `.ts` root that contributes a
   global or module augmentation still affects the selected component's
   extracted type, while that `.ts` root itself remains ineligible for docgen
   transformation. This prevents selection globs from narrowing the compiler
   program.

The referenced-project fixture should mirror issue #77: a Vite/Storybook root
with `files: []`, a `references` entry, and a sibling composite UI tsconfig.
Register that fixture in all four legacy runtime modes—default, watch,
project-service, and both flags with project-service precedence—and assert
generated `__docgenInfo` in every row, not only absence of a warning. The four
rows must agree on membership and transform eligibility.
Lock the non-obvious Vite filter behavior directly: with
`{ resolve: configRoot }`, `**/*.tsx` accepts a referenced sibling absolute
path, `src/**/*.tsx` accepts only the root source, and `../ui/**/*.tsx` accepts
only the sibling source.

**Verify before implementation**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts`
→ only the newly documented regressions fail. STOP if the current behavior or
Vite filter semantics differ materially from the facts above.

### Step 2: Create one validated string-glob contract

Create `src/utils/fileSelection.ts`. Give it one responsibility: normalize and
validate plugin patterns, then expose the same eligibility predicate to project
resolution and transform hooks.

Export one internal resolved-selection object (for example
`ResolvedFileSelection`) containing the read-only normalized include/exclude
arrays, `hasIncludes`, and a named `matchesDocgenFile(absolutePath)` predicate.
The object may use Vite's public filter internally, but it must import no
TypeScript or `react-docgen-typescript` types and must not expose a Vite
`Plugin`. Plan 006 will pass this object/predicate into a compiler-specific
backend factory.

Required semantics:

- `undefined` uses the existing defaults. An explicit empty array remains empty;
  do not replace it with defaults.
- Both options must be arrays and every element must be a string. A whole-value
  error names the option and received type; an element error names the option,
  bad index, and received type. Throw before calling Vite or `glob`.
- `include: []` produces a predicate that always returns false, overriding
  `createFilter`'s native empty-include "match everything" behavior.
- Otherwise create one Vite filter with
  `createFilter(include, exclude, { resolve: configRoot })` and apply it to
  absolute, query-free file paths.
- Reject declaration files as transform targets even when a broad `*.ts` glob
  matches; they remain separate TypeScript program inputs.
- Normalize returned/discovered paths with `path.resolve`, deduplicate them, and
  sort deterministic arrays.

Expose the resolved include/exclude arrays as read-only values for compiler-
options-only glob discovery, plus an explicit `hasIncludes`/always-false signal
so `configResolved` can skip eager build initialization for `include: []`.
Do not copy the matching rules back into `index.ts`.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts`
→ pattern validation, all three root/reference glob cases, empty arrays,
exclude precedence, and declaration behavior pass; the configured-project
integration case may still fail until Step 3.

### Step 3: Separate TypeScript program roots from docgen eligibility

Refactor `TypescriptProject` in `src/index.ts` so it explicitly carries:

- configured `projectFiles`, sourced only from parsed root names in the root
  config and recursively resolved reference configs;
- TypeScript `rootFiles` used to construct the current docgen program; and
- a distinct `docgenFiles` set/list containing only project members accepted by
  the shared selection predicate.

For a parsed tsconfig:

1. Keep `resolveReferencedProjectMetadata` recursion and its cycle guard.
2. Form `projectFiles` as the sorted, deduplicated union of the root
   `ParsedCommandLine.fileNames` and every recursively resolved reference's
   `commandLine.fileNames`. Do not derive configured membership from
   `program.getSourceFiles()`; that list includes transitive imports and would
   silently widen the configured root/reference boundary.
3. Form `docgenFiles` by applying the shared predicate directly to each
   absolute `projectFiles` member and excluding declaration files. Do not
   rediscover configured-project membership by walking beneath `configRoot`.
4. Form program `rootFiles` as all configured `projectFiles`, including
   nonmatching non-declaration roots and declarations. TypeScript's parsed
   root/reference graph is the analysis boundary; plugin selection must never
   narrow it. Keep `docgenFiles` as the strictly selected transform-eligibility
   subset, so analysis-only `.ts` roots are not transformed. Do not add
   transitive `program.getSourceFiles()` entries to configured membership.

For the compiler-options-only/no-tsconfig path, `rootFiles` remains the selected
discovery result because there is no configured parsed-project root list.
Discover candidates from the
validated include globs with `globSync`, including explicit `../` patterns,
then apply the shared predicate for both inclusion and exclusion. Do not pass
the exclude list to `globSync.ignore`; using two matchers can pre-drop a path
with semantics different from Vite's filter. Never forward unvalidated values
to `globSync`. For `include: []`, do not call `globSync` or initialize the
TypeScript runtime.

Rename `projectRootFiles` to a name that states its eligibility role, such as
`projectDocgenFiles`. Use `rootFiles` only when constructing a TypeScript
program. Update the skip diagnostic to distinguish these cases:

- A file failing include/exclude returns before initialization and produces no
  warning.
- A matching file absent from the configured root/reference graph may warn that
  it matches plugin patterns but is not a member of the configured TypeScript
  project.

**Verify**:
Run the focused root/reference/include/exclude cases. The issue #77 topology
must generate docgen under the default include, explicit narrowing/exclusion
must work, a transitive imported `.ts` file and a configured nonmatching
augmentation root must remain analysis-only while still affecting types, and
existing `index.test.ts` snapshots must remain unchanged:

`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`

### Step 4: Wire the shared selection through initialization and transforms

Create the selection contract during `configResolved`, before any eager build
initialization. Validation errors must therefore name the option/index before
`globSync`, TypeScript, or `react-docgen-typescript` loads. If `include: []`,
skip `ensureInitialized()` even for `command === "build"`; both serve and build
must remain docgen no-op configurations. Preserve the existing synchronous
existence check for an explicitly supplied `tsconfigPath`: a missing explicit
path still throws even with empty include, but an existing config is not parsed
and TypeScript is not loaded.

Prove the no-load claim with scoped Vitest mock/import counters for both the
`typescript` and `react-docgen-typescript` modules around `configResolved`, not
by inferring from missing output. Run once for serve and once for build with an
existing placeholder tsconfig path; both module factory counts remain zero.
Add a separate missing explicit-tsconfig case that still receives the existing
file-not-found error.

Rename `projectRootFiles` to `projectDocgenFiles` and synchronize it only from
the `TypescriptProject.docgenFiles` computed in Step 3. Continue updating
`projectTrackedFiles` from active program dependencies for invalidation and
project-service ownership, but never rebuild `projectDocgenFiles` from
`program.getSourceFiles()`. That distinction prevents a transitive imported
`.ts` file from becoming a transform target.

In `transform`, apply the shared predicate first. A nonmatching file returns
before initialization with no warning. A matching file then initializes and is
checked against `projectDocgenFiles`; if absent from a configured
root/reference graph, retain one clear membership warning. In no-tsconfig mode,
a matching file created after initial discovery returns its source unchanged
and warns once that it was not present at initialization and requires a server
restart; do not reuse the configured-graph wording. Do not add automatic
reparse/recreation for newly created or deleted files in this plan.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts`
→ all seven Step 1 cases pass; the referenced `files: []` case passes in all
four legacy registrations (default, watch, project-service, and both-flags
precedence); the serve/build empty-include cases observe no TypeScript load;
and the run exits without open-handle warnings.

### Step 5: Document the finalized public behavior

Update the JSDoc in `src/utils/options.ts` and the options table plus a short
selection section in `README.md`. State all of these points explicitly:

- `include` and `exclude` accept arrays of string globs only; runtime RegExp
  values are rejected.
- Relative patterns resolve from Vite's configured root, not `process.cwd()`.
- Explicit `include: []` disables docgen processing; explicit `exclude: []`
  disables the default story exclusion.
- The default `**/*.tsx` can select TSX members of the configured root and its
  recursively referenced TypeScript projects.
- Explicit parent-directory patterns can narrow referenced-package processing.
- A configured tsconfig remains the membership boundary; patterns do not pull in
  arbitrary files absent from the root/reference graph.

Correct both displayed defaults so they exactly match the code:
`include: ["**/*.tsx"]` and `exclude: ["**/*.stories.tsx"]`.

**Verify**:

Run each pattern separately against both documentation locations. Every command
must find at least one matching line in its one named file; a match in README
must not hide a missing option JSDoc statement, or vice versa:

1. `rg -n 'string globs only|arrays? of string globs' README.md`
2. `rg -n 'string globs only|arrays? of string globs' packages/vite-plugin-react-docgen-typescript/src/utils/options.ts`
3. `rg -n 'Vite root|configured root' README.md`
4. `rg -n 'Vite root|configured root' packages/vite-plugin-react-docgen-typescript/src/utils/options.ts`
5. `rg -n 'include: \[\]' README.md`
6. `rg -n 'include: \[\]' packages/vite-plugin-react-docgen-typescript/src/utils/options.ts`
7. `rg -n 'exclude: \[\]' README.md`
8. `rg -n 'exclude: \[\]' packages/vite-plugin-react-docgen-typescript/src/utils/options.ts`
9. `rg -n 'referenced TypeScript|project references' README.md`
10. `rg -n 'referenced TypeScript|project references' packages/vite-plugin-react-docgen-typescript/src/utils/options.ts`
11. `rg -n '\*\*/\*\.tsx' README.md`
12. `rg -n '\*\*/\*\.tsx' packages/vite-plugin-react-docgen-typescript/src/utils/options.ts`
13. `rg -n '\*\*/\*\.stories\.tsx' README.md`
14. `rg -n '\*\*/\*\.stories\.tsx' packages/vite-plugin-react-docgen-typescript/src/utils/options.ts`

### Step 6: Add a patch changeset

Create `.changeset/steady-project-selection.md` with one patch entry for
`@joshwooding/vite-plugin-react-docgen-typescript`. Summarize referenced-project
selection, consistent root-relative globs, explicit empty-array behavior, and
clear rejection of non-string patterns. Do not edit `CHANGELOG.md` directly.

**Verify**:
`Get-Content -Raw .changeset/steady-project-selection.md` → frontmatter contains
only the plugin package at `patch`.

### Step 7: Run repository-wide verification

Run, in order:

1. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts`
2. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`
3. If Plan 002 is already `DONE`, run `yarn install --immutable`, `yarn exec tsc6 --version`, and `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts`
4. `yarn typecheck`
5. `yarn test --run`
6. `yarn build`
7. `yarn benchmark:ci`
8. `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/utils/options.ts packages/vite-plugin-react-docgen-typescript/src/utils/fileSelection.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts`
9. `yarn biome:ci` on Linux CI; apply the documented Windows baseline rule locally
10. `rg -n 'typescript|react-docgen-typescript' packages/vite-plugin-react-docgen-typescript/src/utils/fileSelection.ts` (expected: no output and `rg` exit 1)
11. `git diff --check`
12. `git status --short`

Expected: all platform-independent commands other than the intentional no-match
scan exit 0; that scan has no output and exits 1; Linux CI is green; no
existing unexplained snapshot changes occur; all three
named benchmark scenarios complete once; and only the six in-scope files plus
the plan-index status update are modified.

## Test plan

- Use one temporary root-only project and one temporary root-plus-referenced-
  sibling topology.
- Run the referenced `files: []` topology through all four legacy runtime
  registrations and require identical selection plus generated metadata.
- Cover default, explicit relative, parent-directory, exclude, empty include,
  and empty exclude semantics.
- Cover invalid arrays and invalid elements through runtime casts, while keeping
  the public TypeScript type `string[]`.
- Cover the configured parsed-root/reference boundary separately from
  transitive `Program` dependencies.
- Assert generated metadata and absence of TypeScript initialization for empty
  include in serve/build, not only warnings.
- Keep existing cache, tsconfig-refresh, project-reference, and HMR tests green.

## Done criteria

- [ ] One validated predicate governs both transform filtering and configured-
      project docgen membership.
- [ ] The resolved selection object imports no compiler/parser types and can be
      passed unchanged into Plan 006's backend factory.
- [ ] Default TSX selection includes recursively referenced project members.
- [ ] Relative custom patterns resolve from the Vite root consistently.
- [ ] Explicit empty include matches nothing; explicit empty exclude removes the
      default exclusion.
- [ ] Runtime non-string patterns fail during configuration with a stable,
      option-specific `TypeError`; `globSync` never receives them.
- [ ] Program roots and transform-eligible files are distinct concepts;
      every configured parsed root remains in the TypeScript program while
      nonmatching roots and declarations remain analysis-only.
- [ ] Program refreshes never widen docgen eligibility from parsed root names to
      all transitive `program.getSourceFiles()` entries.
- [ ] Empty include skips TypeScript initialization in both serve and build.
- [ ] README and option JSDoc describe the exact implemented contract.
- [ ] A patch changeset exists and no dependency/lockfile change occurs.
- [ ] Focused tests, full tests, typecheck, build, benchmark, changed-file
      Biome, and Linux CI pass.
- [ ] `plans/README.md` marks Plan 004 `DONE`.

## STOP conditions

Stop and report if:

- Existing source or documented behavior differs materially from the current-
  state excerpts.
- Released documentation/tests establish a different empty-array contract.
- Fixing issue #77 requires processing files absent from both root and
  referenced TypeScript projects.
- Vite 3–8 public `createFilter` behavior cannot implement one stable string-
  glob contract; do not add version-specific hidden semantics.
- RegExp support is determined to be an intentional required public API. That
  requires a product/API decision, not silent filtering.
- Plan 006 or another refactor has concurrently modified `src/index.ts`.
- A verification fails twice after one focused correction.

## Maintenance notes

- Keep selection (what may receive docgen) distinct from TypeScript program
  inputs (what is needed to understand selected files).
- Apply future pattern changes through `fileSelection.ts`; never introduce a
  third matcher in a hook.
- Pass the resolved selection predicate into future compiler backends. A native
  backend is not allowed to reinterpret include/exclude globs or project-root
  resolution.
- This plan locks exact path behavior against the installed Vite 8 and uses the
  public `createFilter` signature shared by the declared peers. It does not
  claim a runtime Vite 3–8 matrix; that evidence belongs to the deferred
  supported-version CI plan. Review the minimum peer's public typings before
  merge and STOP if the third `resolve` argument is unavailable there.
- The configured root plus recursive project-reference graph is the safety and
  performance boundary for tsconfig-backed operation.
- File creation/deletion membership remains a separate follow-up. It needs a
  real Vite watcher test and a deliberate Vite 3–5 `watchChange` versus Vite
  6–8 `hotUpdate` compatibility design; legacy `handleHotUpdate` alone cannot
  cover `create`/`delete` on Vite 8.
- Execute Plan 005 only after this plan lands so its project-reference HMR
  acceptance fixture is not confounded by stale selection semantics. Execute
  Plan 006 after both plans so it can freeze the finalized host/backend split.
