# Plan 010: Confirm and stabilize ProjectService as the supported TypeScript runtime

> **Executor instructions**: This plan has an evidence gate before any public
> API or rollout work. Follow it step by step and run every verification
> command. If WatchProgram has a material advantage, the compatibility matrix
> cannot support ProjectService across the declared peer range, or any other
> STOP condition occurs, stop and report; do not force the ProjectService
> rollout. When done, update only this plan's status row in `plans/README.md`
> unless a dispatching reviewer says they maintain the index.
>
> **Dependency preflight**: commit `f6af25a` (`Record TypeScript 6 backend
> verdict`) must be an ancestor of `HEAD`,
> `docs/typescript6-language-service-decision.md` must record
> `PROMOTE_PROJECT_SERVICE`, and Plan 009 must be `DONE`. If any condition is
> false, STOP and merge/reconcile Plan 009 first.
>
> **Drift check (run first)**:
> `git diff --stat f6af25a..HEAD -- README.md package.json yarn.lock .changeset .github/runtime-compatibility-matrix.json .github/workflows/ci.yml packages/vite-plugin-react-docgen-typescript/package.json packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/plugin.ts packages/vite-plugin-react-docgen-typescript/src/utils/options.ts packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeMode.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts scripts/benchmark-playground.mjs scripts/verify-runtime-compatibility.mjs experiments/native-docgen/bench experiments/native-docgen/test/typescript6Architecture.typescript6-spike.ts experiments/native-docgen/vitest.typescript6.bench.config.ts experiments/native-docgen/tsconfig.json docs/typescript6-language-service-decision.md docs/typescript-runtime-mode-decision.md`
> Reconcile every semantic change against the current-state excerpts and the
> immutable HMR/parity ledgers before proceeding. Pre-existing Windows
> line-ending-only status is not semantic drift; never stage or normalize it.

## Status

- **Status**: DONE — PROJECT_SERVICE_STABLE_OPT_IN
- **Priority**: P1
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: Plans 005, 006, 008, and 009
- **Category**: performance / migration / tech debt
- **Planned at**: evidence commit `f6af25a`, 2026-07-22

## Why this matters

Plan 009 proved that the existing TypeScript 6 ProjectService path improves
two-edit imported-type HMR by approximately 94% on both large fixtures and
that rewriting `react-docgen-typescript` does not add a further win. It did
not compare the other shipped persistence path,
`EXPERIMENTAL_useWatchProgram`. Consequently, it is sufficient evidence to
reject the direct rewrite, but not yet sufficient evidence to select a single
production runtime from all three implementations users can invoke.

Keeping default builder, WatchProgram, and ProjectService indefinitely
multiplies the TypeScript/Vite/OS/HMR matrix and preserves two interacting
experimental booleans. This plan first fills the WatchProgram evidence gap.
Only if ProjectService is confirmed does it add one stable, explicit two-mode
API, deprecate both experimental flags, and validate ProjectService throughout
the declared TypeScript 4.3–6 and Vite 3–8 ranges. The default does not switch
and WatchProgram is not removed in this release; those are later rollout
decisions backed by one stable opt-in release.

## Current state

### The evidence selects ProjectService over a rewrite, not over WatchProgram

- `docs/typescript6-language-service-decision.md:3-20` records
  `PROMOTE_PROJECT_SERVICE`. On `large-project` and `large-design-system`,
  ProjectService changed cold batch by `+6.8%` and `+10.0%` versus default,
  while imported-type HMR improved by `-94.3%` and `-93.7%`.
- The direct LanguageService extractor was `+118.8%` and `+111.4%` slower than
  ProjectService for the winning HMR metric, so this plan must not inline,
  fork, or replace `react-docgen-typescript`.
- `experiments/native-docgen/bench/typescript6Architecture.typescript6-bench.ts`
  defines four Plan 009 arms: default, ProjectService, and direct extraction
  with DocumentRegistry on/off. It does not define WatchProgram.
