# Plan 005: Lock backend-neutral imported-type HMR acceptance contracts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ffd553b..HEAD -- package.json yarn.lock packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts packages/vite-plugin-react-docgen-typescript/src/index.ts`
> Plans 002 and 004 intentionally establish the compiler and selection baseline
> first. Confirm both are `DONE`, the normal `typescript` dependency resolves to
> the exact TypeScript 6 compatibility package selected by Plan 002, and all
> compatibility plus referenced-project selection tests pass. Their manifest,
> lockfile, `src/index.ts`, and focused-test drift is expected. The three files
> owned by this plan are expected not to exist. Any other semantic HMR change is
> a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/002-bound-typescript-compatibility.md`, `plans/004-unify-project-file-selection.md`
- **Category**: tests
- **Planned at**: commit `ffd553b`, revised 2026-07-20

## Why this matters

[Open issue #57](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/issues/57)
reports stale Storybook controls after an imported props type changes, while a
harmless edit to the component makes the new metadata appear. The existing
test directly calls the plugin hook with a mocked module graph, so it does not
prove what Vite delivers or retransforms. Before either repairing the legacy
TypeScript lifecycle or writing a native backend, the repository needs one
backend-neutral, real-Vite contract that distinguishes delivery, dependency
identity, metadata freshness, invalidation selectivity, and recovery.

This plan is characterization only. It records the exact legacy failures on the
planned baseline without skipping them, and lets every future backend run the
same contract with an empty failure allowance. It does not modify production
behavior or claim that issue #57 is resolved.

## Current state

- `packages/vite-plugin-react-docgen-typescript/src/index.ts:646-740` owns the
  component-to-dependency and reverse dependency maps.
- `src/index.ts:1185-1217` finds and invalidates Vite modules but currently
  discards the located `ModuleNode` objects.
- `src/index.ts:1469-1502` can return a transform cached by component source;
  invalidating only Vite's module graph therefore does not prove that docgen
  metadata is fresh.
- `src/index.ts:1647-1710` refreshes backend state and invalidates dependents,
  but the hook returns `undefined`.
- `src/__tests__/index.test.ts:1079-1157` directly invokes `handleHotUpdate`,
  enables both experimental flags (therefore only project-service precedence),
  has no real project reference, and does not observe Vite's hot payload.
- Plan 004 establishes a real root `files: []` plus referenced sibling project
  topology and stable inclusion semantics. Reuse that contract rather than
  creating a conflicting project-membership rule here.
- Vite is already a root development dependency; no dependency or lockfile
  change is needed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Post-Plan-004 baseline | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts` | Existing and Plan 004 tests pass |
| Contract test | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | Infrastructure checks pass and actual semantic failures equal the explicit legacy ledger exactly |
| Full tests | `yarn test --run` | All tests pass without skipped/new todo tests or open-handle warnings |
| Typecheck | `yarn typecheck` | Exit 0, no errors |
| Build | `yarn build` | Package builds successfully; test support is not published |
| Changed-file formatting/lint | `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts` | Exit 0 |
| No hidden test escape | `rg -n '\.(skip|only|todo|fails)\b|test\.(?:skip|only)|it\.(?:skip|only)' packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts` | No output and the expected `rg` exit code 1 |
| Whitespace check | `git diff --check` | Exit 0 |
| Scope check | `git status --short` | Only the three test files and the plan-index status update appear for this plan |

The current Windows checkout has a known line-ending-only Biome baseline: full
`yarn biome:ci` exits 1 with 16 pre-existing `format` diagnostics. Do not
rewrite unrelated files. The changed-file command and `git diff --check` must
exit 0; Linux CI must keep the full repository check green.

## Scope

**In scope** (the only source-tree files you should modify):

- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts` — create

**Out of scope**:

- Any production source, public option, dependency, lockfile, or generated
  snapshot.
- A changeset; characterization has no user-visible package behavior.
- Fixing delivery, path identity, TypeScript freshness, or cache invalidation.
  Plan 008 owns a legacy repair after the backend seam exists.
- TypeScript 7 unstable native subpaths or a native backend; Plan 007 owns that
  non-shipping spike.
- Storybook, Nx, browser automation, private Vite APIs, or Vite's new
  environment `hotUpdate` hook.
- File create/delete membership; this contract edits an existing imported file.

## Git workflow

- Branch: `codex/005-lock-backend-hmr-contract`
- Make one logical commit with a title-style subject, for example
  `Add imported type HMR contract`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Build a backend-neutral real-Vite contract runner

Create `src/__tests__/support/importedTypeHmrContract.ts`. It must accept a
plugin factory rather than import the production plugin itself. The minimum
input contract is:

- a backend/mode label used in test names and observations;
- a generic factory `(options: TOptions) => Plugin` plus the concrete options
  value for that registration; the support module itself must not import the
  production `Options` type;
- one of the two fixture topologies below.

The runner must not accept, import, or inspect an expected-failure ledger.
Expected legacy observations live only in
`support/legacyHmrExpectations.ts`, outside the runner.

Keep the helper independent of TypeScript `Program`, compiler symbols,
`react-docgen-typescript`, and any future native API. Use Vite's public
`createServer`, `transformRequest`, `normalizePath`, watcher, hot channel,
module graph, and `close` APIs. Configure each server with:

```text
configFile: false
middlewareMode: true
appType: "custom"
logLevel: "silent"
optimizeDeps.noDiscovery: true
server.watch: null
server.fs.allow: [the fixture's common temporary root]
```

The no-op public watcher retains Vite's change/HMR listeners while avoiding
duplicate operating-system events. Create every fixture under an OS temporary
directory and close the server plus remove the fixture in `finally`.

Return a typed observation object instead of throwing semantic assertions from
inside the runner. It must separately record:

- infrastructure/setup errors, rejected watcher cycles, and Vite hot
  `{ type: "error" }` payloads;
- initial and post-edit generated metadata;
- dependent and unrelated graph identities;
- every relevant `update` or `full-reload` payload sent by installed Vite 8's
  public `server.environments.client.hot.send` channel; do not spy on the
  backward-compatible `server.hot` wrapper;
- the plugin hook's returned modules when observable through Vite;
- per edit, separate dependent/unrelated invalidation counts and separate
  dependent/unrelated delivery counts;
- component-touch recovery output; and
- a sorted, deduplicated array of semantic failure codes.

Use stable codes with enough granularity to catch an unexpected partial fix:

```text
delivery:first-edit
delivery:second-edit
invalidation:first-edit
invalidation:second-edit
freshness:first-edit
freshness:second-edit
selectivity:delivery:first-edit
selectivity:delivery:second-edit
selectivity:invalidation:first-edit
selectivity:invalidation:second-edit
```

Infrastructure failures—server creation, missing initial metadata, fixture
write failure, a rejected watcher/update cycle, any Vite hot error payload,
timeout machinery failure, cleanup failure—or control failures such as missing
graph nodes, ambiguous graph identity, stale component-touch recovery, or a
leaked handle—must not be converted to semantic codes. The ordinary test must
assert every infrastructure/control condition before comparing the semantic
ledger. Recovery is a validity control, never an allowlist entry.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000`
→ the helper loads and the initial control assertions run; an empty provisional
legacy ledger is expected to fail only by reporting concrete semantic codes.

### Step 2: Add same-project and referenced-project fixtures

The support module must create two disposable topologies:

1. **Same project**: a component imports an interface from a sibling `.ts`
   file; an unrelated component lives in the same tsconfig.
2. **Project reference**: a Vite root tsconfig has `files: []` and references a
   sibling composite UI project containing the component, imported props file,
   and unrelated component. Use Plan 004's explicit parent-directory include
   semantics so file selection cannot mask HMR.

Components must be dependency-free functions returning `null` and contain
`if (import.meta.hot) import.meta.hot.accept()` so each is an explicit HMR
boundary. Configure `shouldExtractValuesFromUnion: true`. The props file must
start with a documented literal union, then receive two dependency-only edits:

- edit 1 adds a distinct union member and changes its JSDoc description;
- edit 2 adds another distinct union member and a second description.

For each write, write contents first, set the new mtime to at least
`max(previousMtime + 2_000 ms, Date.now() + 2_000 ms)` (and advance it again
for every later edit), then emit exactly one
`server.watcher.emit("change", absolutePropsFile)`. Give each edit and the
component-touch recovery its own at-most-10-second deadline under a 60-second
test timeout. Every matrix test registration must also pass `60_000` as its
explicit Vitest per-test timeout so the same deadline applies under both the
focused command and ordinary `yarn test --run`.

Before emitting changes, install a test-only completion probe around the
public `FSWatcher` `change` listener invocation used for the Vite update cycle.
Preserve listener order, `this`, arguments, once semantics, return value, and
rejection exactly; expose the returned thenable as a per-emission cycle marker.
After each emit, await that marker and fail as infrastructure if it rejects or
cannot identify exactly one completed cycle. This barrier waits only for the
watcher/update callback to settle. It must not wait for an HMR payload, a
returned dependent module, or the later forced transform, because zero
delivery is a valid semantic observation. Do not use a sleep, quiet-period
heuristic, or payload arrival as the barrier.

Once the callback has settled, snapshot the zero-or-more outgoing payloads and
hook-return observations for that edit, then explicitly perform the normal
next `transformRequest` for the dependent component and record its metadata.
Never touch component source before those observations. Transform the
unrelated component up front. Address sources outside the Vite root through
`/@fs/${normalizePath(absolutePath)}`.

For each edit, independently record whether the dependent was invalidated and
delivered and whether the unrelated component was invalidated and delivered;
payload absence alone is not evidence that broad invalidation did not occur.

Freeze these predicates in the test rather than deriving them from the
expectation ledger:

- observe module invalidation only at installed Vite 8's public client-
  environment boundary,
  `server.environments.client.moduleGraph.invalidateModule`, after the plugin
  hook returns; do not spy on the backward-compatible `server.moduleGraph`
  wrapper or count transform-cache deletion, reverse-index lookup, or backend
  work as module invalidation. The Plan 008 ownership rule is that dependency
  hooks return affected nodes without pre-invalidating them, so Vite core owns
  the single module-graph invalidation. A future Vite 3–7 matrix may add an
  explicit adapter that falls back to `server.moduleGraph`, but that fallback
  is not inferred or exercised in this Vite 8 contract;
- observe delivery/error payloads at the matching
  `server.environments.client.hot.send` boundary. A future Vite 3–7 adapter may
  explicitly fall back to `server.hot.send`, but this contract does not assume
  that wrapper is used by Vite 8 core;
- record raw occurrence counts and distinct counts by `ModuleNode` object
  identity and, separately, by normalized resolved Vite `id`/`file` path;
  repeated occurrences never become “exactly once” through deduplication;
- `delivery:<edit>` is present unless exactly one outgoing HMR update entry
  references the dependent and no full-reload payload was emitted;
- `invalidation:<edit>` is present unless exactly one dependent invalidation
  occurrence, one dependent object identity, and one dependent resolved ID/path
  were observed;
- `freshness:<edit>` is present unless the forced normal transform contains
  that edit's exact union member and JSDoc description;
- `selectivity:delivery:<edit>` is present when any outgoing update references
  the unrelated component; a full reload adds both `delivery:<edit>` and
  `selectivity:delivery:<edit>` because it is neither dependent delivery nor
  selective delivery; and
- `selectivity:invalidation:<edit>` is present when any unrelated invalidation
  occurrence or identity is observed.

Record returned hook modules separately from actual outgoing HMR delivery.
Their object/path counts are diagnostic evidence, but a returned module does
not satisfy delivery unless the public hot channel emits the matching update.

Only after both observations, append a harmless comment to the component,
advance its mtime, emit its change event, and transform again. Recovery must
show the second union and description; this distinguishes stale component
cache/state from an invalid fixture.

**Verify**:
The test output contains complete observations for both topologies, two edits,
and recovery even when a semantic requirement fails; cleanup leaves no open
handle warning.

### Step 3: Register the legacy matrix with an exact failure ledger

In `viteHmr.contract.test.ts`, register the public default plugin factory for:

- legacy default mode;
- legacy watch mode only;
- legacy project-service mode only; and
- both experimental flags, explicitly asserting project-service precedence.

Run both the same-project and project-reference topologies in all four modes,
for exactly eight fixed legacy row keys. The referenced default and watch rows
are required: project references are part of the legacy contract, not only a
project-service feature.

Create `support/legacyHmrExpectations.ts` containing only the exact ordered
failure-code array for each fixed legacy row key. Keep the registration matrix,
topology, controls, semantic-code calculation, and comparison in
`viteHmr.contract.test.ts`; neither the helper nor the expectation module may
change test topology. Add a meta-test asserting that the matrix row keys and
the expectation-map keys equal the exact eight-key constant, with no missing
or extra entry.

For every row, begin with an empty expectation and run the contract on the
post-Plan-004 baseline. Inspect the returned observations, then populate only
the exact reproducible semantic codes in the expectation module. The committed
assertion must be:

```text
infrastructureErrors === []
allHardControlsPass === true
actualSemanticFailures === exactExpectedFailureLedger
```

Do not use `skip`, `todo`, `it.fails`, snapshot an opaque exception, or weaken
the final freshness assertion. An unexpected failure and an unexpected pass
must both fail CI and force an intentional ledger review. Put issue #57 beside
the applicable ledger entries, with a comment stating that the entry records a
known failure rather than accepting it as correct behavior.

Run the finalized focused command three times consecutively before committing
the expectations. Compare one normalized determinism signature per row:
fixed row key; sorted semantic codes; hard-control booleans; payload kinds and
fixture-relative normalized IDs; per-edit raw occurrence/distinct object/path
counts; and the exact normalized union/JSDoc fields. Exclude absolute temporary
roots, wall-clock timestamps, mtimes, durations, and generated server ports.
The signatures must be identical for every row. Then run the matrix
on the executor's platform and Ubuntu CI. Prefer one shared ledger. If Windows
path identity produces a genuinely different reviewed
result, use an explicit `process.platform` keyed ledger with only the observed
`win32` and default/CI arrays; do not add a wildcard allowance or normalize a
real identity defect out of the observation. A platform difference becomes
input to Plan 008's identity branch.

Also add ordinary passing controls proving initial metadata, direct component
edits, and component-touch recovery. A setup bug must not satisfy a known-
failure expectation.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000`
→ every infrastructure assertion passes and each row's actual failures equal
its reviewed allowlist exactly.

### Step 4: Prove what the contract does and does not cover

If a real pipeline row reproduces stale metadata after the imported type edit
and component-touch recovery is fresh, retain that row as executable issue #57
acceptance coverage. Missing dependent delivery remains a legitimate
`delivery:<edit>` failure even when the forced normal transform is fresh. Only
when actual hot delivery and transformed metadata are both correct, and the
sole difference is the directly observed hook-return shape, should the test
avoid attributing that difference to issue #57 and STOP for separate
Storybook-faithful authorization.

Add a test comment immediately above each non-empty ledger recording:

- observed failure class;
- topology and mode;
- why recovery proves the fixture is healthy; and
- the plan that is allowed to remove the ledger entry (Plan 008 for every
  shipped/supported legacy row; a future production-native plan owns only its
  separate native ledger unless it formally removes legacy support).

The shared runner itself must make no assumptions about expected failures. Plan
007 must create a separate native contract test around the runner with an
explicit empty expectation; it may not change the fixed legacy matrix,
expectations, controls, or failure calculation.

**Verify**:
`rg -n 'issue #57|expectedFailures|infrastructureErrors|semanticFailures' packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts`
→ the ledger, hard infrastructure boundary, and issue attribution are visible.

### Step 5: Run repository-wide verification

Run, in order:

1. Run `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` three consecutive times and compare every row's normalized determinism signature
2. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts`
3. `yarn typecheck`
4. `yarn test --run`
5. `yarn build`
6. `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts`
7. `yarn biome:ci` on Linux CI; apply the documented Windows baseline rule locally
8. `rg -n '\.(skip|only|todo|fails)\b|test\.(?:skip|only)|it\.(?:skip|only)' packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts` (expected: no output and `rg` exit 1)
9. `git diff --check`
10. `git status --short`

Expected: all platform-independent commands other than the intentional no-match
scan exit 0; the hidden-test-escape scan has no output and exits 1; existing
snapshots are unchanged; there are no open handles; and only the three in-scope test files plus
the plan-index status update are modified.

## Test plan

- Run a real Vite server and watcher pipeline, not only a direct hook call.
- Exercise same-project and real project-reference imported props.
- Make two dependency-only edits and inspect fresh union plus JSDoc metadata.
- Transform an unrelated component and assert selective invalidation/delivery.
- Record payload, graph identity, normal transform, and component-touch
  recovery separately so one signal cannot masquerade as the root cause.
- Run all current legacy runtime modes through one backend-neutral factory
  contract.
- Represent known failures with an exact semantic ledger; infrastructure
  failures, unexpected failures, and unexpected passes all fail CI.
- Keep the fixed registration topology and failure calculation outside the
  editable legacy expectation module.

## Done criteria

- [ ] The runner accepts a plugin factory and imports no compiler or parser
      internals.
- [ ] Same-project and referenced-project fixtures use Vite's public server and
      watcher pipeline.
- [ ] Each scenario observes two dependency-only edits before component touch.
- [ ] Initial metadata, cleanup, and recovery are hard infrastructure/control
      assertions, never expected failures.
- [ ] The exact legacy failure ledger is populated from observed baseline
      evidence and rejects both regressions and unexpected fixes.
- [ ] Exactly eight legacy rows run (two topologies by four modes), and a
      key-set meta-test prevents expectation or registration drift.
- [ ] Three identical focused runs produce identical normalized determinism
      signatures before the expectation ledger is finalized.
- [ ] Every matrix registration has an explicit 60-second per-test timeout and
      every edit/recovery phase has an independent 10-second test deadline.
- [ ] The ledger passes on Ubuntu CI and the executor's platform; any reviewed
      Windows-only difference is explicit rather than wildcarded.
- [ ] No test is focused, skipped, todo, or declared with
      `it.fails`/`test.fails`.
- [ ] Issue #57 is described as acceptance coverage only, not resolved.
- [ ] No production source, dependency, lockfile, snapshot, or changeset is
      modified.
- [ ] Focused tests, existing tests, full tests, typecheck, build, formatting,
      Linux CI, and open-handle checks pass.
- [ ] `plans/README.md` marks Plan 005 `DONE`.

## STOP conditions

Stop and report if:

- Plan 002 or Plan 004 is incomplete, the normal compiler is not the pinned
  TypeScript 6 compatibility package, or the referenced sibling cannot be
  transformed.
- Public Vite APIs cannot produce a deterministic observation without private
  APIs or browser/Storybook internals.
- Actual hot delivery and normal transformed metadata are both correct, and
  only the directly observed hook-return shape differs; that alone is not
  enough to claim issue #57. Missing hot delivery remains a semantic failure.
- Component-touch recovery is stale, initial metadata is missing, or cleanup
  leaks a server handle; the fixture is invalid and must not enter a failure
  ledger.
- A semantic outcome varies across three identical runs on the same platform.
- Production source, a dependency, a lockfile, an existing snapshot, or a
  changeset appears necessary.
- A verification fails twice after one focused correction.

## Maintenance notes

- Keep expected failures narrow and named. Removing a ledger entry requires a
  passing observation, not merely a changed hook return.
- A future backend registers the same runner with its own factory. A candidate
  native backend must use an empty ledger before it can pass the feasibility
  gate.
- The contract deliberately edits existing files. File create/delete support
  remains a different cross-version Vite lifecycle problem.
- Do not close issue #57 when this plan lands. Close it only after Plan 008
  ships, or after a separately approved production plan formally removes legacy
  support and ships an equivalent native resolution.
