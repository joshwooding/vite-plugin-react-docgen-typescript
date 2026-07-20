# Plan 002: Make the TypeScript 7 compatibility boundary explicit

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ffd553b..HEAD -- package.json yarn.lock README.md packages/vite-plugin-react-docgen-typescript/package.json packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescript.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts .changeset/clear-typescript-boundary.md`
> If an existing in-scope file changed, compare the "Current state" excerpts
> below with the live code. Any semantic mismatch is a STOP condition. The
> compatibility helper, focused test, and changeset are expected not to exist.
> If Plan 001 already added root-dev `yaml`, preserve it and regenerate the
> combined lockfile; that expected manifest/lock overlap is not semantic drift.
> If Plan 004 is already `DONE`, its selection refactor and documentation in
> `src/index.ts`/`README.md` are also expected. Rebase onto it, preserve its
> validated filter, configured-project boundary, and `include: []` no-load
> behavior while routing compiler initialization through this plan's loader;
> unexpected behavior outside that overlap remains a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: migration
- **Planned at**: commit `ffd553b`, revised 2026-07-20

## Why this matters

[Open issue #81](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/issues/81)
reports that version 0.7.0 crashes on TypeScript 7 with an unrelated
`ts.sys.fileExists` property-access error. The package advertises an unbounded
`typescript >=4.3.x` peer even though both this plugin and
`react-docgen-typescript` require the legacy compiler API removed from the
TypeScript 7 root module. TypeScript 7 has separate unstable native API
subpaths, but they use a new snapshot/project/checker model and are not a
drop-in implementation of the legacy contract. The honest near-term boundary
is TypeScript 4.3 through 6.x, a controlled diagnostic for incompatible root
modules, and a documented TypeScript 6 compatibility-package workaround.

## Current state

- `packages/vite-plugin-react-docgen-typescript/package.json:31-38` declares:

  ```json
  "peerDependencies": {
    "typescript": ">= 4.3.x",
    "vite": "^3.0.0 || ^4.0.0 || ^5.0.0 || ^6.0.0 || ^7.0.0 || ^8.0.0"
  }
  ```

  The TypeScript range admits 7.0 even though it cannot work.
- Root `package.json:25-35` runs one toolchain version and currently pins
  `typescript: 5.6.X`; CI therefore does not exercise the reporter's supported
  TypeScript 6 workaround or the unsupported TypeScript 7 shape.
- `packages/vite-plugin-react-docgen-typescript/src/index.ts:215-250` imports
  `typescript` and dereferences `ts.sys.fileExists` before validating the
  module.
- The same file imports the compiler independently at lines 301, 392, and 1267,
  so fixing only the first call site would leave mode-specific crashes.
- `packages/vite-plugin-react-docgen-typescript/src/utils/typescript.ts:1-36`
  statically imports `typescript` and directly uses `readConfigFile`, `sys`,
  `parseJsonConfigFileContent`, and `flattenDiagnosticMessageText`.
- `README.md:22-36` documents plugin options but has no TypeScript compatibility
  section.
- TypeScript's official 7.0 announcement states that 7.0 does not expose a
  stable programmatic API and that `@typescript/typescript6` is the transition
  package for tools that still need the legacy compiler API.
- The stable `typescript@7.0.2` manifest exposes specific experimental entries
  such as `typescript/unstable/sync` and `/unstable/ast`; there is no bare
  `/unstable` export, and the official announcement still says 7.0 ships no
  stable programmatic API. Those entries are evaluated only by Plan 007 after
  a compiler-neutral backend seam and parity corpus exist.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Update lockfile | `yarn install` | Exit 0 and only intentional manifest/lock changes are produced |
| Reproducible install | `yarn install --immutable` | Exit 0 after the lockfile is updated |
| Focused compatibility tests | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts` | The new guard accepts the real TypeScript 4.3 and 6 module shapes; real TypeScript 7 plus malformed/load-error cases fail with controlled diagnostics |
| Compiler identity | `yarn exec tsc6 --version` | Reports 6.0.x; the repository does not depend on an ambiguous `tsc` alias for typecheck |
| Typecheck | `yarn typecheck` | Exit 0 through the package's explicit `tsc6 --noEmit` script |
| Full tests | `yarn test --run` | All tests pass |
| Build | `yarn build` | Package and declarations build successfully |
| Changed-file formatting/lint | `yarn exec biome ci package.json packages/vite-plugin-react-docgen-typescript/package.json packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescript.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts` | Exit 0 after formatting in-scope code/manifests |
| Repository formatting/lint | `yarn biome:ci` | Exit 0 on Linux CI; see the Windows baseline note below |
| Raw-import scan | `rg -n 'await import\("typescript"\)|import ts from "typescript"' packages/vite-plugin-react-docgen-typescript/src` | Only the intentional compatibility loader or type-only imports remain |
| Scope check | `git status --short` | Only in-scope files and the plan-index status update appear |

