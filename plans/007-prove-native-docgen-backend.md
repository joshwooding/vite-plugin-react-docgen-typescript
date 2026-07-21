# Plan 007: Prove or reject a native TypeScript 7 docgen backend against a TypeScript 6 control

> **Executor instructions**: This is a non-shipping feasibility spike. Follow
> every step and gate in order. Do not turn a promising partial result into a
> public option, release, or dependency. Record exactly one ordered `GO`,
> `CONDITIONAL`, or `NO-GO` verdict only after the evidence is valid and
> complete. If oracle drift, infrastructure, or unusable timing prevents a
> native conclusion, record `BLOCKED` with the exact retry condition and no
> verdict. Preserve every failure instead of inventing a compatibility shim.
> When done, update the status row in `plans/README.md` unless a dispatching
> reviewer explicitly owns the index.
>
> **Drift check (run first)**:
> `git diff --stat ffd553b..HEAD -- package.json yarn.lock packages/vite-plugin-react-docgen-typescript/package.json packages/vite-plugin-react-docgen-typescript/build.config.ts packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/backendParityCorpus.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts experiments/native-docgen docs/native-backend-spike.md`
> Plans 002–006 intentionally change shared paths first. Confirm Plan 006 is
> `DONE`, record its merge SHA, and reconcile the live neutral contract and
> read-only parity/HMR corpora. If the roadmap chose to execute Plan 008 first,
> also record its merge SHA; its causally tested legacy implementation changes,
> optional comparison-key extension, narrowly proven dependency-only parity-
> corpus migration, and now-empty legacy expectation arrays are expected. The
> experiment directory and decision record are expected not
> to exist. Any other public-surface or oracle drift is a pre-verdict `BLOCKED`
> condition, not evidence against the native backend.

## Status

- **Priority**: P2
- **Effort**: XL
- **Risk**: HIGH
- **Depends on**: `plans/006-introduce-docgen-backend-seam.md`
- **Category**: direction
- **Planned at**: commit `ffd553b`, revised 2026-07-20

## Why this matters

TypeScript 7's native compiler may materially improve startup, large-project
analysis, references, and edit freshness. It is not a drop-in replacement for
the legacy compiler objects consumed by `react-docgen-typescript`: the useful
experiment is a direct native implementation of Plan 006's high-level backend
and local DTO, not a `Program`/`Checker` compatibility facade or an inlined copy
of the upstream parser.

TypeScript 7 has shipped since the first audit. The spike therefore targets the
exact stable distribution's declared unstable subpaths, not the superseded
`@typescript/native-preview` package. A second exact-pinned 7.1-next build is a
forward-churn probe. The outcome is still evidence only because the official
7.0 announcement says the release has no stable programmatic API.