- `scripts/benchmark-playground.mjs:18` does know `default`, `watch`, and
  `projectService`, but its current component-self-edit loop polls WatchProgram
  for up to ten seconds and does not provide Plan 009's independent paired
  process, two imported edits, exact delivery/selectivity, memory, request
  count, fixture identity, or comparator controls. It is a developer smoke
  benchmark, not the missing product decision evidence.

### Three runtime implementations and a fourth option combination are live

- `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts:39`
  declares:

  ```ts
  type RuntimeMode = "default" | "projectService" | "watch";
  ```

- `legacyBackend.ts:554-559` routes the two booleans and gives
  ProjectService precedence when both are true:

  ```ts
  const getRuntimeMode = (config: Options): RuntimeMode =>
    config.EXPERIMENTAL_useProjectService
      ? "projectService"
      : config.EXPERIMENTAL_useWatchProgram
        ? "watch"
        : "default";
  ```

- `legacyBackend.ts:357-386` creates a TypeScript semantic-diagnostics
  WatchProgram backed by TypeScript's filesystem watchers. The update path
  waits until the watcher publishes a Program containing the written source.
- `legacyBackend.ts:291-345,880-986` creates a tsserver ProjectService with
  no-op filesystem watchers, opens the Vite component source as an in-memory
  client file, caches file-to-project ownership, updates affected project
  graphs, and bounds open client files to 64.
- Both modes retain the upstream `react-docgen-typescript` parser and pass a
  persistent Program to `parseWithProgramProvider`; the extraction contract is
  expected to remain identical.

### Public options expose implementation details

- `packages/vite-plugin-react-docgen-typescript/src/utils/options.ts:75-79`
  exposes only:

  ```ts
  /** experimental watch mode */
  EXPERIMENTAL_useWatchProgram?: boolean;
  /** experimental project service */
  EXPERIMENTAL_useProjectService?: boolean;
  ```

- `README.md:33-34` documents both flags as experimental and warns that each
  may affect performance. There is no stable runtime selector, deprecation
  guidance, or conflict rule.
- `packages/vite-plugin-react-docgen-typescript/src/index.ts:5-7` always creates
  the same legacy backend factory. Keep that backend seam and the upstream
  parser; runtime selection remains an internal legacy-backend concern.

### Correctness coverage is strong, compatibility coverage is narrow

- `src/__tests__/backendParity.test.ts:263-267` runs the field-level corpus in
  default, WatchProgram, and ProjectService modes.
- `src/__tests__/viteHmr.contract.test.ts:13-40` registers default, watch,
  ProjectService, and both-flags-with-ProjectService-precedence across
  same-project and project-reference topologies. The eight exact legacy ledger
  rows are empty after Plan 008.
- The root package declares TypeScript `>=4.3.0 <7` and Vite 3–8 peer support,
  but `.github/workflows/ci.yml` currently runs only Node 24 with the root
  TypeScript 6 and Vite 8 dependencies. The TypeScript 4.3 test validates the
  compiler capability boundary; it does not instantiate ProjectService from
  that installed peer.
- ProjectService is loaded from
  `typescript/lib/tsserverlibrary.js`, whose constructor and project APIs must
  be exercised in a packed consumer for each supported compiler family before
  the mode can be described as stable.

## Decisions fixed by this plan

These decisions are part of the specification; do not reopen them during
implementation:

1. TypeScript 7 remains research-only. Do not widen the peer range, ship the
   native experiment, or make the high-level native checker a production path.
2. Do not rewrite or inline `react-docgen-typescript`. ProjectService keeps the
   upstream parser and its full callback/options behavior.
3. The stable API is `docgenMode?: "legacy" | "project-service"`.
   `"legacy"` means the current default builder; `"project-service"` means the
   confirmed persistent LanguageService path. Do not expose `"watch"` in the
   stable union.
4. Omitting `docgenMode` continues to select the current legacy default in
   this release. This plan does not silently change existing users' runtime.
5. Setting `docgenMode` together with either experimental flag is an explicit
   configuration error naming the conflicting options. With no stable option,
   old flags preserve their current behavior and both old flags preserve
   ProjectService precedence.