The current Windows checkout has a known line-ending-only Biome baseline: full
`yarn biome:ci` exits 1 with 16 pre-existing `format` diagnostics. Do not rewrite
unrelated files. The changed-file command must exit 0, `git diff --check` must
exit 0, and Linux CI must make the full command green. A Windows full run is
acceptable only when every remaining diagnostic is that same pre-existing
CRLF/`format` class and no new path appears.

## Suggested executor toolkit

- Read the official [TypeScript 7.0 side-by-side guidance](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60) before changing dependency aliases or documentation.
- Use the official [TypeScript 7 npm package](https://www.npmjs.com/package/typescript)
  and its installed export map to describe unstable subpaths accurately; do not
  imply that they implement the legacy `typescript` module. The earlier
  `@typescript/native-preview` name is historical for this plan.
- Use the existing Vitest style in
  `packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`.

## Scope

**In scope** (the only files you should modify):

- `package.json`
- `yarn.lock`
- `README.md`
- `packages/vite-plugin-react-docgen-typescript/package.json`
- `packages/vite-plugin-react-docgen-typescript/src/index.ts`
- `packages/vite-plugin-react-docgen-typescript/src/utils/typescript.ts`
- `packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts` — create
- `.changeset/clear-typescript-boundary.md` — create

**Out of scope**:

- Implementing, depending on, or claiming support for TypeScript's unstable
  native API. Plan 007 owns a separate non-shipping feasibility spike.
- Forking, replacing, or patching `react-docgen-typescript`.
- Changing the TypeScript 4.3 lower bound, Vite peer range, or optional-peer
  policy.
- Redesigning watch mode, project-service mode, project selection, or Storybook
  integration.
- Adding a production dependency for semver or module validation.

## Git workflow

- Branch: `codex/002-bound-typescript-compatibility`
- Make one logical commit with a title-style subject, for example
  `Clarify TypeScript compatibility`.
- Do not implement concurrently in one worktree with Plan 004. If Plan 004
  merged first, rebase and run both plans' focused suites plus `index.test.ts`,
  typecheck, and build before completing this plan.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Correct the declared and test-time dependency contract

In `packages/vite-plugin-react-docgen-typescript/package.json`, change the peer
range to the semver-normalized form `>=4.3.0 <7`. Keep it optional and leave the
Vite range unchanged.

In the root development dependencies:

- Replace the normal `typescript` entry with the TypeScript 6 compatibility
  package aliased under the name the plugin imports, using a bounded 6.0 patch
  line such as `npm:@typescript/typescript6@6.0.X`.
- Add `typescript43: npm:typescript@4.3.5` as a runtime compatibility fixture.
  It proves that the new loader guard itself does not raise the existing lower
  peer bound. Full plugin behavior across the entire peer matrix remains the
  separately deferred compatibility-matrix work.
- Add the root-development-only alias
  `typescript7: npm:typescript@7.0.2`. This exact stable package exists only to test the
  unsupported real module shape and must never be imported by production code
  or added to the published package manifest.

The compatibility package exposes a `tsc6` binary, not `tsc`. Change the plugin
workspace's existing `typecheck` script from `tsc --noEmit` to
`tsc6 --noEmit`. Do not rely on the competing `tsc` bins contributed by the
4.3/7 fixture aliases; those aliases are imported by tests only.

Run `yarn install` once to regenerate `yarn.lock`, then run
`yarn install --immutable` to prove the lockfile is complete. Confirm with
`yarn why typescript`, `yarn why typescript43`, and `yarn why typescript7` that
the normal compiler is 6.0 and the fixture aliases are exactly 4.3.5 and 7.0.2.

**Verify**:

- `yarn why typescript` → the root compiler resolves to
  `@typescript/typescript6` 6.0.x under the `typescript` alias.
- `yarn why typescript43` → the lower-bound fixture resolves to TypeScript
  4.3.5.
- `yarn why typescript7` → the test-only alias resolves to `typescript` 7.0.2.
- `yarn exec tsc6 --version` → 6.0.x, and `yarn typecheck` invokes the explicit
  workspace `tsc6 --noEmit` script successfully.
- Reading the published package manifest confirms `>=4.3.0 <7` and neither
  fixture alias is present there.

### Step 2: Add one capability-based TypeScript loader

Create
`packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts`.
Export a small, testable set of functions with these responsibilities:

- Normalize both dynamic-import shapes: a compiler on `module.default` and a
  compiler exposed directly as the namespace.
- Feature-detect the legacy compiler API the plugin actually needs. At minimum
  validate `sys.fileExists`, `sys.readFile`, config parsing, incremental/builder
  program creation, module resolution, preprocessing, and the enum/type-guard
  surface used during generation. Do not reject a module based only on its
  version string.
- Return a value typed as `typeof import("typescript")` only after the checks
  pass.
- On an incompatible shape, throw one stable error that names this plugin, the
  safely observed `candidate.version` string or `unknown`, the supported range
  `>=4.3 <7`, the missing JavaScript compiler API, and the README's
  compatibility section. Do not import `typescript/package.json` merely to
  improve the version label; export maps differ between releases and the
  diagnostic does not depend on package metadata.
- On import failure, throw a distinct load error and preserve the original
  error as `cause`.

Keep the capability list to APIs already used by supported code. Do not add a
strict check merely because an API exists in TypeScript 6; that could silently
raise the declared 4.3 lower bound.

**Verify**:
Add the first focused tests and run
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts`.
The actual `typescript43` and installed TypeScript 6 module shapes must pass the
new guard, while
the actual `typescript7` alias must fail with the controlled compatibility
error rather than a raw property-access exception. If 4.3.5 lacks a capability
that production code truly requires, STOP and document the evidence; do not
quietly preserve a false lower bound or add a 6-only probe.

### Step 3: Route every compiler load through the validated path

In `src/index.ts`, replace the four independent dynamic compiler imports at the
current lines 219, 301, 392, and 1267 with the shared validated loader. Ensure
`ensureInitialized` validates TypeScript before it imports or initializes
`react-docgen-typescript`, creates resolution caches, or chooses an experimental
runtime mode.

In `src/utils/typescript.ts`:

- Change the runtime `typescript` import to a type-only import.
- Make `getTSConfigFile` receive the already validated compiler module as an
  explicit argument.
- Update the root and referenced-tsconfig call sites to pass that same instance.

The separate `typescript/lib/tsserverlibrary.js` import may remain for project
service, but the base compiler compatibility check must always run first so a
TypeScript 7.0 installation gets the stable diagnostic before that import is
attempted.

**Verify**:

- `rg -n 'await import\("typescript"\)|import ts from "typescript"' packages/vite-plugin-react-docgen-typescript/src`
  → only the centralized loader or type-only occurrences remain.
- `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts`
  → all real-version and malformed/load-error cases still pass.

### Step 4: Complete the compatibility contract tests

In `src/__tests__/typescriptCompatibility.test.ts`, cover these named cases:

1. The actual `typescript43` package is accepted by the loader guard. Exercise
   every capability the guard requires, but describe this narrowly: it proves
   the new validation layer does not itself raise the existing 4.3 lower bound,
   not that every plugin runtime mode has been matrix-tested on 4.3.
2. The installed TypeScript 6 compatibility package is accepted and exposes
   the APIs used by default, watch, and project-service initialization.
3. The actual `typescript7` alias is rejected. The error must contain either
   its safely exposed 7.0.2 `version` or `unknown`, plus the supported range,
   missing compiler-API explanation, and documentation pointer. Do not require
   package-json lookup solely to force a version string.
4. Namespace/default module wrappers both normalize correctly.
5. `null`, an empty object, and a version-only mock produce the same controlled
   incompatible-module diagnostic with no `Cannot read properties of undefined`.
6. A rejected importer promise produces the distinct load error and preserves
   its original `cause`.

If it can be done without a production-only injection seam, add one plugin-level
assertion showing build-mode `configResolved` surfaces the compatibility error
before project resolution. The real TS7 alias test is mandatory; do not replace
it with mocks.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts`
→ all named cases pass.

### Step 5: Document the boundary and official workaround

Add a `TypeScript compatibility` section to `README.md` which states:

- Supported compiler API range: TypeScript `>=4.3 <7`.
- TypeScript 7's root npm export does not provide the legacy/stable compiler API
  this plugin and its upstream parser consume.
- Unstable native subpaths exist, but use a different API model and are not a
  supported drop-in workaround for this release.
- Users who need the TypeScript 7 CLI alongside docgen should expose
  `@typescript/typescript6` under the dependency name `typescript`, and install
  TypeScript 7 under another alias for its CLI, following Microsoft's published
  example.
- Native support requires a separate backend implementation and parity/HMR
  evidence; the peer range must not be widened because an experimental spike
  happens to load.

Do not imply that installing both packages automatically makes this plugin use
TypeScript 7 for docgen.

**Verify**:
`rg -n 'TypeScript compatibility|>=4\.3|@typescript/typescript6|unstable|native' README.md`
→ each contract element appears in the new section.

### Step 6: Add a patch changeset

Create `.changeset/clear-typescript-boundary.md` with exactly one patch entry for
`@joshwooding/vite-plugin-react-docgen-typescript`. Summarize the corrected peer
range, early diagnostic, and documented TypeScript 6 compatibility workaround.
Do not edit `CHANGELOG.md` directly.

**Verify**:
`Get-Content -Raw .changeset/clear-typescript-boundary.md` → frontmatter names
only the plugin package at `patch`, followed by a concise user-facing summary.

### Step 7: Run repository-wide verification

Run, in order:

1. `yarn install --immutable`
2. `yarn exec tsc6 --version`
3. `yarn typecheck`
4. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts`
5. If Plan 004 is already `DONE`, `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`
6. `yarn test --run`
7. `yarn build`
8. `yarn exec biome ci package.json packages/vite-plugin-react-docgen-typescript/package.json packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescript.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts`
9. `yarn biome:ci` on Linux CI; apply the documented Windows baseline rule locally
10. `git diff --check`
11. `git status --short`

Expected: all platform-independent commands and changed-file Biome checks exit
0; `tsc6` reports 6.0.x; real 4.3.5/6.0/7.0 loader-contract cases behave as
specified; Linux CI is green; and only the in-scope files plus the plan-index
status update are modified.

## Test plan

- Use the actual aliased TypeScript 4.3.5, 6, and 7 packages for the three core
  contract cases; use small mocks only for malformed and import-failure edges.
- Validate the error's stable semantic fields, not an entire stack trace.
- Existing `index.test.ts` coverage must remain green under TypeScript 6 in all
  three runtime modes.
- The build is part of the test plan because the public declaration bundle must
  continue to reference the `typescript` peer rather than the private
  `typescript7` test alias.

## Done criteria

- [ ] The published peer range is exactly bounded below 7 and remains optional.
- [ ] The repository's normal suite and build pass with the TypeScript 6
      compatibility package exposed as `typescript` and typecheck explicitly
      invokes `tsc6`.
- [ ] The actual TypeScript 4.3.5 module passes every new loader capability
      check, proving this guard does not itself raise the retained lower peer
      bound; no broader matrix-support claim is made.
- [ ] A real TypeScript 7.0 module receives a controlled compatibility error
      before any compiler API dereference or upstream parser initialization.
- [ ] Every production compiler import flows through one capability validator.
- [ ] No production code or published manifest references `typescript7`.
- [ ] README documents the supported range, 7.0 limitation, and official
      side-by-side workaround accurately.
- [ ] A patch changeset exists; `CHANGELOG.md` is untouched.
- [ ] Focused tests, full tests, `tsc6` typecheck, build, changed-file Biome,
      Linux CI, and lockfile checks pass.
- [ ] `plans/README.md` marks Plan 002 `DONE`.

## STOP conditions

Stop and report if:

- Existing in-scope code differs materially from the current-state excerpts.
- TypeScript 6 requires unrelated source changes, weaker compiler options, or
  skipped existing tests.
- The TS7 alias does not resolve reliably under Yarn 4 or resolves to a 6.x API;
  propose a two-entry isolated compatibility job rather than faking the test.
- The real 4.3.5 fixture fails a capability that current production code needs;
  stop and propose either a separately justified peer-bound increase or a
  compatibility implementation. Do not silently claim `>=4.3`.
- TypeScript 7 support requires a separate native backend/parser extraction
  strategy. That work belongs to Plans 006/007 and cannot expand this plan.
- Fixing this requires changing optional-peer behavior or another public API.
- A verification fails twice after one focused correction.

## Maintenance notes

- Keep the unsupported fixture exactly on `7.0.2`. Allowing it to float to 7.1
  could invert the expected capability shape and make the regression misleading;
  Plan 007 owns a separately exact-pinned forward-API probe.
- Keep feature detection even with the peer cap: JavaScript consumers, aliases,
  and package managers do not all enforce peer ranges identically.
- Remove `<7` only in a dedicated production migration that passes the backend
  parity corpus, project-reference/HMR contract, supported-platform matrix, and
  packaging review. A non-shipping unstable-API spike is insufficient.
