# Plan 009: Select the production TypeScript 6 LanguageService architecture

> **Executor instructions**: This is an evidence and architecture-selection
> plan, not permission to publish another backend. Follow every step and gate in
> order. Preserve the shipped legacy output and the fixed HMR oracle. Record
> exactly one ordered `PROMOTE_PROJECT_SERVICE`, `BUILD_DIRECT_BACKEND`, or
> `RETAIN_CURRENT` verdict only after the evidence is valid. If an
> infrastructure or oracle control prevents a fair comparison, record
> `BLOCKED` without a verdict. When done, update the status row in
> `plans/README.md` unless a dispatching reviewer explicitly owns the index.
>
> **Drift check (run first)**:
> `git diff --stat ef595f9..HEAD -- packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/plugin.ts packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/utils/options.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/backendParityCorpus.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts experiments/native-docgen/src/legacyLanguageServiceBackend.ts experiments/native-docgen/test experiments/native-docgen/bench experiments/native-docgen/vitest.typescript6.config.ts experiments/native-docgen/vitest.typescript6.bench.config.ts experiments/native-docgen/tsconfig.json docs/typescript6-language-service-decision.md`
> If a read-only production contract/oracle changed, reconcile it before
> proceeding. Any unexplained semantic drift is a `BLOCKED` condition. The
> repository may still show pre-existing Windows line-ending-only status in
> files outside this plan; do not stage, format, or normalize those files.

## Status

- **Status**: DONE — PROMOTE_PROJECT_SERVICE
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plans 006, 007, and 008
- **Category**: performance / direction
- **Planned at**: commit `ef595f9`, 2026-07-22

## Why this matters

The project already has two different TypeScript 6 LanguageService paths, but
the previous benchmark did not compare them directly. The shipped
`EXPERIMENTAL_useProjectService` mode supplies a persistent LanguageService
`Program` to `react-docgen-typescript`; the private control uses a persistent
LanguageService plus a small direct extractor. The latter refreshed imported
metadata in roughly 96–113 ms versus 583–596 ms for the default adapter in the
Plan 007 fixtures, but that comparison combines session architecture and
extractor changes and omits the shipped project-service arm.

Choosing a rewrite from that evidence would be premature. This plan measures
the current project-service path and the direct extractor under the same Vite,
fixture, cache, HMR, ordering, and process controls. It selects the least costly
architecture that produces a material user-visible improvement. A later plan
owns production hardening and rollout of the selected approach.

## Current state

### Production backend seam and default

- `packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts:93-119`
  defines the compiler-neutral `DocgenBackend`/factory lifecycle. Do not add
  LanguageService, Program, Symbol, DocumentRegistry, or Vite objects to it.
- `packages/vite-plugin-react-docgen-typescript/src/index.ts:1-8` always creates
  the shipped plugin with `createLegacyBackendFactory(config)`:

  ```ts
  export default function reactDocgenTypescript(config: Options = {}): Plugin {
    return createPlugin(config, createLegacyBackendFactory(config));
  }
  ```

- `packages/vite-plugin-react-docgen-typescript/src/utils/options.ts:77-79`
  exposes the existing `EXPERIMENTAL_useWatchProgram` and
  `EXPERIMENTAL_useProjectService` flags. This plan must not add, rename,
  document, or change the semantics of a public option.

### Existing shipped LanguageService path

- `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts:291`
  creates a TypeScript `ProjectService` when the project-service mode is
  selected.
- `legacyBackend.ts:959-986` opens the current in-memory component source,
  chooses/caches the owning project, and obtains its persistent LanguageService
  `Program`.
- `legacyBackend.ts:1182-1198` gives that `Program` to
  `react-docgen-typescript` through `parseWithProgramProvider`. This preserves
  the full upstream parser option/callback contract while reusing compiler
  state.
- `legacyBackend.ts:60` bounds open project-service files to 64 and the update
  path refreshes the owning projects. Plan 008 already made both edits in the
  real-Vite HMR matrix exact.

### Existing private direct extractor

- `experiments/native-docgen/src/legacyLanguageServiceBackend.ts:320-528`
  implements the same neutral backend contract with a persistent TypeScript 6
  LanguageService.