6. Both experimental fields receive TypeScript `@deprecated` annotations and
   one runtime warning per plugin instance. The WatchProgram warning points to
   `docgenMode: "project-service"`; the ProjectService warning points to the
   stable spelling. Deprecation is not removal.
7. A later, separately reviewed plan may make ProjectService the default and
   remove WatchProgram only after at least one stable opt-in release and the
   gates in "Follow-up release gate" below.

## Runtime-mode decision policy

Use the Plan 009 thresholds so the new evidence is comparable. The decision
metrics are end-to-end Vite `coldBatch` and the fixed two-edit
`importedTypeHmr` cycle on `large-project` and `large-design-system`.
`warmCachedBatch`, setup, first transform, teardown, request counts, heap, and
process-tree RSS remain mandatory diagnostics and hard-control inputs but do
not manufacture a timing win from sub-five-millisecond noise.

Apply this order:

0. **BLOCKED — no runtime verdict** if a known-fresh/legacy oracle fails,
   WatchProgram cannot be measured through its real watcher completion,
   evidence identity or hard controls fail, fewer than seven independent pairs
   exist, or decision-row MAD remains above 20% after one prescribed seven-pair
   variance retry.
1. **WATCH_PROGRAM_MATERIAL_ADVANTAGE — stop before rollout** if WatchProgram
   passes all correctness/lifecycle controls, is no more than 15% slower than
   ProjectService on every large decision row, and improves the same decision
   metric by at least 20% on both large fixtures. Record the evidence, mark
   Plan 010 blocked pending architecture review, and do not add the stable API.
2. **PROJECT_SERVICE_CONFIRMED — proceed** if ProjectService passes every hard
   control, is no more than 15% slower than WatchProgram on every large
   decision row, and WatchProgram does not satisfy rule 1. ProjectService may
   win materially or be neutral; neutral evidence selects it because it
   consumes Vite's in-memory source and avoids a second filesystem-watcher
   lifecycle. Its median process-tree RSS must also be within both 20% and
   128 MiB of WatchProgram on each large fixture.
3. **RETAIN_EXPERIMENTAL_MODES — stop before rollout** for valid evidence that
   satisfies neither earlier mapping. Name the exact regression and write a
   narrower profiling/fix plan; do not stabilize an unproven mode.

The comparator must encode these rules and exit `0` only for
`PROJECT_SERVICE_CONFIRMED`, `2` for either valid non-proceed verdict, and `1`
for invalid evidence.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Exact install | `yarn install --immutable` | Exit 0; lockfile unchanged before intentional dependency edits |
| Plan 009 dependency | `git merge-base --is-ancestor f6af25a HEAD` | Exit 0 |
| Experiment typecheck | `yarn exec tsc6 -p experiments/native-docgen/tsconfig.json --noEmit` | Exit 0 |
| Runtime-mode benchmark tests | `yarn vitest --config experiments/native-docgen/vitest.typescript6.config.ts run -t "runtime mode|watch program" --testTimeout=60000` | Exact default/watch/ProjectService controls pass |
| Legacy oracle | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | All exact parity/HMR rows pass; ledgers remain empty |
| Smoke capture | `node experiments/native-docgen/bench/runTypescript6RuntimeModeBenchmarks.mjs --run-id smoke --start-index 1 --samples 1 --output <absolute-temporary-root>/smoke` | One valid independent paired sample outside the repository |
| Primary capture | `node experiments/native-docgen/bench/runTypescript6RuntimeModeBenchmarks.mjs --run-id primary --start-index 1 --samples 7 --output <absolute-temporary-root>/primary` | Seven valid alternating paired samples |
| Runtime decision | `node experiments/native-docgen/bench/compareTypescript6RuntimeModeBenchmarks.mjs --input <absolute-temporary-root>/primary --max-regression 15 --min-improvement 20 --min-duration-ms 5 --max-rss-regression 20 --max-rss-mib 128` | Exit 0 and `PROJECT_SERVICE_CONFIRMED` before rollout may continue |
| Focused runtime tests | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeMode.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | Stable selector, deprecated aliases, parity, selection, and HMR pass |
| Current packed-consumer check | `node scripts/verify-runtime-compatibility.mjs --package <absolute-package.tgz> --typescript 6.0.3 --vite 8.0.0` | Same-project and project-reference two-edit HMR pass; process exits cleanly |
| Production checks | `yarn typecheck`, `yarn test --run`, `yarn build`, `yarn biome:ci` | All exit 0 |
| Package archive | `yarn workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out <new-absolute-temporary-package.tgz>` | Stable option types/docs included; no experiment files included |
| Whitespace | `git diff --check` | Exit 0 |