Storybook's closed
[#33909](https://github.com/storybookjs/storybook/pull/33909), merged successor
[#33914](https://github.com/storybookjs/storybook/pull/33914), and open
[#35468](https://github.com/storybookjs/storybook/pull/35468) demonstrate two
separate hypotheses that this spike must not conflate: a React-aware direct
extractor with a persistent legacy LanguageService can improve correctness and
warm updates without a native compiler, while compatible per-tsconfig services
may reduce duplicated parsed state through a shared `DocumentRegistry`. A
private TypeScript 6 direct-extractor control therefore separates those effects
from the TypeScript 7 compiler/API effect. None of those PRs proves this
plugin's in-memory Vite source, dependency, HMR, packaging, or native-API gates.

## Current state and external constraints

- [`typescript@7.0.2`](https://www.npmjs.com/package/typescript) is the stable
  native release used by this plan. Its installed export map declares
  `/unstable/sync`, `/unstable/async`, `/unstable/fs`, `/unstable/ast`, AST
  helpers, and `/unstable/proto`; there is no bare `/unstable` export.
- The official
  [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-60)
  says 7.0 ships no stable programmatic API, recommends
  `@typescript/typescript6` for tools needing the legacy API, and moves future
  nightlies to `typescript@next`.
- This revision pins the forward probe to
  `typescript@7.1.0-dev.20260719.1`. It is deliberately a frozen snapshot, not
  “latest”. Updating it requires a reviewed plan refresh and new evidence.
- The native API uses an API/session, snapshots, projects, programs/checkers,
  and IPC. `unstable/proto` is a declared export, but it is a low-level wire
  surface and is forbidden here; `.internal` and generated wire formats are
  unsupported/private and also forbidden.
- `react-docgen-typescript@2.2.2` expects the legacy object graph. It remains
  intact in the production legacy backend and is only a parity oracle.
- [TypeScript 6's `stableTypeOrdering`](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/#the---stabletypeordering-flag)
  exists to expose 6/7 ordering differences. Ordering is separately measured;
  it is not silently normalized out of the public-output comparison.
- Plan 002 keeps production support at `>=4.3 <7`, aliases the normal toolchain
  to TypeScript 6, and provides exact `typescript7: npm:typescript@7.0.2` as a
  test-only root dependency. This spike does not widen the peer range.
- Plan 006 provides a lazy high-level factory/session, source revisions,
  explicit ready/superseded/disposed outcomes, a shared path boundary, complete
  dependency semantics, a read-only parity corpus, and a real-Vite HMR runner.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Exact dependencies | `yarn install` then `yarn install --immutable` | Root aliases resolve exactly to stable 7.0.2 and next 7.1.0-dev.20260719.1; published workspace manifest is unchanged |
| Experiment typecheck | `yarn exec tsc6 -p experiments/native-docgen/tsconfig.json --noEmit` | Exit 0 under the Plan 002 TypeScript 6 tooling |
| Host HMR preflight | `yarn vitest --config experiments/native-docgen/vitest.config.ts run -t "host preflight" --testTimeout=60000` | A known-fresh fake backend passes the unchanged real-Vite runner before any native HMR result is classified |
| Capability/lifecycle | `yarn vitest --config experiments/native-docgen/vitest.config.ts run -t "capability|overlay|snapshot|reference|revision" --testTimeout=60000` | Stable and next capability probes plus versioned lifecycle gates pass or produce controlled native-specific evidence |
| Extractor controls/parity | `yarn vitest --config experiments/native-docgen/vitest.config.ts run test/extractorControl.native-spike.ts test/nativeParity.native-spike.ts --testTimeout=60000` | TypeScript 6 direct-control, stable native must-have, public-contract, and quality-ledger results are field-level classified; required next slice passes |
| Native HMR | `yarn vitest --config experiments/native-docgen/vitest.config.ts run test/nativeHmr.contract.native-spike.ts --testTimeout=60000` | Native actual failures equal an explicit empty array after both host preflight lifecycles; legacy oracle files are untouched |
| Legacy oracle | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | Canonical legacy corpus and all eight legacy ledgers are byte-for-byte unchanged |
| Benchmark capture | `node experiments/native-docgen/bench/runNativeBenchmarks.mjs --run-id primary --start-index 1 --samples 7 --output <absolute-temporary-run-directory>` | Seven fresh Vitest processes emit a run manifest plus unique Vitest and `native-bench-v1` result files outside the repository |
| Benchmark decision | `node experiments/native-docgen/bench/compareNativeBenchmarks.mjs --input <absolute-temporary-run-directory> --max-regression 15 --min-improvement 20 --min-duration-ms 5` | Exit 0 means every requested GO threshold passes; exit 2 means valid classified threshold evidence; exit 1 means invalid evidence |
| Full tests/build | `yarn typecheck`, `yarn test --run`, `yarn build` | All production tests and the public build pass |
| Public-surface diff | `git diff -- packages/vite-plugin-react-docgen-typescript/package.json packages/vite-plugin-react-docgen-typescript/build.config.ts packages/vite-plugin-react-docgen-typescript/src/index.ts` | Empty |
| Forbidden API scan | `rg -n 'unstable/(sync|proto)|\.internal\b|generated[-_ ]?(proto|wire)|@typescript/native-preview|(?:from|import\(|require\()[[:space:]]*["''](?:react-docgen-typescript|typescript)["'']' experiments/native-docgen` | No output and expected `rg` exit 1; repository-relative imports whose path contains the plugin directory name remain allowed |
| Pin scan | `rg -n '"typescript7": "npm:typescript@7\.0\.2"|"typescript7next": "npm:typescript@7\.1\.0-dev\.20260719\.1"' package.json` | Exactly two matches for `GO`/`CONDITIONAL`; final `NO-GO` retains only Plan 002's stable fixture |
| Whitespace | `git diff --check` | Exit 0 |

Timing is a same-machine decision gate, not ordinary CI wall-clock policy.
Freshness, race handling, dependency completeness, selectivity, and teardown
remain deterministic test gates.

## Suggested executor toolkit

- Read the official TypeScript announcement and inspect the exact installed
  aliases' `package.json`/declarations before writing imports. Main-branch
  source is context, never proof that the pinned artifact has a capability.
- Reuse Plan 006's contract, path helper, benchmark comparator, parity corpus,
  and Plan 005 HMR runner. Do not copy their expectations into the experiment.
- Keep every prototype source under the non-workspace, private
  `experiments/native-docgen` directory so package build reachability is
  structurally absent as well as tested.

## Scope

**In scope** (the only files you should modify):

- `package.json` — add only the exact `typescript7next` root-dev alias if Plan
  002's stable alias is already exact
- `yarn.lock`
- `experiments/native-docgen/package.json` — create with `private: true`; do not
  add it to root workspaces
- `experiments/native-docgen/tsconfig.json` — create
- `experiments/native-docgen/vitest.config.ts` — create; set `root` to this
  experiment directory, include only `test/**/*.native-spike.ts`, and keep
  `passWithNoTests: false`
- `experiments/native-docgen/vitest.bench.config.ts` — create; set `root` to
  this experiment directory, include only `bench/**/*.native-bench.ts`, and
  keep `passWithNoTests: false`
- `experiments/native-docgen/src/nativeCapabilities.ts` — create
- `experiments/native-docgen/src/legacyLanguageServiceBackend.ts` — create as
  a private TypeScript 6 direct-extractor control; it may use a manager-scoped
  `DocumentRegistry` but may not import `react-docgen-typescript`
- `experiments/native-docgen/src/nativeBackend.ts` — create
- `experiments/native-docgen/src/nativeExtractor.ts` — create
- `experiments/native-docgen/test/extractorControl.native-spike.ts` — create
- `experiments/native-docgen/test/qualityCorpus.native-spike.ts` — create
- `experiments/native-docgen/test/nativeBackend.native-spike.ts` — create
- `experiments/native-docgen/test/nativeParity.native-spike.ts` — create
- `experiments/native-docgen/test/nativeHmr.contract.native-spike.ts` — create
- `experiments/native-docgen/bench/nativeBackend.native-bench.ts` — create
- `experiments/native-docgen/bench/runNativeBenchmarks.mjs` — create
- `experiments/native-docgen/bench/compareNativeBenchmarks.mjs` — create
- `docs/native-backend-spike.md` — create

**Read-only boundaries**:

- the entire publishable package manifest/build config/public entry;
- Plan 006's backend contract, path helper, legacy backend, and parity corpus;
- Plan 005's runner, fixed legacy matrix, and legacy expectations; and
- all existing snapshots and changesets.

**Out of scope**:

- `@typescript/native-preview`; adding any native dependency/subpath to the
  publishable package; or adding a public option, environment selector,
  auto-detection, peer change, or native default.
- Removing, inlining, patching, or weakening the legacy backend/upstream parser.
- Bare `typescript7`, bare `/unstable`, low-level `unstable/proto`, `.internal`,
  generated wire formats, unpublished source, or a legacy object facade.
- Passing native handles to legacy callbacks under false TypeScript types.
- Shipping the TypeScript 6 control, exposing `LanguageService` or
  `DocumentRegistry` in Plan 006's neutral contract, or treating a
  Storybook-specific story-file extraction path as portable to component-only
  Vite transforms.
- Claiming full Vite-version, OS/architecture, create/delete, or product HMR
  support from this spike; a production plan owns those matrices.
- Naming experiment files with ordinary `.test.*`/`.spec.*` suffixes or relying
  on the root test discovery. Retained spike tests run only through the isolated
  config and remain an explicit verification obligation.
- A changeset, README support claim, issue closure, release, publish, or PR that
  exposes the backend.

## Git workflow

- Branch: `codex/007-prove-native-docgen-backend`
- Start only after Plan 006 is complete and rebased.
- Keep reviewable commits for preflight, lifecycle/extractor, parity/HMR,
  benchmark/package evidence, and verdict. None may publish the experiment.
- Do not push, publish, open a release PR, or expose the backend unless the
  operator separately instructs it.

## Steps

### Step 1: Pin and capability-check stable plus forward unstable surfaces

Confirm Plan 002 provides exactly:

```json
"typescript7": "npm:typescript@7.0.2"
```

Add exactly:

```json
"typescript7next": "npm:typescript@7.1.0-dev.20260719.1"
```

Run `yarn install` and immutable install. Read both installed export maps. The
stable implementation imports only `typescript7/unstable/async`,
`typescript7/unstable/fs`, `typescript7/unstable/ast`, and necessary declared
AST helper subpaths. The forward probe imports the corresponding
`typescript7next/...` paths. Use the async API for session, snapshot, update,
program/checker, and bulk-query lifecycle; use AST helpers only for local
traversal. Do not import `unstable/sync` into the prototype backend, mix sync
and async clients, duplicate the extractor, or hardcode package-specific code.
Record every actual subpath in the capability inventory.

In `nativeCapabilities.ts`, validate the real installed modules before helper
startup. For each alias, prove API/session creation and close, tsconfig parsing,
snapshot creation, root/reference project discovery, program/checker/source/
symbol/type/declaration/doc/tag/type-string operations, and any bulk calls the
slice requires. Return one sanitized incompatibility result containing alias,
exact version, subpath, and first missing capability.

**Verify**:
`yarn vitest --config experiments/native-docgen/vitest.config.ts run -t "capability" --testTimeout=60000`
→ both real aliases pass, or evidence records the exact first missing surface.
A stable core gap is `NO-GO`; a next-only gap is `CONDITIONAL`. Neither permits
the low-level protocol or internal surface.

### Step 2: Prove source-aware, race-safe project lifecycle before extraction

Implement the minimum Plan 006 session in `nativeBackend.ts`:

- one API client per backend; a fingerprint with exact compiler version and
  local extractor schema;
- immutable current snapshot/project mappings and complete project state;
- a layered `APIOptions.fs` implementation whose `readFile`, `fileExists`, and
  `getAccessibleEntries` consult one immutable per-transition overlay view
  before delegating to the real filesystem, without writing user files. Virtual
  creates must appear in existence/directory enumeration; deletion tombstones
  return `null` from `readFile`, `false` from `fileExists`, and disappear from
  accessible entries;
- versioned change/create/delete inputs captured as immutable source/tombstone
  records when requested. Acquire the transition queue before atomically
  applying a coalesced batch to a new overlay view, then call the declared async
  `updateSnapshot` file-change path so the replacement snapshot reads only that
  view; never mutate an overlay visible to in-flight work. Dispose the old
  snapshot only after replacement readiness;
- explicit ready/superseded/disposed outcomes for overlapping work;
- lazy reset and idempotent teardown.

Queue/coalesce update requests by revision. Concurrent callers may overlap at
the host boundary, but only one async snapshot transition commits at a time;
an older completion becomes `superseded`, its affected-component set is carried
into the newest pending generation, and it never publishes state. This is the
chosen concurrency model—do not claim race safety from sequential synchronous
calls.

Run these hard lifecycle cases against stable 7.0.2 and the required core subset
against the exact next build:

1. component source passed to `analyze` differs from disk and is observed while
   disk stays unchanged;
2. a virtual source create is visible through read/existence/directory APIs and
   the next snapshot, then a tombstone delete removes it, all without disk I/O;
3. root `files: []` references a sibling composite project and two imported
   props edits appear in successive snapshots;
4. two rapid overlapping dependency updates resolve in order-safe fashion—the
   older completion is superseded and cannot overwrite/invalidate the newer;
5. ambient `.d.ts`, path-alias, package declaration, and symlinked workspace
   sources are found with stable boundary identities;
6. one dependency has multiple dependents plus an unrelated component; and
7. disposal during creation and a pending update produces disposed outcomes and
   no helper/open handle.

Plan 004 selection remains host eligibility. The backend returns config,
docgen, and tracked files without exposing native concepts to the host.

**Verify**:
`yarn vitest --config experiments/native-docgen/vitest.config.ts run -t "overlay|snapshot|reference|revision|ambient|alias|symlink|dispose" --testTimeout=60000`
→ overlay/change/create/delete, two edits, races, identity cases, and teardown
pass. This is backend lifecycle evidence only and does not claim product-level
create/delete HMR. If stable cannot represent in-memory source through declared
high-level APIs, record `NO-GO`.

### Step 3: Establish a TypeScript 6 direct-extractor control, then implement the native slice

Create `legacyLanguageServiceBackend.ts` as a private, non-shipping control. It
implements the same Plan 006 session/DTO directly with the normal TypeScript 6
LanguageService and must not call or copy `react-docgen-typescript`. Reuse one
persistent manager/session across root and referenced projects. If the design
requires one LanguageService per tsconfig, benchmark and test a manager-scoped
`DocumentRegistry` both enabled and disabled, assert shared compatible source
identity when enabled, and dispose every service. Do not put the registry or
LanguageService into the neutral contract.

The control implements only the must-have extraction slice below plus the
quality corpus. Its purpose is attribution, not a new production backend:

1. current adapter → TypeScript 6 direct control measures direct extraction and
   persistent-session effects; and
2. TypeScript 6 direct control → TypeScript 7 native measures compiler/API
   effects.

Create `extractorControl.native-spike.ts` before native implementation and
record field-level results for both the current adapter and TypeScript 6
control. The control must observe the same in-memory source, reference,
dependency, revision, and disposal cases used by native so a weak baseline does
not make native appear successful.

Create `nativeExtractor.ts`. Traverse the native AST and checker directly,
produce Plan 006's local DTO/strict runtime targets, and never imitate the
legacy object surface.

The must-have slice includes:

- named/default functions and arrows, generic React wrappers, and `forwardRef`;
- interface/type-alias props, direct/re-exported/transitive imports across a
  project reference;
- required/optional/default props, literal unions, enums, methods, multiple
  components, descriptions/tags, provenance, and Plan 003 targets; and
- static/function `propFilter` using explicitly local values. A legacy
  `componentNameResolver` requiring compiler symbols is a blocker, not a cast.

Match every neutral field: names, paths, descriptions, requiredness, type
name/raw/value, defaults, parent/declaration provenance, tags, methods, order,
and target. Missing values are field-level diffs, never plausible defaults.

Dependencies must exactly follow Plan 006: component plus every reachable
tracked non-default-library source that influences extraction. Retain relevant
React/`@types`, package declarations, and linked workspace sources; exclude
only default libraries and unreachable/unrelated files. Sort/deduplicate with
the shared boundary helper. Batch checker operations where supported and count
adapter/API requests by component/prop.

Unsupported public options fail with a stable experimental diagnostic. Never
silently ignore them or pass native handles as legacy callback arguments.

Maintain two immutable comparison ledgers:

- **public-contract parity**: exact DTO shape, supported options, targets,
  dependency paths, project state, and raw ordering; and
- **intentional quality delta**: false-positive one-parameter functions,
  polymorphic/default-generic and `forwardRef` casts, HOCs/factories,
  `Object.assign` compound components, namespace/member imports,
  discriminated unions, and inherited DOM-prop filtering.

Pin compact source patterns derived from Flowbite, Reshaped, Park UI, Primer,
and Mantine with repository/license provenance. Do not require legacy defects
in the public-contract corpus and do not silently reclassify an existing
supported output as an improvement. Where a polymorphic case needs JSX
instantiation, compare the direct component-type path with a stable-content
batched virtual-probe path. Count added/invalidated snapshots, distinct source
representations, checker/API requests, and warm-update cost; probes are not the
default architecture unless this evidence beats the direct path without
weakening lifecycle or dependency gates.

**Verify**:
`yarn vitest --config experiments/native-docgen/vitest.config.ts run test/extractorControl.native-spike.ts test/qualityCorpus.native-spike.ts -t "extractor|dependency|option|target|quality|registry|probe" --testTimeout=60000`
→ the TypeScript 6 control and native slice complete the contract/quality
ledgers, external dependency paths, selectivity, diagnostics, source-sharing,
probe-churn, and request instrumentation with no forbidden import.

### Step 4: Run read-only parity and empty-ledger native HMR

`nativeParity.native-spike.ts` imports the immutable Plan 006 public-contract
corpus and compares the TypeScript 6 control and stable backend's DTO, targets,
dependency arrays, and project state. It may not
edit `backendParity.test.ts` or the corpus. Run the full must-have slice on the
exact next build as a forward probe.

Keep two ordering observations:

1. exact current legacy public order, which a production backend must preserve
   or deliberately migrate; and
2. a TypeScript 6 `stableTypeOrdering` characterization to distinguish an
   ordering-only 6/7 difference from missing semantic data.

Never sort a parity diff away. An order-only difference is `CONDITIONAL`, not a
false hard capability failure; silent/missing metadata remains a hard failure.
Classify every wider public-contract row as `exact`, `missing high-level API`,
`extractor work`, `ordering/output migration`, or `legacy callback blocker`,
with a field-level diff and bounded follow-up. Separately classify every
quality row as `legacy defect retained`, `intentional improvement`, `regression`,
or `unsupported/context-dependent`; quality improvements never excuse a public-
contract regression.

Before testing native HMR, register a deterministic known-fresh fake backend
through the unchanged Plan 005 runner and its two real-Vite topologies. The fake
must return complete dependencies plus distinct metadata for both revisions.
Run every topology twice: once with immediate `ready` results and once with a
native-shaped async `pending.ready` lifecycle. Without changing the shared
runner, add an experiment-local real-host fake-backend test that drives rapid
disjoint pending updates (older completion becomes `superseded`, newest carries
the affected union) and disposal during pending work (`disposed`, no host side
effect). Both runner lifecycles and the overlap/disposal host test must pass
explicit empty expectations and exact-once host effects. If any host preflight
fails, record Plan 007 as
`BLOCKED — host HMR preflight`, execute Plan 008's host-isolation path and only
the branch it proves, then rerun both lifecycles. Do not count a shared
host/runner defect as a native `NO-GO`.

After that preflight passes, create a separate
`nativeHmr.contract.native-spike.ts` that uses the same runner for its two fixed
same-project/referenced-project topologies. It does not edit or import legacy
expectations and compares native failures to an explicit empty array. Run those
two topologies on stable and exact next. Only failures unique to the native
backend enter the native verdict. Add experiment-local real-Vite tests (without
changing the shared runner) for rapid overlap, ambient declarations, path
aliases, symlinked packages, and multiple dependents.
Require per-edit dependent/unrelated invalidation and delivery counts, fresh
union/JSDoc, hard recovery/error controls, and clean teardown.

**Verify**:

1. `yarn vitest --config experiments/native-docgen/vitest.config.ts run -t "host preflight" --testTimeout=60000`
2. `yarn vitest --config experiments/native-docgen/vitest.config.ts run test/nativeParity.native-spike.ts --testTimeout=60000`
3. `yarn vitest --config experiments/native-docgen/vitest.config.ts run test/nativeHmr.contract.native-spike.ts --testTimeout=60000`
4. the unchanged legacy parity/HMR command from the command table

The native arrays are empty, wider gaps are explicit, and legacy files have no
diff. This proves the spike scenarios only, not product-wide HMR support.

### Step 5: Compare performance with paired independent processes

Create `nativeBackend.native-bench.ts` for `playground`, `large-project`,
`large-design-system`, a multi-tsconfig monorepo with a heavily shared
dependency graph, and a multi-dependent imported-edit fixture. Compare the Plan
006 legacy default backend, TypeScript 6 direct control, and stable native
prototype. If the control owns multiple LanguageServices, capture registry-on
and registry-off variants. Record exact backend/API versions,
Node/OS/architecture, fixture hash, initialization, first component, cold/warm
batch, imported-edit-to-fresh time, teardown, invalidation counts, supported API
request counts, distinct source representations, JS heap, main/helper-process
RSS, and process-tree RSS. Process-tree memory is authoritative when native work
moves memory outside the JavaScript heap.

Create `runNativeBenchmarks.mjs` as the only benchmark orchestrator. Run it as:

```text
node experiments/native-docgen/bench/runNativeBenchmarks.mjs --run-id primary --start-index 1 --samples 7 --output <absolute-temporary-evidence-root>/primary
```

It validates that the output directory is outside the repository, then launches
seven fresh Vitest child processes through the root's exact installed Vitest
CLI with
`experiments/native-docgen/vitest.bench.config.ts`, with the child working
directory explicitly set to `experiments/native-docgen`. Each process executes
one fresh paired sample, alternates which backend runs first by global sample
index, receives `VPRDTS_NATIVE_BENCH_OUTPUT`, `VPRDTS_NATIVE_BENCH_SAMPLE`, and
`VPRDTS_NATIVE_BENCH_ORDER`, and gets Vitest 4's benchmark-mode
`--outputJson <path>` plus the run ID. The direct CLI invocation is intentional:
this private experiment is excluded from the Yarn workspace, so a Yarn command
from its working directory is rejected, and benchmark mode does not support the
test-mode JSON reporter/output-file combination. It writes a run manifest containing the
ID, start/count, exact child command/config/root, and result paths. It rejects
an overlapping global index, missing/duplicate sample, nonzero child,
repository-local output, or malformed result before comparison.

The recorded child command is exactly:

```text
<node> <repository>/node_modules/vitest/vitest.mjs --config vitest.bench.config.ts bench --run --outputJson <unique-vitest-json>
```

Define and validate a versioned `native-bench-v1` custom-result schema with:
run ID, global sample number/order; scenario/backend; exact compiler/API
versions; Node/OS/architecture; fixture hash; repetition count; total measured
duration and per-operation duration for every metric; freshness/selectivity/
teardown controls; invalidation counts; and API request counts. Adaptively
repeat each operation batch except teardown until its measured work is at least
250 ms, then report the per-operation value; setup outside the named metric is
not included. Teardown is one measurement from one independently created and
initialized session per paired process. Repeating a sub-millisecond dispose to
a 250 ms floor would launch thousands of complete helpers and measure
accumulated process retirement rather than the lifecycle operation under test;
the comparator instead requires this diagnostic metric to be finite, positive,
and present in every pair.
Every cold-initialization and first-component repetition must create a fresh
backend/session, perform only the named operation, and dispose it. Warm batches
may reuse a session inside one repetition, but never across samples/repetitions;
imported-edit repetitions create a fresh initialized session, apply the fixed
two-edit sequence, verify freshness/selectivity, and dispose it.

Run the comparator exactly as:

```text
node experiments/native-docgen/bench/compareNativeBenchmarks.mjs --input <absolute-temporary-evidence-root>/primary --max-regression 15 --min-improvement 20 --min-duration-ms 5
```

`compareNativeBenchmarks.mjs` validates all run manifests, Vitest/custom files,
and cross-file sample metadata, verifies complete pairs, reports median and
median absolute deviation, and requires fresh selective results. Exit `0` means
all requested regression and improvement thresholds pass; exit `2` means the
schema and correctness controls are valid but one or more performance
thresholds fail; exit `1` means invalid/incomplete evidence or infrastructure.
No result may be written into the repository. Exit `2` is preserved as
`CONDITIONAL`/`NO-GO` performance evidence rather than mislabeled as
infrastructure failure. `--max-regression 15` applies to every named metric on
both large fixtures; `--min-improvement 20` succeeds only when the same eligible
metric—cold batch or imported-edit time—improves by at least 20% on both against
the current adapter. It also reports, without folding it into that threshold,
the current-adapter → TypeScript 6 control and TypeScript 6 control → native
deltas for every metric so a native verdict cannot attribute LanguageService or
extractor gains to the compiler.
`--min-duration-ms` validates each non-teardown aggregate measured batch before
per-operation normalization. Teardown is excluded from that duration floor for
the process-lifecycle reason above, but remains in the regression ledger.

If any median absolute deviation exceeds 20% of its median, collect seven more
alternating pairs in `<evidence-root>/variance` with `--run-id variance
--start-index 8`, then compare `--input <...>/primary --input
<...>/variance` with the same three thresholds. Before a possible `GO`, collect
a separate seven-pair confirmation in `<evidence-root>/confirmation` with
`--run-id confirmation --start-index 15` and compare that run independently
with the same thresholds. Run IDs/directories and global index ranges may not
overlap. The primary and confirmation classifications must agree. Do not rely
on Vitest's table or a single-process microbenchmark alone.

**Verify**:
the driver succeeds; the comparator returns only the state allowed by the
verdict mapping (`0` for `GO`, `2` for valid non-GO threshold evidence, never
`1`); every
scenario has at least seven independent pairs (fourteen for a confirmation or
high-variance run), at least 250 ms of measured work per non-teardown operation
batch, one positive teardown observation per pair, zero unrelated invalidations,
fresh metadata, clean teardown, and
machine-readable JSON retained outside the repository.

### Step 6: Prove the experiment cannot enter the published artifact

Build the real package, then pack it to an OS temporary path with
`yarn workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out <temporary-plugin.tgz>`.
List every archive entry and extract it only under a new task-specific temporary
directory. Assert:

- no experiment path, `typescript7`, native API string, helper binary, or native
  platform package occurs in archive names or text contents;
- all generated `.mjs`, declaration, map, and secondary chunk files—not only
  the entry—contain no native prototype/import;
- the packed manifest has no native dependency/export; and
- the publishable manifest, build config, and public entry have an empty diff.

Run the full production build/tests after this check. Accidental reachability is
a hard scope failure even if tree-shaking happens to remove one string.

### Step 7: Record one ordered, mutually exclusive verdict

Create `docs/native-backend-spike.md` with exact aliases/subpaths, capability
inventory, lifecycle/race/source/reference/dependency/HMR/teardown evidence,
ordering observations, full parity table, raw sample locations, medians/
dispersion/request counts, and package archive inventory. Add one verdict only
after every pre-verdict control is valid; otherwise record the `BLOCKED` state
and retry condition without a verdict.

Evaluate in this exact order:

0. **BLOCKED — no verdict yet** if the read-only oracle/contract drifted, the
   known-fresh host preflight fails, install/CI infrastructure cannot run the
   exact artifacts, benchmark files fail schema validation, timing remains
   unusable after the prescribed retry, or another infrastructure/control
   failure prevents valid native-specific evidence. Record the failed control,
   preserve evidence, name the exact retry condition, leave Plan 007 not done,
   and do not call the backend `NO-GO`. A host-preflight block routes to Plan
   008's proven host branch before retrying.
1. **NO-GO — native route rejected** if stable 7.0.2 specifically fails source overlay,
   references, complete dependencies, must-have semantic metadata, versioned
   two-edit HMR/selectivity, or teardown; requires the low-level protocol,
   internal/generated wire surface, or a legacy object facade; or has a
   confirmed greater-than-50% regression on either large fixture with no
   supported batching/architectural route. A failure of stable is never rescued
   by next.
2. **CONDITIONAL — research is viable, legacy remains default** if all stable
   hard correctness gates pass but the exact next probe fails/churns; any wider
   corpus row is not exact; ordering would change public output; a supported
   option/callback lacks a truthful neutral contract; any confirmed regression
   is greater than 15% (including every 16–50% result); a greater-than-50%
   regression has a specific supported mitigation to test; or performance is
   within 15% but misses the `GO` improvement threshold. Name the exact API,
   extractor, migration, batching, or product decision that unlocks a retry.
3. **GO — write a separate production-native plan** only if stable and next
   hard gates pass, every currently supported non-callback public-contract row is
   exact, no callback/product blocker remains, raw public ordering is exact,
   native HMR failures are empty, every large metric regresses at most 15%, and
   either cold batch improves at least 20% on **both** large fixtures or
   imported-edit time improves at least 20% on **both**. The same winning metric
   must meet 20% on both fixtures. Confirmation samples must agree.

Strong performance cannot override an earlier API/parity blocker. `GO` only
authorizes a new production plan, not shipping, default replacement, peer-range
change, or issue closure. Plan 008 remains mandatory while legacy is default,
opt-in, supported, or retained for rollback, for every verdict. It may be
superseded only after a separately approved production plan both makes native
the default and formally repairs or removes legacy support; neither this spike
nor an opt-in native release can waive it.

### Step 8: Run verdict-appropriate verification and cleanup

For `GO`/`CONDITIONAL`, run immutable install, experiment typecheck, all native
capability/lifecycle/parity/HMR tests, unchanged legacy oracles, benchmark
evidence/validation, production typecheck/full tests/build, actual archive
inspection, forbidden/pin/public-surface scans, Biome on every in-scope changed
file, `git diff --check`, and `git status --short`. No-match scans have expected
exit code 1; the benchmark comparator exits `0` for a `GO` threshold pass or
`2` for valid threshold evidence used by `CONDITIONAL`; every other platform-
independent command exits 0. Comparator exit `1` is invalid evidence and routes
to `BLOCKED`.

For `NO-GO`, stop at the first hard failure, record a minimal reproducer and
unreached steps, then remove `typescript7next`, its lock entries, all incomplete
experiment implementation/HMR/benchmark code, and any root changes beyond the
Plan 002 stable fixture. Retain the decision record and only dependency-free,
green capability fixtures that remain useful. Re-run immutable install,
unchanged legacy oracles, production typecheck/tests/build, actual archive
inspection, public-surface/no-native scans, whitespace, and scope checks.

For `BLOCKED`, preserve only the smallest non-publishing reproducer/evidence
needed to retry, run every unaffected production/oracle/package isolation
check, update the index to `BLOCKED — <reason>`, and do not write a verdict or
perform verdict-specific cleanup that would destroy evidence. Resume Step 7
only after the named control passes.

Expected: the public archive is native-free for every verdict. `GO`/
`CONDITIONAL` retains exact reproducible experiment aliases; final `NO-GO`
returns root manifest/lock to the post-Plan-006 baseline apart from its decision
record. No changeset or public claim exists.

## Test plan

- Real installed stable and next capability tests, never mocks.
- Source overlay, project references, ambient/alias/package/symlink identity,
  rapid revisions, multiple dependents, and disposal races.
- Direct native extraction with complete external-aware dependency provenance.
- Read-only field/order parity plus explicitly categorized wider gaps.
- A separate real-design-system quality ledger and a TypeScript 6 direct-
  extractor control, including registry/probe churn where applicable.
- Separate real-Vite native empty-ledger HMR tests; unchanged eight-row legacy
  oracle.
- Isolated `*.native-spike.ts`/`*.native-bench.ts` configs; ordinary root test
  discovery must not run the experiment accidentally, while retained spike
  verification always invokes those configs explicitly.
- Seven paired alternating independent processes, variability/confirmation
  rules, request counts, source-representation counts, and process-tree memory.
- Full dist plus packed-archive publication audit.

## Done criteria

**Required for every completed verdict**:

- [ ] The decision record names the first failing/passing gate and applies one
      ordered verdict without an unsupported production claim.
- [ ] No published manifest, build config, public entry, peer, option, export,
      README support claim, changeset, release state, or issue status changes.
- [ ] Existing legacy parity/HMR/tests/typecheck/build remain green and issue
      #57 remains open.
- [ ] No native object masquerades as a legacy object; low-level protocol,
      internal, and generated-wire surfaces are absent.
- [ ] Actual package archive and every dist chunk/declaration are native-free.
- [ ] `plans/README.md` marks Plan 007 `DONE — GO`, `DONE — CONDITIONAL`, or
      `DONE — NO-GO`, unless the dispatching reviewer owns the index.

**Alternative pre-verdict state for `BLOCKED`**:

- [ ] The decision record contains no `GO`/`CONDITIONAL`/`NO-GO`, names the
      invalid control and exact retry condition, and preserves a minimal
      reproducer without changing a publishable surface.
- [ ] `plans/README.md` says `BLOCKED — <reason>` rather than `DONE`.

**Additionally for `GO`/`CONDITIONAL`**:

- [ ] Stable 7.0.2 and next 7.1.0-dev.20260719.1 remain exact root-dev aliases;
      no publishable dependency changes.
- [ ] Only declared high-level unstable subpaths are used; source overlay,
      references, revision races, exact dependency paths, must-have parity,
      native empty-ledger HMR, selectivity, and clean disposal pass.
- [ ] Wider parity/order/option gaps and independent benchmark dispersion are
      complete enough to apply the ordered verdict without ambiguity.
- [ ] The TypeScript 6 control and quality ledger make extractor/session gains,
      native compiler gains, intentional improvements, and regressions
      separately visible; no Storybook benchmark is used as local proof.

**Alternative completion for `NO-GO`**:

- [ ] The first stable hard failure has a minimal reproducer and unsupported
      low-level workarounds were not attempted.
- [ ] The next alias, incomplete experiment implementation/registration/
      benchmark, and their lock entries are removed; Plan 002's stable fixture
      remains unchanged.
- [ ] Final root manifest/lock diff matches the post-Plan-006 baseline and the
      public archive/native scans are clean.

## STOP conditions

Stop implementation and apply the explicitly mapped state above if:

- Plan 006 or a read-only oracle/contract has drifted (`BLOCKED`).
- The known-fresh fake backend fails the shared real-Vite HMR runner
  (`BLOCKED`, then Plan 008 host isolation).
- An exact alias cannot be installed because of registry/CI infrastructure
  (`BLOCKED`); an installed stable declared high-level subpath missing a needed
  capability is native `NO-GO`, while the same next-only gap is `CONDITIONAL`.
- Stable core work requires `unstable/proto`, `.internal`, generated wire data,
  unpublished source, user-file overwrites, or a legacy object facade.
- Complete dependencies—including relevant external declarations/linked
  packages—must be weakened or broad invalidation is required.
- Missing metadata would need guessed fallback values or native handles would
  leak into public/legacy callbacks.
- Publication isolation requires a publishable manifest/build/public-entry
  change, or archive inspection finds native reachability.
- Timing evidence cannot satisfy the sample/variance rules on an otherwise-idle
  machine after one controlled retry (`BLOCKED`; do not infer performance).
- A deterministic infrastructure/control verification fails twice after one
  focused correction (`BLOCKED`); a reproducible native-specific correctness
  failure follows the ordered verdict rules.

## Maintenance notes

- Exact pinning makes evidence reproducible; it does not stabilize the API.
- Keep the extractor independent of `react-docgen-typescript`; local DTO and
  behavior corpora are the compatibility contract.
- Preserve complete dependency paths and batch checker calls. Native compiler
  speed can disappear behind chatty synchronous IPC.
- Native HMR success here is a feasibility result, not Vite 3–8/product support.
- A production plan after `GO` still needs packaging/optional-dependency design,
  public opt-in semantics, full platform/version CI, cache migration, docs,
  release rollback, and a formal decision to repair or remove legacy. Until
  that decision ships, Plan 008 remains required.