- `legacyLanguageServiceBackend.ts:416-422` creates one LanguageService and an
  optional `DocumentRegistry`; the registry currently belongs to that one
  backend rather than a multi-project manager.
- `legacyLanguageServiceBackend.ts:42-82` flattens the root and referenced
  configs into one file set but retains only one compiler-options object. That
  is sufficient for its existing control fixture, not proof for referenced
  projects with different options.
- `legacyLanguageServiceBackend.ts:172-266` implements only the must-have direct
  extraction slice. It supports union values and a neutral prop-filter shape,
  but `componentNameResolver` deliberately throws at lines 185-188 and it does
  not implement the full `ParserOptions` surface.
- `legacyLanguageServiceBackend.ts:431-472` gets one Program per analysis,
  extracts components, and computes dependencies directly. Updates are
  versioned and synchronous; reset/dispose release the service.

### Existing evidence and missing attribution

- `docs/native-backend-spike.md:125-142` records the prior three-arm medians.
  The direct TS6 control was much faster for imported edits, approximately
  equal for first-component work, and slower for direct warm extraction.
- That benchmark compared `legacy-default`, direct TS6 with registry on/off,
  and native TS7. It did **not** contain
  `createLegacyBackendFactory({ EXPERIMENTAL_useProjectService: true })`, so it
  cannot tell whether the gain came from persistence already available in the
  shipped plugin or from rewriting extraction.