Benchmark evidence is a local decision gate and remains outside the repository.
The deterministic correctness and compatibility tests belong in CI.

## Scope

**In scope** (the only files the executor may modify):

- `experiments/native-docgen/bench/typescript6Architecture.typescript6-bench.ts`
  — add an explicit runtime-mode schema selection that reuses its real-Vite
  fixture/HMR instrumentation while preserving the Plan 009 default schema and
  four-arm output byte-for-byte in behavior;
- `experiments/native-docgen/bench/runTypescript6RuntimeModeBenchmarks.mjs`
  — create the independent-process runtime-mode orchestrator;
- `experiments/native-docgen/bench/compareTypescript6RuntimeModeBenchmarks.mjs`
  — create the immutable schema/comparator and ordered verdict;
- `experiments/native-docgen/test/typescript6Architecture.typescript6-spike.ts`
  — add only WatchProgram-vs-ProjectService hard-control characterization not
  already covered by the unchanged legacy oracle;
- `experiments/native-docgen/vitest.typescript6.bench.config.ts` and
  `experiments/native-docgen/tsconfig.json` — include the new experiment files;
- `docs/typescript-runtime-mode-decision.md` — create the evidence/verdict and
  rollout-readiness record;
- `packages/vite-plugin-react-docgen-typescript/src/utils/options.ts` — add the
  stable type/option, deprecated aliases, and pure conflict/runtime resolver;
- `packages/vite-plugin-react-docgen-typescript/src/index.ts` — re-export only
  the public `DocgenMode` type alongside the unchanged default plugin export;
- `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts` —
  consume the centralized resolver without changing parser output;
- `packages/vite-plugin-react-docgen-typescript/src/plugin.ts` — issue exact
  once-per-instance deprecation warnings through the Vite plugin context;
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeMode.test.ts`
  — create focused selector/conflict/warning tests;
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts`,
  `projectSelection.test.ts`, and `viteHmr.contract.test.ts` — add stable-mode
  equivalence rows without weakening the legacy rows;
- `scripts/verify-runtime-compatibility.mjs` — create the packed-consumer
  compatibility runner;
- `.github/runtime-compatibility-matrix.json` and `.github/workflows/ci.yml` —
  add the pinned supported-family matrix job;
- `package.json` and `yarn.lock` — add only scripts or exact test tooling
  genuinely required by the compatibility runner;
- `README.md` — document stable mode, deprecations, migration, current default,
  rollback, and the TypeScript 7 revisit position;
- one new `.changeset/*.md` — minor release note for the stable option and
  experimental-option deprecations; and
- this plan plus its row in `plans/README.md` — status only after evidence.

**Read-only boundaries**:

- the backend-neutral contracts in `src/docgen/backend.ts` and host cache/HMR
  ownership in `src/plugin.ts` outside the warning addition;
- `react-docgen-typescript` source and all parser option/callback semantics;
- `src/__tests__/support/backendParityCorpus.ts`,
  `support/importedTypeHmrContract.ts`, and the exact empty legacy expectation
  ledger;
- Plan 007 TypeScript 7 experiments and `docs/native-backend-spike.md`;
- Plan 009's comparator, raw evidence, and
  `docs/typescript6-language-service-decision.md`; and
- package exports, peer ranges, build entry, and runtime dependencies.

**Out of scope**:

- making ProjectService the default in this release;
- deleting WatchProgram, either experimental option, the legacy builder, or
  any existing compatibility test row;
- exposing `LanguageService`, ProjectService, Program, WatchProgram, or
  DocumentRegistry objects through the public or backend-neutral APIs;