- `scripts/benchmark-playground.mjs:28,383-391` already measures public default,
  watch, and project-service modes end to end, including warm transforms and
  HMR, but it cannot instantiate the private direct backend.
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts:642`
  accepts an arbitrary plugin factory. Reuse it for direct-backend correctness;
  do not fork its expectations.

## Decision hypotheses

Evaluate these in order; do not assume the direct extractor should win:

1. **Existing project service**: persistence is the important improvement and
   the upstream parser is not the limiting factor. If true, the next production
   plan should stabilize/promote the existing mode and avoid a parser rewrite.
2. **Direct backend**: removing the upstream parser layer provides a material
   additional improvement. If true, the next plan must build full parser-option
   parity around a per-tsconfig LanguageService manager with a shared
   `DocumentRegistry`.
3. **Current default**: neither LanguageService path delivers a repeatable
   end-to-end gain without unacceptable regressions. If true, retain the
   current default and optimize a narrower measured hotspot instead.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Exact install | `yarn install --immutable` | Exit 0; exact TypeScript 6 and existing aliases remain unchanged |
| Experiment typecheck | `yarn exec tsc6 -p experiments/native-docgen/tsconfig.json --noEmit` | Exit 0 |
| TS6 architecture tests | `yarn vitest --config experiments/native-docgen/vitest.typescript6.config.ts run --testTimeout=60000` | Infrastructure controls pass; exact ledgers match |
| Legacy oracle | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | 29 existing tests pass and all legacy ledgers remain empty |
| Benchmark capture | `node experiments/native-docgen/bench/runTypescript6Benchmarks.mjs --run-id primary --start-index 1 --samples 7 --output <absolute-temporary-evidence-root>/primary` | Seven independent paired process results outside the repository |
| Benchmark decision | `node experiments/native-docgen/bench/compareTypescript6Benchmarks.mjs --input <absolute-temporary-evidence-root>/primary --max-regression 15 --min-improvement 20 --min-duration-ms 5` | Exit 0 for a valid winning architecture; exit 2 for valid retain-current evidence; exit 1 only for invalid evidence |
| Production checks | `yarn typecheck`, `yarn test --run`, `yarn build` | All pass |
| Formatting | `yarn exec biome ci <all changed JS/TS/JSON files>` | Exit 0, no fixes |
| Public-surface diff | `git diff -- packages/vite-plugin-react-docgen-typescript/package.json packages/vite-plugin-react-docgen-typescript/build.config.ts packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/utils/options.ts README.md` | Empty |
| Package isolation | `yarn workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out <absolute-temporary-plugin.tgz>` | Archive contains no experiment or new backend implementation |
| Whitespace | `git diff --check` | Exit 0 |

Benchmark timing is a local decision gate, not a generic CI wall-clock test.
Correctness, exact selectivity, HMR delivery, teardown, and output parity remain
deterministic test gates.

## Scope

**In scope** (the only files the executor may modify):

- `experiments/native-docgen/src/legacyLanguageServiceBackend.ts` — add only
  instrumentation or correctness needed to make the control measurable; do not
  turn it into production code.
- `experiments/native-docgen/test/typescript6Architecture.typescript6-spike.ts`
  — create the architecture/parity and real-Vite HMR ledger.
- `experiments/native-docgen/bench/typescript6Architecture.typescript6-bench.ts`
  — create the four-arm end-to-end Vite benchmark.
- `experiments/native-docgen/bench/runTypescript6Benchmarks.mjs` — create the
  independent-process orchestrator.
- `experiments/native-docgen/bench/compareTypescript6Benchmarks.mjs` — create
  the schema validator, summary, threshold evaluation, and verdict input.
- `experiments/native-docgen/vitest.typescript6.config.ts` — create an isolated
  test config including only `**/*.typescript6-spike.ts`.
- `experiments/native-docgen/vitest.typescript6.bench.config.ts` — create an
  isolated benchmark config including only `**/*.typescript6-bench.ts`.
- `experiments/native-docgen/tsconfig.json` — include the new isolated files.
- `docs/typescript6-language-service-decision.md` — create the evidence and
  ordered verdict record.
- `plans/009-select-typescript6-language-service-architecture.md` and
  `plans/README.md` — update status only after a valid result.

**Read-only boundaries**:

- all files under
  `packages/vite-plugin-react-docgen-typescript/src/docgen`, including the
  legacy backend and neutral contract;
- the public entry, options, manifests, build config, README, lockfile, and
  changesets;
- the existing parity corpus, HMR runner, and empty legacy expectation ledgers;
- the native backend, native parity/HMR tests, and Plan 007 benchmark result
  semantics; and
- all benchmark fixtures under `benchmarks/fixtures` and `playground`.

**Out of scope**:

- a public or undocumented backend selector, new experimental flag, default
  switch, peer-range change, changeset, release note, or support claim;
- copying/inlining `react-docgen-typescript`, implementing missing direct-parser
  options, or deleting the dependency;
- changing legacy runtime behavior to make one arm look better;
- using `typescript/lib/tsserverlibrary` internals in the direct control, or
  exposing `LanguageService`, `Program`, `Symbol`, or `DocumentRegistry`
  through the neutral backend contract;
- modifying the TypeScript 7 prototype or retrying its benchmark; and
- writing benchmark evidence into the repository.

## Git workflow

- Branch: `codex/009-select-typescript6-language-service-architecture`
- Use reviewable unsigned commits with imperative messages matching the current
  branch, for example `Compare TypeScript 6 language service paths` and
  `Record TypeScript 6 backend verdict`.
- Do not stage the repository's unrelated line-ending-only worktree entries.
- Do not push or open a PR unless the operator separately instructs it.

## Steps

### Step 1: Freeze a fair four-arm identity and correctness preflight

Define exactly these arms in the new test/benchmark files:

1. `legacy-default` — `createLegacyBackendFactory(options)`;
2. `legacy-project-service` — the same factory/options plus
   `EXPERIMENTAL_useProjectService: true`;
3. `direct-language-service-registry` —
   `createTypescript6ControlFactory({...options, documentRegistry: true})`;
4. `direct-language-service-no-registry` — the same control with the registry
   disabled.

Use the same Vite root, tsconfig, include/exclude selection, parser options,
component sources, edit sequence, cache policy, and process for all four arms.
Do not compare the project-service arm with a different fixture or with disk
source while another arm receives an overlay.

Before measuring time, assert for every arm:

- initialization succeeds and the project state contains the same normalized
  config/docgen/tracked file identities;
- the initial DTO, dependencies, and generated transform are present;
- the first and second imported-type edits produce fresh descriptions and union
  values;
- only dependent modules are invalidated/returned/delivered exactly once;
- an unrelated component is neither invalidated nor delivered;
- the component-touch recovery remains fresh; and
- server/backend teardown completes and is idempotent.

The known shipped project-service row must match the existing empty legacy HMR
ledger. Run the direct arms through the unchanged
`runImportedTypeHmrContract` runner in both `same-project` and
`project-reference` topology. Record exact direct semantic failure arrays in a
separate architecture ledger; infrastructure errors, error payloads, missing
graph identities, or cleanup failures may never be recorded as expected
semantic failures.

**Verify**:
`yarn vitest --config experiments/native-docgen/vitest.typescript6.config.ts run -t "preflight|HMR" --testTimeout=60000`
→ project-service failures are empty; direct failures are exact and all hard
controls pass. Any host failure shared with the shipped oracle is `BLOCKED`.

### Step 2: Attribute persistence, extraction, and registry effects

Create a versioned `typescript6-language-service-bench-v1` schema and capture
the four arms in one fresh child process per paired sample. Alternate complete
arm order using the global sample index; do not always run the direct backend
after the legacy arms. Each row must record:

- run ID, global sample/order, scenario, fixture hash, arm ID, exact TypeScript
  and `react-docgen-typescript` versions where applicable;
- Node, OS, architecture, Vite version, plugin/backend schema;
- Vite `configResolved`, first transform, cold component batch, warm cached
  batch, and a fixed two-edit imported-type HMR cycle;
- exact invalidation/returned/delivery counts and fresh metadata for both edits;
- backend analyze/update/cache-hit counts, LanguageServices created, Program
  requests, and DocumentRegistry setting;
- JS heap and process-tree RSS; and
- teardown/cleanup controls.

The warm metric must exercise the real plugin memory cache. A benchmark that
calls `backend.analyze` again for unchanged source is not a Vite warm-transform
measurement and cannot choose the product architecture. Use real Vite public
hooks/module graph for the edit cycle, matching the shared HMR runner's
semantics.

Use the existing `playground`, `large-project`, and `large-design-system`
fixtures plus the existing monorepo-shared-graph and multi-dependent edit
shapes. Hash all generated inputs. Adaptively repeat non-teardown measured work
to at least 250 ms without reusing a backend between independent repetitions;
cache-warm operations may repeat inside one initialized repetition. Preserve
the Plan 007 correction that teardown receives one positive observation rather
than thousands of helper/session creations.

The orchestrator must:

- reject repository-local evidence paths and overlapping run IDs/sample
  numbers;
- launch the exact installed Vitest CLI from the experiment directory;
- produce a run manifest, unique Vitest JSON, and unique custom JSON per child;
- reject nonzero children, missing/duplicate pairs, environment/version/hash
  drift, malformed metrics, or failed hard controls before comparison; and
- retain raw evidence only under an absolute OS temporary directory.

**Verify**:
run one focused smoke sample, then intentionally give the comparator only that
sample. The child must pass and the comparator must reject it with exit 1 and
`At least seven independent paired samples are required`.

### Step 3: Collect primary and prescribed variance evidence

Run:

```text
node experiments/native-docgen/bench/runTypescript6Benchmarks.mjs --run-id primary --start-index 1 --samples 7 --output <absolute-temporary-evidence-root>/primary
```

Then compare with `--max-regression 15 --min-improvement 20
--min-duration-ms 5`. Report medians, median absolute deviation, and these
separate attribution deltas for every metric/scenario:

1. `legacy-default` → `legacy-project-service` measures persistent
   ProjectService/LanguageService effects while retaining the upstream parser;
2. `legacy-project-service` → `direct-language-service-registry` measures the
   direct extractor difference under persistent compiler state; and
3. direct registry-off → registry-on measures registry effects.

If any decision metric has MAD above 20%, capture seven more alternating pairs
under `<evidence-root>/variance` with run ID `variance` and start index 8, then
compare both directories. Residual high variance in a decision row after this
retry is `BLOCKED`; diagnostic teardown variance alone is not.

Do not optimize an arm between primary and variance runs. If a code change is
needed, invalidate the evidence and restart at global sample 1 under a new
evidence root.

**Verify**: comparator exit is 0 or 2, never 1; all correctness/selectivity
controls pass and every decision row has usable dispersion.

### Step 4: Bound the direct backend's production-hardening cost

This step is characterization only; do not implement the missing features.
Build a field-level ledger comparing both direct arms with the shipped
project-service arm for:

- every row in `backendParityCorpus`, including raw union/value ordering,
  dependencies, project files, runtime targets, defaults, descriptions, tags,
  declarations, and multiple-component order;
- empty extraction and recoverable error dependency preservation;
- all current `ParserOptions`: static/function `propFilter`,
  `componentNameResolver`, literal enum extraction, removal of undefined from
  optional props, union extraction, children filtering, saved string values,
  prop-tag maps, expression inclusion, and custom component types;
- named/default exports, local export lists, forwardRef, memo, class/stateful
  components, methods, HOCs, polymorphic/default generics, compound/member
  components, namespace imports, inherited DOM props, and discriminated unions;
- two referenced tsconfigs with different compiler options, path aliases,
  ambient declarations, package declarations, and symlinked workspace paths;
  and
- source change/create/delete, config reset, overlapping revisions, and
  disposal.

Classify each non-exact row as `missing option`, `missing component pattern`,
`project-manager gap`, `intentional improvement`, or `legacy defect retained`.
Do not normalize ordering or waive callback gaps. Because TypeScript 6 uses the
same legacy symbol model, supporting `componentNameResolver` is technically
possible; its current controlled failure is implementation scope, not an API
incompatibility.

Estimate production work from this ledger. If a direct follow-up is selected,
the proposed architecture must be one public LanguageService per parsed
tsconfig/reference project, a manager-scoped shared `DocumentRegistry`, a
shared immutable source overlay/version map, deterministic file-to-project
routing, and complete disposal. Do not propose the current flattened
single-options control as production architecture.

**Verify**:
`yarn vitest --config experiments/native-docgen/vitest.typescript6.config.ts run -t "parity|option|project manager|lifecycle" --testTimeout=60000`
→ every row is field-level exact or appears once in the immutable categorized
ledger; no infrastructure failure is categorized.

### Step 5: Record one ordered verdict

Create `docs/typescript6-language-service-decision.md` containing exact commits,
versions, architecture arms, raw evidence locations, fixture hashes, medians,
MAD, memory/request counts, HMR/parity ledgers, direct hardening inventory, and
one verdict. Apply the following order:

0. **BLOCKED — no verdict** if the shipped oracle drifts/fails, a known-fresh
   Vite preflight fails, exact dependencies cannot run, benchmark evidence is
   invalid, or decision timing remains unusable after the variance retry. Name
   the exact retry condition and keep Plan 009 incomplete.
1. **PROMOTE_PROJECT_SERVICE** if the shipped project-service arm retains exact
   public output/HMR and, on both large fixtures, every end-to-end decision
   metric is within 15% of default while the same metric—cold batch or
   two-edit imported HMR—improves at least 20%. The direct arm must not beat
   that winning metric by a further 20% on both fixtures. Recommend a separate
   rollout plan for the existing path; do not rewrite the parser.
2. **BUILD_DIRECT_BACKEND** if the registry-on direct arm passes source,
   reference, dependency, two-edit selective HMR, and teardown hard gates; is
   at most 15% worse than project service on every end-to-end decision metric;
   and improves the same cold or imported-HMR metric by at least 20% against
   both default and project service on both large fixtures. Record every public
   parity gap and estimate it; recommend a separate full-parity production plan
   using a per-tsconfig manager. This verdict does not mean the current control
   is shippable.
3. **RETAIN_CURRENT** if valid evidence satisfies neither earlier performance
   mapping, or if the direct backend's hard correctness fails. Name the measured
   hotspot or missing capability that would justify a narrower retry; do not
   manufacture a rollout plan.

Strong isolated-backend timing cannot override end-to-end Vite results,
correctness, or selectivity. A neutral performance result is
`RETAIN_CURRENT`, not permission to choose the more complex architecture.

### Step 6: Verify isolation and close the plan

For every completed verdict:

1. Run immutable install, experiment typecheck, the complete TS6 architecture
   suite, unchanged legacy oracle, full production tests/typecheck/build, Biome
   on every changed code file, comparator validation, and `git diff --check`.
2. Pack the actual production package to a new absolute temporary path, list
   and extract it, and scan every archive name/text file. No experiment,
   `Typescript6ControlBackend`, direct-extractor ID, or new backend chunk may be
   present.
3. Confirm the public-surface diff command is empty and no manifest, lockfile,
   README, changeset, public entry, or options file changed.
4. Update Plan 009 in `plans/README.md` to `DONE — <verdict>`, or
   `BLOCKED — <reason>` without a verdict.

Expected: this plan changes evidence only. Users see no new API or behavior.

## Test plan

- Isolated architecture test config cannot be discovered by the ordinary root
  `*.test.*` pattern; root `yarn test --run` stays production-only.
- Known-fresh real-Vite preflight plus exact HMR ledgers for four arms and two
  topologies.
- Field-level DTO/dependency/project parity on the canonical corpus.
- Immutable option/component-pattern/project-manager gap ledger.
- Two edits, unrelated selectivity, recovery, create/delete/reset, and
  teardown.
- Seven paired, alternating, independent processes with a variance retry when
  prescribed.
- End-to-end Vite cache and HMR timing, not repeated direct `analyze` calls for
  the warm metric.
- Final production archive and public-surface isolation.

## Done criteria

- [x] One ordered verdict is recorded, or `BLOCKED` contains no verdict and
      names the exact retry condition.
- [x] `legacy-default` → `legacy-project-service` and project-service → direct
      deltas are separately reported; no gain is misattributed.
- [x] Every benchmark sample passes freshness, exact selectivity, HMR delivery,
      and teardown controls.
- [x] Direct parser-option, component-pattern, project-manager, and lifecycle
      gaps are complete and field-level classified.
- [x] No production source/public surface, manifest, lockfile, changeset,
      README support claim, peer range, or packed artifact changed.
- [x] Immutable install, experiment typecheck/tests, 29-test legacy oracle,
      production typecheck/full tests/build, Biome, archive scan, public diff,
      and whitespace checks pass.
- [x] `plans/README.md` records `DONE — PROMOTE_PROJECT_SERVICE`,
      `DONE — BUILD_DIRECT_BACKEND`, `DONE — RETAIN_CURRENT`, or a truthful
      `BLOCKED — <reason>`.

## STOP conditions

Stop and apply the mapped state instead of improvising if:

- the production backend contract, legacy parser behavior, canonical corpus,
  or empty HMR ledger changed after `ef595f9` without reconciliation;
- a known-fresh or shipped project-service HMR row fails infrastructure,
  freshness, selectivity, or cleanup;
- a fair arm requires a public option/source change or modification of the
  shipped legacy backend;
- the direct comparison would require copying/inlining upstream parser code;
- evidence is written inside the repository, sample indices overlap, a child
  exits nonzero, schema/fixture/environment identity drifts, or fewer than seven
  valid independent pairs exist;
- decision-row MAD remains above 20% after the prescribed variance run;
- exact Vite warm-cache behavior cannot be measured without bypassing or
  weakening the plugin cache; or
- completing the comparison requires TypeScript 7, tsserver internals in the
  direct arm, or an object added to the neutral backend contract.

## Maintenance notes

- If `PROMOTE_PROJECT_SERVICE` wins, the follow-up should decide whether to
  replace the experimental flag, make the mode default, or retain an explicit
  rollback selector. It must test the TypeScript 4.3–6 and Vite 3–8 support
  ranges before changing the default.
- If `BUILD_DIRECT_BACKEND` wins, do not move the existing control verbatim.
  The follow-up needs a per-tsconfig LanguageService manager, shared registry,
  full `ParserOptions`/callback parity, stable ordering, compatibility CI,
  cache-fingerprint migration, legacy fallback, and package-size review.
- `DocumentRegistry` remains an implementation detail. Its usefulness must be
  demonstrated by registry-on/off evidence; never expose it in plugin options
  or the neutral backend contract.
- The TypeScript 7 batching retry remains separate. A TypeScript 6 result does
  not widen the peer range or alter the native verdict.
- Reviewers should scrutinize warm-cache measurement, arm order, callback
  classification, referenced-project compiler options, and whether any
  production behavior was changed to favor an arm.