- changing docgen output, parser callbacks/options, file-selection semantics,
  cache behavior, HMR selectivity, or project-reference membership;
- speculative ProjectService optimization without an attributed failing
  metric; valid neutral performance is not a mandate to refactor;
- shrinking the TypeScript/Vite peer ranges to make the matrix pass;
- widening support to TypeScript 7, shipping unstable native imports, or
  retrying TS7 without the revisit trigger; and
- committing raw benchmark output or temporary packed-consumer installations.

## Git workflow

- Branch: `codex/010-confirm-and-stabilize-project-service`
- Start only after the Plan 009 commits are present.
- Use reviewable unsigned commits, for example:
  `Compare WatchProgram with ProjectService`,
  `Add stable ProjectService mode`, and
  `Validate supported runtime combinations`.
- Stage explicit paths. Never include unrelated Windows line-ending-only
  entries.
- Do not push, merge, or open a PR unless the operator separately requests it.

## Steps

### Step 1: Freeze the complete shipped-runtime correctness matrix

Before measuring, extend the isolated architecture suite with exactly three
production arms:

1. `legacy-default` — no runtime option;
2. `legacy-watch-program` — `EXPERIMENTAL_useWatchProgram: true`;
3. `legacy-project-service` — `EXPERIMENTAL_useProjectService: true`.

Do not include the direct extractor in the new product verdict. Keep Plan
009's direct evidence immutable and cite it only as the reason a rewrite is
out of scope.

For both same-project and project-reference topologies, assert initial output,
dependencies, project state, two imported-type edits, exact invalidation and
delivery, unrelated-module selectivity, component-touch recovery, create and
delete behavior, reset, overlapping revisions, and idempotent teardown. Reuse
`runImportedTypeHmrContract`; do not fork its expected values. WatchProgram's
completion must come from the Program-created callback after the disk source
is visible, not an arbitrary sleep or polling waiver.

The existing eight legacy HMR rows and parity corpus remain exact. New stable
mode rows are added only after the evidence gate in Step 4; at this step no
production source changes.

**Verify**:
`yarn vitest --config experiments/native-docgen/vitest.typescript6.config.ts run -t "runtime mode|watch program" --testTimeout=60000`
→ all hard controls pass with no expected-failure additions.

### Step 2: Capture fair WatchProgram and ProjectService evidence

Reuse the Plan 009 copied fixtures, hashes, real Vite server, plugin cache,
module graph observer, adaptive 250 ms work floor, process-tree RSS capture,
request counters, watcher completion probe, and two-edit imported-type HMR
cycle. Create a new `typescript6-runtime-mode-bench-v1` result schema rather
than changing the historical Plan 009 schema or comparator.

Select the new schema through one explicit environment value set only by
`runTypescript6RuntimeModeBenchmarks.mjs`. With that value absent, the existing
Plan 009 runner must still emit `typescript6-language-service-bench-v1` with
exactly its original four arms and remain accepted by the unchanged Plan 009
comparator. With the new value present, emit exactly the three shipped-runtime
arms. Do not make schema selection depend on run ID, filename, or arm filters.

Each independent sample must contain every scenario/arm pair for playground,
large-project, large-design-system, monorepo-shared-graph, and
multi-dependent-imported-edit. Alternate complete arm order by global sample
index. Create a fresh plugin/backend/Vite server per independent repetition;
never let ProjectService inherit a warmed OS cache position in every pair.

Record exact Node/OS/architecture, Vite/TypeScript/react-docgen-typescript
versions, commit, run/sample/order, fixture hash, setup, first transform, cold
batch, real warm plugin-cache batch, two-edit imported HMR, teardown,
invalidation/delivery/freshness counts, analyze/update/cache-hit counts, heap,
process-tree RSS, and cleanup controls. For WatchProgram also record Program
publication count and watcher-completion latency; for ProjectService record
LanguageService Program requests, open client-file high-water mark, project
graph update count, and reload fallback count.

The orchestrator must reject repository-local output, overlapping samples,
malformed/missing pairs, version/hash drift, failed children, failed hard
controls, and non-alternating order. Raw output goes under a new absolute OS
temporary directory.

**Verify**:

1. Capture one smoke pair.
2. Give only that directory to the comparator.
3. The comparator exits `1` with exactly
   `At least seven independent paired samples are required`.
4. A one-sample capture through the old Plan 009 runner still contains its
   original four arms and reaches the same authored sample-count rejection in
   the unchanged Plan 009 comparator.

### Step 3: Apply the ordered runtime verdict

Capture seven primary pairs and compare with the authored thresholds. Report
medians, MAD, per-scenario WatchProgram-to-ProjectService deltas, memory high
water, request counts, watcher completion, and all hard controls. If a
decision row has MAD above 20%, capture exactly seven additional alternating
pairs with a new run ID and global indices 8–14, then compare both directories.
Do not change code between primary and variance evidence.

Create `docs/typescript-runtime-mode-decision.md` even for a valid non-proceed
verdict. Include exact commits, versions, commands, raw temporary locations,
fixture hashes, complete summary/attribution tables, memory and lifecycle
diagnostics, and one ordered verdict from this plan.

If the comparator exits `1` or `2`, stop here, update Plan 010 to the truthful
blocked state, and do not touch production/API/docs/changeset files. Only exit
`0` with `PROJECT_SERVICE_CONFIRMED` authorizes Step 4.

**Verify**: comparator exit `0`, zero decision variance, every hard control
true, and the decision document says exactly `PROJECT_SERVICE_CONFIRMED`.

### Step 4: Add one stable two-mode API without changing the default

In `src/utils/options.ts`, export the literal union and add the option with
clear JSDoc:

```ts
export type DocgenMode = "legacy" | "project-service";

/**
 * Select the TypeScript project runtime used by docgen.
 * @default "legacy"
 */
docgenMode?: DocgenMode;
```

Add a pure internal resolver returning the existing internal runtime IDs. It
must reject a stable option combined with either experimental field and must
preserve old-flag behavior when no stable option is present. Strip
`docgenMode` alongside plugin-only fields before forwarding the remaining
object to `react-docgen-typescript`; it must never leak into `ParserOptions`.
Re-export `DocgenMode` from `src/index.ts`; do not export internal runtime IDs
or change the default function signature beyond its updated `Options` shape.

Add `@deprecated` JSDoc to both experimental fields. In `plugin.ts`, warn once
per plugin instance during configuration when an old flag is present. Do not
warn for `docgenMode`. Preserve both-old-flags ProjectService precedence.

Create focused table-driven tests covering omitted/default, both stable
values, each old flag, both old flags, each stable/old conflict, exact warning
count/text, and proof that `docgenMode` is not forwarded to the parser. Extend
the parity, project-selection, and real-Vite HMR matrices with stable
`docgenMode: "project-service"` and assert its behavior signature equals the
old ProjectService flag. Add stable `"legacy"` equivalence without deleting
the old default row.

**Verify**: focused runtime tests pass, the legacy oracle remains exact, and
`rg -n 'docgenMode' packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/utils/options.ts packages/vite-plugin-react-docgen-typescript/src/plugin.ts` shows only resolver, stripping, and warning uses—not parser-option forwarding.

### Step 5: Prove ProjectService across the declared peer families

Create a packed-consumer runner that accepts absolute package archive,
TypeScript version, and Vite version arguments. It must create a fresh OS-temp
consumer outside the repository, install the archive plus exact peers, run a
small same-project and project-reference fixture using
`docgenMode: "project-service"`, perform two imported-type edits through a real
Vite server, assert fresh descriptions/unions and exact dependent delivery,
close the server, and prove the process exits without open watcher handles.
Never import source files from the repository in this runner: validate the
actual packed package.

Add a pinned CI include matrix containing these representative combinations:

| TypeScript | Vite | Purpose |
|---:|---:|---|
| 4.3.5 | 3.2.11 | declared lower bounds |
| 4.9.5 | 4.5.14 | late TypeScript 4 / Vite 4 |
| 5.0.4 | 5.4.21 | first TypeScript 5 / late Vite 5 |
| 5.4.5 | 6.1.0 | mid TypeScript 5 / Vite 6 |
| 5.9.3 | 7.2.4 | late TypeScript 5 / Vite 7 |
| 6.0.3 | 8.0.0 | current upper families |
| 4.3.5 | 8.0.0 | oldest compiler with newest Vite |
| 6.0.3 | 3.2.11 | newest compiler with oldest Vite |

The JSON matrix is the source of truth and the workflow reads it; do not
duplicate version lists in shell. Use Node 24 consistently with current CI.
The job builds and packs once per matrix entry, runs the packed-consumer
script, and uploads no package. Exact installation failures, missing
`tsserverlibrary.js`, ProjectService API drift, HMR failure, or hanging teardown
are product incompatibilities—not test skips.

If any supported combination fails, STOP. Do not shrink peer ranges, add an
automatic version-dependent default, or describe ProjectService as stable.
Record the failed pair and create a narrower compatibility-adapter plan.

**Verify**: current TS6/Vite8 packed-consumer command passes locally; CI matrix
syntax is valid; every matrix row passes in GitHub Actions before merge.

### Step 6: Document the staged convergence and TypeScript 7 revisit gate

Update README options and compatibility sections with:

- `docgenMode`, its two values, and the unchanged `"legacy"` default;
- `"project-service"` as the recommended stable opt-in after the confirmed
  WatchProgram comparison;
- migration examples from each experimental flag;
- the exact conflict rule and old-both-flags compatibility behavior;
- WatchProgram and both old names as deprecated but still functional in this
  release;
- `"legacy"` as the explicit rollback path;
- no claim that TypeScript 7 is supported; and
- a note that TS7 will be reconsidered only when a stable programmatic project
  API or a documented batched high-level checker removes the Plan 007 request
  amplification, followed by the same parity/HMR/package/performance gates.

Add a minor changeset. It must announce the stable option and deprecations, not
announce a default switch or removal.

In the decision document, add a **Follow-up release gate** requiring all of:

1. at least one published stable-opt-in release;
2. no unresolved correctness/HMR/teardown regression attributable to
   ProjectService;
3. the pinned compatibility matrix still green;
4. the runtime benchmark repeated on the release candidate with ProjectService
   within the same 15%/memory budgets; and
5. an explicit next-major plan to make ProjectService default, remove
   WatchProgram and both experimental flags, and retain `docgenMode: "legacy"`
   for one rollback window.

**Verify**: README search finds the stable option, deprecation, unchanged
default, rollback, and TS7 trigger; the changeset names only this package and
uses `minor`.

### Step 7: Close with production and package-isolation gates

Run experiment typecheck/tests, legacy oracle, focused runtime tests, full
production typecheck/tests/build/Biome, comparator replay, compatibility
runner, and `git diff --check`. Pack to a new absolute temp path after the
build, list and extract it, and scan archive names/content.

The package must contain the `DocgenMode` declarations and stable runtime code
but no `experiments/`, raw evidence, comparator, control backend, or TypeScript
7 code. Confirm package peer ranges, exports, dependencies, and default
behavior are unchanged. Confirm the only public API addition is `docgenMode`
and its exported literal type, with deprecated fields retained.

**Verify**: every command in the command table exits as specified; package
scan is clean; public diff matches the authored option/docs/deprecation only;
Plan 010 becomes `DONE — PROJECT_SERVICE_STABLE_OPT_IN`.

## Test plan

- Reuse the fixed real-Vite HMR runner for default, WatchProgram, and
  ProjectService before any production edit.
- Seven independent paired benchmark samples plus the prescribed variance
  retry; no in-process pseudo-repetitions may satisfy sample count.
- Add table-driven `runtimeMode.test.ts` cases for stable values, legacy
  aliases, conflicts, warnings, default, and precedence.
- Extend canonical field-level parity and project-selection matrices for both
  stable values without removing experimental rows.
- Extend real-Vite same-project/project-reference HMR with stable
  ProjectService and stable legacy behavior-signature equivalence.
- Packed-consumer matrix covers TypeScript 4.3/4.9/5.0/5.4/5.9/6 and Vite
  3/4/5/6/7/8, including cross-boundary pairs.
- Full root tests remain production-only; isolated benchmark files are not
  discovered by the normal `*.test.*` pattern.
- Package scan proves benchmark/native experiments cannot ship.

## Done criteria

- [ ] Plan 009 commits and `PROMOTE_PROJECT_SERVICE` decision are present.
- [ ] WatchProgram and ProjectService have seven valid independent paired
      samples with exact freshness/selectivity/HMR/teardown controls.
- [ ] The unchanged Plan 009 runner/comparator still recognize their original
      schema and four arms; Plan 010 evidence uses a separate schema identity.
- [ ] The ordered comparator records `PROJECT_SERVICE_CONFIRMED`; any other
      valid or invalid result stops before public rollout.
- [ ] `docgenMode?: "legacy" | "project-service"` is the only new stable
      selector; omitted behavior remains legacy for this release.
- [ ] Both experimental options remain functional, are deprecated, warn once,
      and cannot be combined with `docgenMode`.
- [ ] Stable ProjectService is field-level and HMR-equivalent to the existing
      ProjectService flag; stable legacy is equivalent to the current default.
- [ ] Every pinned TypeScript 4.3–6 / Vite 3–8 packed-consumer row passes.
- [ ] No TypeScript 7 support claim, peer widening, parser rewrite, default
      switch, WatchProgram removal, or backend-contract change occurred.
- [ ] Production typecheck, full tests, build, Biome, experiment tests,
      comparator replay, compatibility runner, package scan, and whitespace
      checks pass.
- [ ] README and a minor changeset document the stable opt-in, deprecations,
      rollback, unchanged default, later removal gate, and TS7 revisit trigger.
- [ ] `plans/README.md` records
      `DONE — PROJECT_SERVICE_STABLE_OPT_IN`.

## STOP conditions

Stop and report instead of improvising if:

- commit `f6af25a` is absent or Plan 009 evidence/contracts drifted;
- the unchanged parity/HMR oracle gains any failure or expected-failure entry;
- WatchProgram cannot be observed without sleeps, polling waivers, bypassing
  Vite, or changing production behavior;
- evidence is repository-local, incomplete, non-alternating, identity-drifted,
  or retains decision MAD above 20% after the one allowed retry;
- the ordered verdict is not `PROJECT_SERVICE_CONFIRMED`;
- ProjectService exceeds either authored RSS budget against WatchProgram;
- stable mode requires changing parser output/options, the backend-neutral
  seam, file selection, cache semantics, or HMR delivery;
- any pinned TypeScript/Vite packed-consumer pair fails or hangs twice;
- passing compatibility appears to require shrinking peer ranges, silently
  selecting legacy by compiler version, or importing private TypeScript files
  beyond the already shipped `tsserverlibrary.js` ProjectService path;
- productionization requires a new runtime dependency or package export;
- an optimization is proposed without an attributed failing decision metric;
  or
- any step requires TypeScript 7, a direct extractor, or inlining
  `react-docgen-typescript`.

## Maintenance notes

- This plan deliberately leaves three internal runtimes for one deprecation
  window. The stable public surface has two choices; the next-major follow-up
  removes WatchProgram and old flags only after real release evidence.
- Reviewers should scrutinize WatchProgram completion, arm order, evidence
  identity, stable/legacy conflict behavior, warning cardinality, packed-peer
  resolution, TS4.3 ProjectService construction, and teardown handles.
- ProjectService uses tsserver APIs that can drift inside the supported peer
  range. Keep the packed-consumer matrix pinned and treat a matrix failure as a
  release blocker, not a reason to skip an old family silently.
- `docgenMode` is intentionally backend-neutral vocabulary. Do not expose
  TypeScript objects or add a `native` value until a later production plan
  passes the full gates.
- Do not optimize ProjectService merely because it is becoming stable. Plan
  009 already shows excellent HMR; only a reproducible cold, memory, or
  lifecycle budget miss should create a focused optimization plan.
