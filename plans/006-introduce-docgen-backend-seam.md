# Plan 006: Introduce a docgen backend session boundary without changing legacy behavior

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ffd553b..HEAD -- scripts/compare-benchmark-results.mjs scripts/compare-package-artifacts.mjs packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/plugin.ts packages/vite-plugin-react-docgen-typescript/src/docgen/types.ts packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts packages/vite-plugin-react-docgen-typescript/src/docgen/pathIdentity.ts packages/vite-plugin-react-docgen-typescript/src/docgen/runtimeTarget.ts packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts packages/vite-plugin-react-docgen-typescript/src/utils/cache.ts packages/vite-plugin-react-docgen-typescript/src/utils/fileSelection.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescript.ts packages/vite-plugin-react-docgen-typescript/src/utils/typescriptCompatibility.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/backendParityCorpus.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/legacyHmrExpectations.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts`
> Plans 002–005 intentionally change several existing paths first. Confirm all
> four are marked `DONE`, then reconcile this baseline-stamped plan with their
> exact merged SHAs. The expected drift is: Plan 002's compatibility loader and
> focused test, Plan 003's strict target validator/tests, Plan 004's selection
> helper/project boundary/test, and Plan 005's three-file read-only HMR oracle.
> Record those four merge SHAs in the implementation PR. Any other semantic
> change to parsing, generated
> output, caching, selection, or HMR is a STOP condition. The new backend files,
> `plugin.ts`, and focused backend tests are expected not to exist.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: `plans/002-bound-typescript-compatibility.md`, `plans/003-reject-invalid-runtime-targets.md`, `plans/004-unify-project-file-selection.md`, `plans/005-lock-backend-hmr-contract.md`
- **Category**: tech-debt
- **Planned at**: commit `ffd553b`, revised 2026-07-20

## Why this matters

The plugin currently mixes Vite delivery, caches, TypeScript project lifecycle,
dependency discovery, `react-docgen-typescript` extraction, and runtime-target
resolution in one roughly 1,700-line closure. A thin wrapper around
`FileParser.parseWithProgramProvider` would not enable a native TypeScript
backend: the native API cannot supply legacy `Program`, `Symbol`, or
`SourceFile` objects. The useful seam is a higher-level session that owns every
compiler-specific concern and returns a local, serializable docgen model plus
dependency paths to a Vite-facing host.

This plan extracts that seam and wraps all current behavior as the legacy
backend. It intentionally adds no backend selector and changes no output. Its
parity corpus is the safety net for Plan 007's experimental native rewrite and
for Plan 008's later legacy HMR repair.

## Current state

- `packages/vite-plugin-react-docgen-typescript/src/index.ts:72-98` constructs
  the upstream `FileParser` directly.
- `src/index.ts:105-451` resolves tsconfigs/references and creates default,
  watch, or project-service compiler state.
- `src/index.ts:458-615` walks direct and transitive compiler dependencies.
- `src/index.ts:618-676` declares Vite-host state and compiler/parser state in
  the same closure.
- `src/index.ts:818-1030` manages project-service files and projects.
- `src/index.ts:1256-1329` initializes both the Vite transform host and the
  selected TypeScript runtime mode.
- `src/index.ts:1517-1636` calls `parseWithProgramProvider`, resolves targets
  through a legacy checker, computes dependencies, generates code, and updates
  caches in one block.
- `src/index.ts:1647-1710` combines backend freshness with Vite module
  invalidation.
- `src/utils/generate.ts:6` imports upstream `ComponentDoc` and `PropItem`
  types even though generation consumes only serializable metadata plus a
  runtime target.
- `src/utils/runtimeTarget.ts` necessarily consumes legacy TypeScript nodes and
  symbols. That work must run inside the legacy adapter before data crosses the
  new boundary.
- `src/utils/cache.ts:121-164` namespaces persisted transforms by options,
  tsconfig contents, plugin version, `react-docgen-typescript`, and TypeScript,
  but not by backend identity.
- Plan 005 supplies a backend-neutral real-Vite HMR observation ledger. This
  extraction must preserve it exactly, including any known failures.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Dependency baseline | `yarn install --immutable` | Exit 0; no manifest or lockfile changes |
| Existing snapshots | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts` | All existing snapshots pass without updates |
| Backend contract | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts` | Host/backend lifecycle, cache, update readiness, and disposal cases pass |
| Legacy parity | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts` | Default, watch, and project-service canonical metadata/target/dependency goldens pass |
| HMR acceptance | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | The exact Plan 005 legacy matrix and ledger are unchanged; do not edit either file |
| Selection | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts` | All Plan 004 cases pass |
| Full tests | `yarn test --run` | All tests pass without open handles |
| Typecheck | `yarn typecheck` | Exit 0, no errors |
| Build | `yarn build` | Existing single public entry builds successfully |
| Benchmark smoke | `yarn benchmark:ci` | All three scenarios and legacy modes complete once |
| Neutral import scan | `rg -n '(typescript|react-docgen-typescript|(?:from|import\(|require\()[[:space:]]*["'']vite)' packages/vite-plugin-react-docgen-typescript/src/docgen/types.ts packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts packages/vite-plugin-react-docgen-typescript/src/docgen/pathIdentity.ts packages/vite-plugin-react-docgen-typescript/src/docgen/runtimeTarget.ts packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts` | No output and expected `rg` exit 1; catches static, dynamic, and CommonJS imports |
| Public-entry legacy scan | `rg -n 'from "react-docgen-typescript"|import\([[:space:]]*"react-docgen-typescript"\)|from "typescript(?:/[^"]*)?"|import\([[:space:]]*"typescript(?:/[^"]*)?"\)|FileParser|tsserverlibrary|SemanticDiagnosticsBuilderProgram|parseWithProgramProvider' packages/vite-plugin-react-docgen-typescript/src/index.ts packages/vite-plugin-react-docgen-typescript/src/plugin.ts` | No output and expected `rg` exit 1; the unchanged plugin-name literal `vite:react-docgen-typescript` is intentionally not an import match |
| Package surface | `git diff -- packages/vite-plugin-react-docgen-typescript/package.json packages/vite-plugin-react-docgen-typescript/build.config.ts` | Empty |
| Whitespace check | `git diff --check` | Exit 0 |

The current Windows checkout has a known line-ending-only Biome baseline: full
`yarn biome:ci` exits 1 with 16 pre-existing `format` diagnostics. Run Biome on
all changed TypeScript files and require it to exit 0; do not rewrite unrelated
files. Linux CI must keep the repository-wide check green.

## Scope

**In scope** (the only files you should modify):

- `scripts/compare-benchmark-results.mjs` — create
- `scripts/compare-package-artifacts.mjs` — create
- `packages/vite-plugin-react-docgen-typescript/src/index.ts`
- `packages/vite-plugin-react-docgen-typescript/src/plugin.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/docgen/types.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/docgen/pathIdentity.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/docgen/runtimeTarget.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts`
- `packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts`
- `packages/vite-plugin-react-docgen-typescript/src/utils/cache.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/backendParityCorpus.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts` — create

**Out of scope**:

- Adding a TypeScript 7 unstable API dependency, a native implementation,
  another workspace package, or a public/backend-selection option.
- Copying, forking, patching, or inlining `react-docgen-typescript`; it remains
  the legacy backend dependency.
- Fixing any Plan 005 expected HMR failure. Preserve the exact ledger; Plan 008
  owns the corrective change.
- Changing generated code, metadata ordering, public options, package exports,
  peer ranges, dependencies, lockfile, or build entries.
- General cache freshness, pruning, or callback-closure key design. This plan
  may version the cache record once to add the backend fingerprint and a
  project-membership proof required for cache-first parity.
- A changeset. This is an internal refactor with zero intended user-visible
  behavior.
- Editing Plan 002–005 focused tests, existing transform snapshots,
  `support/legacyHmrExpectations.ts`, or `viteHmr.contract.test.ts`. They are
  verification-only boundaries in this plan.

## Git workflow

- Branch: `codex/006-introduce-docgen-backend-seam`
- Start only after Plans 002–005 are complete and rebased into the branch.
- Prefer small commits that keep tests green: neutral types/contract, legacy
  adapter, host extraction, then parity tests. Use title-style subjects such as
  `Add docgen backend contract` and `Wrap the legacy docgen backend`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Author and review the parity corpus before moving code

Before moving compiler lifecycle code, create
`support/backendParityCorpus.ts` plus `backendParity.test.ts` around small
controlled fixtures and author the corpus's expected values by inspection. Run the
current public plugin to lock complete generated metadata/output, warnings,
function `propFilter` and `componentNameResolver` arguments, and exact
dependency lists from the persisted-cache record. Author the expected
configured project state from the fixture's parsed root/reference membership.
The same constant expectations will later be applied to the direct legacy
backend; do not regenerate or snapshot-update them after extraction.

Cover the full corpus listed in Step 6 now, including an extraction that returns
no components and a recoverable parser error with dependencies. Give every
golden a human-readable fixture/field name so review does not rely on an opaque
blob. Also run existing snapshots, the focused Plan 002 compatibility test,
Plan 003 target/generator tests, Plan 004 selection tests, and Plan 005's HMR
contract. Save the exact eight-row Plan 005 expectation map and do not edit it.

Set a task-specific temporary directory such as
`$docgenSeamEvidence = Join-Path ([IO.Path]::GetTempPath()) "vprdts-plan006-$PID"`
and create `baseline-capture`, `paired/baseline`, `paired/candidate`, and
`candidate-artifact` subdirectories. Record `git rev-parse HEAD` as the exact
pre-refactor SHA. After `yarn build`, run one warm-up
and these exact baseline commands:

```powershell
node scripts/benchmark-playground.mjs --scenario large-project --iterations 5 --output "$docgenSeamEvidence/baseline-capture/large-project.json"
node scripts/benchmark-playground.mjs --scenario large-design-system --iterations 5 --output "$docgenSeamEvidence/baseline-capture/large-design-system.json"
Copy-Item packages/vite-plugin-react-docgen-typescript/dist "$docgenSeamEvidence/baseline-capture/dist" -Recurse
yarn workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out "$docgenSeamEvidence/baseline-capture/plugin.tgz"
```

Record a sorted inventory and byte totals for every shipped `.mjs`, `.d.ts`,
and source-map file plus the packed archive—not only `dist/index.mjs`. Use the
equivalent commands and OS temporary directory on non-Windows hosts. These are
review artifacts, not committed files.

**Verify before implementation**:

- The authored corpus passes against the current public plugin and has been
  reviewed before any lifecycle move.
- All dependency-plan focused suites, existing snapshots, and the three-run
  Plan 005 determinism gate pass.
- Both benchmark JSON files contain default, watch, and project-service results
  with five samples, and the sorted dist/archive inventory contains positive
  sizes.

STOP if the baseline suite is nondeterministic, a golden cannot be observed or
independently authored before extraction, or Plan 005 lacks a reviewed
observation for the reported stale-metadata path.

### Step 2: Define a compiler-neutral component, factory, and session contract

Create `src/docgen/types.ts` containing only the fields consumed by generation:

- component: `displayName`, `filePath`, `description`, `props`, `methods`,
  optional `tags`, and `targetExpression`;
- prop: `name`, `required`, `type`, `description`, `defaultValue`, optional
  `parent`, `declarations`, and `tags`; and
- JSON/sanitizable supporting value types broad enough to preserve every
  existing upstream field without carrying compiler objects.

No neutral type may expose or structurally accept a TypeScript `Program`,
`Checker`, `Symbol`, `Node`, `SourceFile`, upstream `FileParser`, or the
upstream-only `expression` property. Define a local sanitized error record with
string `name`, `message`, and optional `stack`; `unknown` and thrown compiler
objects may not cross the seam.

Create `src/docgen/pathIdentity.ts` with the one boundary-path implementation
used by host and every backend. It cleans query/hash suffixes where applicable,
applies `path.resolve`, and sorts/deduplicates arrays. Preserve the exact
post-Plan-004 separator and case behavior; do not add `realpath`, lowercasing,
or a second backend-specific normalizer. Plan 008 may add a distinct comparison
key only if its isolation tests prove identity is causal.

Create `src/docgen/backend.ts` with this semantic shape (names may improve, but
the states and responsibilities may not move):

```ts
interface BackendDescriptor {
  id: string;
  cacheFingerprint: string;
}

interface BackendProjectState {
  generation: number;
  configFiles: readonly string[];
  docgenFiles: readonly string[];
  trackedFiles: readonly string[];
}

interface BackendErrorRecord {
  name: string;
  message: string;
  stack?: string;
}

interface BackendFileSelection {
  include: readonly string[];
  exclude: readonly string[];
  hasIncludes: boolean;
  matchesDocgenFile(fileName: string): boolean;
}

type AnalyzeResult =
  | { status: "ok"; revision: number; components: readonly DocgenComponent[]; dependencies: readonly string[]; project: BackendProjectState }
  | { status: "error"; revision: number; error: BackendErrorRecord; dependencies: readonly string[]; project: BackendProjectState };

type UpdateCompletion =
  | { status: "ready"; revision: number; project: BackendProjectState }
  | { status: "superseded"; revision: number; supersededBy: number }
  | { status: "disposed"; revision: number };

type ResetCompletion =
  | { status: "reset"; revision: number }
  | { status: "superseded"; revision: number; supersededBy: number }
  | { status: "disposed"; revision: number };

type FileUpdateResult =
  | { status: "ignored"; revision: number }
  | { status: "project-reset"; revision: number }
  | { status: "ready"; revision: number; project: BackendProjectState }
  | { status: "pending"; revision: number; ready: Promise<UpdateCompletion> };

type BackendSourceChange =
  | { fileName: string; kind: "change" | "create"; revision: number; source: string }
  | { fileName: string; kind: "delete"; revision: number };

interface DocgenBackend {
  initialize(): Promise<BackendProjectState>;
  analyze(input: { fileName: string; source: string; revision: number }): Promise<AnalyzeResult>;
  update(input: { change: BackendSourceChange; affectedComponentFiles: readonly string[] }): Promise<FileUpdateResult>;
  reset(input: { revision: number }): Promise<ResetCompletion>;
  recordCacheHit(input: { fileName: string; cache: "memory" | "persistent" }): void;
  dispose(): Promise<void>;
}

interface DocgenBackendFactory {
  describe(context: { rootDir: string }): BackendDescriptor;
  create(context: { rootDir: string; selection: BackendFileSelection }): Promise<DocgenBackend>;
}
```

`configFiles` is complete configuration provenance, not merely the root
tsconfig: it includes recursively referenced configs and every resolved
`extends` config whose contents affect options or membership. This list feeds
the host's cache-membership proof.

Backend-specific compiler/parser options are captured in the factory closure;
the factory context never exposes legacy `ParserOptions`/`CompilerOptions`.
Plan 004's `ResolvedFileSelection` structurally satisfies the neutral
`BackendFileSelection`; do not import the Vite-backed helper into `backend.ts`
or reimplement its predicate.
`createPlugin(options, backendFactory)` remains internal. Calling `describe`
and constructing the plugin are side-effect-free apart from reading package-
version metadata: they do not load a compiler/parser, parse a tsconfig, or
start a watcher. `create()` is invoked
lazily on the first uncached eligible transform or relevant update, is
deduplicated, and must clean partial resources before rejecting. This preserves
Plan 004's `include: []` no-load contract.

The descriptor's `cacheFingerprint` incorporates the backend implementation
schema/version and every backend dependency version. Backend-specific primitive
configuration captured outside public `Options` also belongs in it. The host
retains its existing serialization of public host/parser options, including its
known `Function#toString` limitation for callbacks; this refactor must not claim
that two text-identical closures with different captures are distinguishable.
Record that limitation under the deferred cache-key work. A display `id` alone
is never a persistent-cache key.

Semantics to lock in tests:

- every path crossing the contract uses `pathIdentity.ts`; arrays are sorted and
  deduplicated;
- Plan 004 selection is the host's transform filter. The latest
  `BackendProjectState.docgenFiles` is the configured-project membership
  authority, and a cache hit may stand in for it only with a still-valid proof
  emitted from that state. The proof contains the selected component path,
  selection/backend fingerprints, and sorted path/content hashes for every
  root, referenced, and extended config affecting membership. The host validates
  those files without loading a compiler; missing/changed proof is a cache miss.
  Old records are invalidated by a cache-schema bump. `AnalyzeResult` therefore
  has no duplicate `outside-project` verdict;
- dependency arrays are required on success, empty extraction, and recoverable
  errors; `[]` means none, never “unknown”;
- the host assigns monotonically increasing revisions. `analyze` receives the
  exact source at this plugin stage. An existing-file change carries the latest
  source text; deletion omits it. The legacy adapter may ignore source text but
  the contract must support a future snapshot overlay;
- each pending update has a completion for its own revision even if backend work
  is shared. It resolves `ready` only when analysis can see that revision,
  `superseded` when a newer revision wins, or `disposed` on teardown; it never
  rejects. The host keeps a latest-required revision per affected component,
  carries the union of all still-pending affected components into/coincident
  with the newest update, and invalidates that full union when the newest
  snapshot becomes ready. A superseded completion never drops its affected
  components. An analysis result commits only when it matches the request and
  is at least that component's latest-required revision; unrelated components
  do not share a global commit gate. Superseded/disposed completions otherwise
  do nothing;
- `project-reset` makes the host clear host caches/indexes and immediately await
  `reset`; reset leaves the backend uninitialized, so the next eligible cache
  miss initializes lazily. No completion may schedule work after disposal;
- `recordCacheHit` is synchronous, never initializes, and preserves the legacy
  project-service open-file LRU touch when a backend already exists;
- no backend method receives a Vite server, module graph, or `ModuleNode`, and
  `dispose` is idempotent.

Lock this lifecycle table in the contract tests:

| State | Allowed transition | Guard/outcome |
|---|---|---|
| `uncreated` | `creating`, `disposed` | Serve stays lazy; eager build starts creation only when selection is nonempty |
| `creating` | `initializing`, `uncreated`, `disposed` | Factory work is deduplicated; a reset/dispose token prevents late installation; a late-created backend is disposed exactly once |
| `initializing` | `ready(generation)`, `uncreated`, `disposed` | Only the current lifecycle token may publish state; failure cleans partial state |
| `ready(generation)` | `resetting`, newer `ready(generation + 1)`, `disposed` | Every accepted project/snapshot replacement strictly increments generation |
| `resetting` | `uncreated`, `disposed` | Transforms await reset, then follow normal lazy cache/miss ordering; late analyze/update results are ignored |
| `disposed` | `disposed` | Terminal and idempotent; no state, cache notification, or invalidation may be installed |

The host owns the lifecycle token as well as source revisions. Test
reset-during-create, reset-during-analyze, transform-during-reset,
dispose-before-create-resolves, and exactly-once disposal of a backend that
arrives late. Preserve current `configResolved`: serve is lazy and build is
eager only when Plan 004 selection is nonempty.

Add contract-only tests for descriptor stability, path identity, required
dependencies/errors, same-revision readiness, two rapidly overlapping updates
where the first is superseded, reset, disposal during pending creation/update,
and repeated disposal. These tests pass before host wiring; host orchestration
tests are added after the atomic extraction.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts`
→ the neutral contract/path/state-machine tests pass without importing the
production plugin.

### Step 3: Make generation and target validation compiler-neutral

Change `src/utils/generate.ts` to import local component/prop types. Preserve
its existing sanitizer and serialized field order exactly. Do not loosen or
reorder Plan 003's strict runtime-target validation.

Create `src/docgen/runtimeTarget.ts` and move only Plan 003's pure target-
expression grammar and reserved-root validation into it. Both the legacy AST
resolver in `utils/runtimeTarget.ts` and the generator must import this one
compiler-neutral predicate. Keep legacy symbol/declaration resolution in
`utils/runtimeTarget.ts`; do not move TypeScript objects into the neutral file.
This gives Plan 007 a shared syntax/semantic target boundary without copying a
legacy resolver.

In the legacy-specific path, call
`resolveComponentDocRuntimeTargets` while the legacy checker, source file, and
upstream `expression` symbol are still available. Then map every upstream doc
to a fresh local DTO and explicitly omit `expression`. Do not cross the seam
with a cast of the whole upstream object: that would let compiler handles leak
into caches and would make a native implementation imitate the wrong model.

Add focused mapping assertions for full rich metadata, methods, tags, parent
and declaration provenance, default values, union/enum values, multiple
components, and exact target expressions.

**Verify**:

- `rg -n 'react-docgen-typescript|typescript' packages/vite-plugin-react-docgen-typescript/src/docgen/types.ts packages/vite-plugin-react-docgen-typescript/src/docgen/runtimeTarget.ts packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts` → no output and expected `rg` exit 1.
- Existing `index.test.ts` snapshots pass without `-u` or any snapshot diff.

### Step 4: Atomically extract the legacy session and wire the Vite host

Implement this as one atomic move-and-wire change; do not commit a state where
compiler lifecycle was removed from `index.ts` but the public plugin is broken.
Create `src/docgen/legacyBackend.ts` and move—not duplicate—the following
responsibilities from the current closure:

- the Plan 002 capability-validated compiler load and upstream parser
  construction;
- tsconfig/root/reference resolution and Plan 004's project/docgen boundary;
- default builder, watch program, and project-service lifecycle plus precedence;
- active program lookup and runtime-target resolution;
- direct/transitive dependency discovery and its per-program caches;
- tracked/config/docgen project-state refresh; and
- compiler freshness, targeted project-service refresh, reset, and teardown.

The dependency contract is the current legacy closure: include the component
entry and every directly/transitively resolved source that belongs to the
active tracked-file set, where tracked files contain all non-default-library
program sources. This intentionally includes relevant `node_modules/@types`,
React declarations, and linked/workspace packages; exclude only TypeScript's
default libraries or genuinely unresolved/unreachable sources. Preserve this
exact sorted array on empty extraction and recoverable errors. Plan 007 must
match it rather than filtering external packages.

The adapter continues to accept every existing `ParserOptions` field through
its factory closure, including function `propFilter` and
`componentNameResolver`, with identical legacy arguments. Keep
`react-docgen-typescript` intact as an ordinary dependency. Convert thrown
values to `BackendErrorRecord` before returning. The backend's project state is
the only membership authority.

Watch mode returns `pending` and resolves only from the existing program-update
condition. Default/project-service updates return `ready` after their current
refresh. Config changes return `project-reset`; `reset` closes state and leaves
lazy reinitialization for the next miss. Revision outcomes follow Step 2, and
`dispose` closes watchers, projects, client files, and every pending completion
exactly once.

In the same change, create `src/plugin.ts` with internal
`createPlugin(options, backendFactory)`. The only public entry remains
`src/index.ts`; it builds a legacy factory closure and delegates, without
re-exporting the host, contract, or factory. `legacyBackend.ts` must itself be
safe to import without loading TypeScript/server-library/parser runtime; those
loads occur only inside lazy factory creation/initialization.

The host retains only:

- Vite hooks and Plan 004 filtering;
- in-memory and file-system transform caches;
- component-to-dependency and reverse dependency indexes;
- monotonic source revisions and pending-completion bookkeeping;
- warning deduplication and code generation;
- Vite module lookup, invalidation, and delivery behavior; and
- orchestration of backend creation, initialization, update, reset, and
  disposal.

Preserve transform ordering exactly:

1. clean/normalize the ID and apply Plan 004 selection;
2. if this component has a pending backend update, await its latest completion;
3. check the memory cache, then persistent cache, before creating or
   initializing a backend, but accept an entry only when its membership proof
   validates against the current selection, backend descriptor, component path,
   and every recorded config-content hash;
4. on a valid hit, notify an already-created backend with `recordCacheHit`,
   restore host dependency indexes, and return; do not create a backend solely
   for the notification. Treat an absent/stale proof as a miss;
5. on a miss, lazily create/deduplicate and initialize the backend, store its
   project state, and reject a file absent from `docgenFiles` with the unchanged
   warning;
6. call `analyze` with the exact transform source/revision, commit only a result
   whose revision is still current, track its required dependency array, and
   generate from the local DTO.

During hot update, the host reads the current contents for an existing changed
file, assigns a revision, determines affected components from its reverse
index, and calls `update`. Preserve current immediate versus queued legacy
behavior: `ready` invalidates immediately; `pending` schedules invalidation
only for a latest `ready` completion and its carried-forward affected union;
superseded/disposed outcomes do nothing themselves but may not discard that
union.
`project-reset` clears host caches/indexes and awaits `reset` but does not eager
initialize. Do not change hook return values or any Plan 005 expectation.

Feed `backendFactory.describe({ rootDir }).cacheFingerprint` into the persistent
namespace alongside the existing host/options/config inputs. Store the
membership proof in every persistent entry and version the schema. Add tests
proving different implementation/dependency/schema versions cannot share
transforms, identical legacy fingerprints still reuse them, and a cold entry is
rejected when a referenced or extended tsconfig changes membership. Do not add
a false closure-safe callback-key guarantee.

### Step 5: Prove host orchestration and lifecycle parity

Extend `backendContract.test.ts` with a side-effect-counting fake factory and
backend. Prove:

- `include: []` and valid proof-bearing cache hits do not call
  `create`/`initialize`; memory and persistent hits call `recordCacheHit` only
  when a backend already exists; stale/missing proof creates/initializes and
  rechecks membership;
- concurrent cache misses deduplicate factory creation/initialization;
- serve remains lazy, eligible build remains eager, and empty selection remains
  lazy/no-load in both commands;
- selection and stored backend membership/proof are applied in the documented
  order, `analyze` is never called for a nonmember, and a referenced-config
  membership edit invalidates a cold persistent hit;
- success, empty extraction, and sanitized errors all replace dependency
  indexes with their required exact arrays and preserve warning text;
- ready/pending/reset behavior, two rapid revisions, source overlay delivery,
  stale-result rejection, two rapid disjoint updates whose newest readiness
  invalidates both affected component sets, component-scoped commit gates, and
  no invalidation after supersede/disposal;
- a reset is awaited once and leaves reinitialization lazy; and
- creation failure, partial initialization cleanup, repeated disposal, and
  pending disposal leave no handle or unhandled rejection; reset/dispose races
  cannot install a late backend/result and late-created backends close once.

**Verify**:

1. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts` → every fake host/session/cache/revision case passes.
2. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/typescriptCompatibility.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts` → Plan 002/003 boundaries still pass after their code moves.
3. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` → the exact fixed legacy matrix and expectation map are unchanged.
4. The neutral and public-entry scans have no output and their expected exit
   code is 1.

### Step 6: Apply the pre-authored corpus to the direct legacy backend

Extend the Step 1 `backendParity.test.ts` registrations to run the same fixed,
pre-authored expectations directly through the legacy backend in all three
runtime modes. Do not rewrite or update a golden after seeing the extracted
backend's output. Reuse every existing TSX fixture and the compact cases already
authored for:

- direct and transitive imported prop types;
- barrel aliases and re-exports, including Plan 003 target behavior;
- a root `files: []` with a referenced sibling composite project;
- named/default functions, classes, arrows, `forwardRef`, and static
  subcomponents;
- literal unions, enums, optional/default props, rich JSDoc/tags, methods,
  parent/declaration provenance, and multiple components;
- all boolean/string-array parser options currently exposed;
- static and function `propFilter`; and
- `componentNameResolver` receiving the same legacy symbol/source-file shape.

Keep fixture builders and immutable neutral expected DTO/dependency/project
values in `support/backendParityCorpus.ts`. It must import no backend
implementation and is the read-only corpus Plan 007 reuses from its isolated
experiment; legacy-specific callback argument assertions remain in
`backendParity.test.ts`.

Golden-test the complete local DTO plus the exact Step 4 dependency contract
and project state. Map every controlled absolute root to a stable token before
golden comparison: temporary fixture root, repository/workspace root, and the
resolved package-store or `node_modules` roots containing React/`@types`.
Normalize separators and platform line endings after tokenization. In separate
assertions over the raw values, require absolute resolved paths, sorted/
deduplicated arrays, exact reachability, and exclusion of default libraries/
unrelated files. Preserve component/prop order, type raw/value data, targets,
and all other meaningful fields; do not sort output merely to hide a diff.

Keep existing transform snapshots as the public output oracle. They must remain
byte-for-byte unchanged.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`
→ all pre-authored canonical backend goldens and all pre-existing transform
snapshots pass without updates after extraction.

### Step 7: Re-run performance, size, and repository gates

Create two small reusable evidence scripts. `compare-benchmark-results.mjs`
accepts baseline/candidate JSON directories, verifies the same
scenario/mode/metric/status keys, calculates the median and median absolute
deviation across independent samples, prints every percentage delta, and exits
nonzero when a candidate cold, warm, or component-HMR median regresses beyond a
supplied threshold. `compare-package-artifacts.mjs` compares sorted shipped
file inventories, total `.mjs`, `.d.ts`, and source-map bytes, plus packed
archive bytes, and exits nonzero above a supplied growth threshold. Unit-test
their pure calculations inside the scripts' own self-test mode.

Capture the pre-change SHA before implementation. After implementation, add a
detached temporary worktree at that SHA and build/install it immutably. Run five
independent one-iteration processes per large scenario for baseline and
candidate, alternating which checkout runs first for each numbered pair to
reduce order/thermal bias. Write only these independent results to
`paired/baseline/<scenario>-<1..5>.json` and
`paired/candidate/<scenario>-<1..5>.json`; do not mix Step 1 summaries into
those directories. Do not use the benchmark script's informational
`--baseline` printout as the gate.

Then execute:

```powershell
node scripts/compare-benchmark-results.mjs --self-test
node scripts/compare-package-artifacts.mjs --self-test
node scripts/compare-benchmark-results.mjs --baseline-dir "$docgenSeamEvidence/paired/baseline" --candidate-dir "$docgenSeamEvidence/paired/candidate" --max-regression 15
node scripts/compare-package-artifacts.mjs --baseline-dist "$docgenSeamEvidence/baseline-capture/dist" --candidate-dist packages/vite-plugin-react-docgen-typescript/dist --baseline-pack "$docgenSeamEvidence/baseline-capture/plugin.tgz" --candidate-pack "$docgenSeamEvidence/candidate-artifact/plugin.tgz" --max-growth 2
```

The comparator is authoritative: every scenario/mode must have five independent
samples; status changes fail; any missing/high-variability result is reported;
and a greater-than-15% regression fails. If median absolute deviation exceeds
20% of the median, collect five additional alternating pairs and require the
combined verdict. The package comparator must pass for total shipped JS,
declarations, maps, and archive size; a changed chunk inventory is printed for
review even within 2%. A failure suggests duplication or leaked backend code;
investigate rather than weakening the gate. Remove the temporary worktree after
evidence is retained in the PR summary.

Before the package comparison, run
`yarn workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out "$docgenSeamEvidence/candidate-artifact/plugin.tgz"`.
Use the Step 1 baseline dist/archive; if either is missing, STOP rather than
reconstructing an unreviewed baseline after the refactor.

Then run:

1. `yarn install --immutable`
2. focused backend contract and parity tests
3. Plan 002 compatibility and Plan 003 target/generator focused tests
4. Plan 004 and Plan 005 focused tests (Plan 005 uses `--testTimeout=60000`)
5. `yarn typecheck`
6. `yarn test --run`
7. `yarn build`
8. `yarn benchmark:ci` as a smoke test only
9. the two threshold comparators above
10. `yarn exec biome ci` with the explicit list returned by
    `git diff --name-only --diff-filter=ACMR -- '*.ts' '*.mjs'` (review the list
    before running; it must contain only in-scope files)
11. the neutral/public-entry scans above (expected no output, `rg` exit 1)
12. `git diff --check`
13. `git status --short`

Expected: no dependency/lock/package-export diff; all tests and builds pass;
existing output snapshots and Plan 005 ledgers are unchanged; no open handles;
machine-enforced performance and complete package-artifact gates hold; and only in-scope files plus the plan-index
status update are modified.

## Test plan

- Fake-backend host tests for lifecycle, cache isolation, dependency indexing,
  update readiness, resets, warnings, and disposal.
- Direct legacy-backend canonical DTO/project/dependency goldens in all current
  modes and parser-option variations.
- Existing transform snapshots as byte-for-byte public output parity.
- Plan 004 project membership and Plan 005 real-Vite observations as external
  behavior boundaries.
- Five paired, alternating independent-process samples and complete dist/packed-
  artifact comparisons to catch structural regressions.

## Done criteria

- [ ] The package still exposes one unchanged public plugin entry and no
      backend-selection API.
- [ ] `index.ts`/`plugin.ts` contain no legacy Program, server-library, or
      `FileParser` lifecycle.
- [ ] All compiler/parser/project/target/dependency/freshness work lives in the
      legacy backend or a clearly legacy-only helper.
- [ ] The neutral DTO and backend contract expose no TypeScript, Vite, or
      upstream parser objects.
- [ ] The factory is lazy and side-effect-free before creation; `include: []`
      and cold cache hits load no compiler/parser runtime.
- [ ] One shared boundary-path helper, monotonic source revisions, and explicit
      ready/superseded/disposed outcomes prevent backend-specific identity and
      stale-completion behavior.
- [ ] Generator input is the local DTO and every upstream `expression` symbol
      is removed before crossing the boundary.
- [ ] Generator, legacy resolver, and future backends share one compiler-neutral
      strict runtime-target predicate; legacy AST resolution stays isolated.
- [ ] The Vite host owns filters, transforms, caches, reverse dependencies,
      warnings, generation, and module invalidation only.
- [ ] Persisted cache namespaces include backend implementation/dependency/
      schema identity, and entries carry a validated complete-config membership
      proof; valid hits preserve legacy access/LRU without initialization.
- [ ] Every existing transform snapshot is byte-for-byte unchanged.
- [ ] Canonical legacy backend metadata, target, dependency, option, project-
      reference, reset, and disposal parity tests pass in all modes.
- [ ] The parity expectations were authored/reviewed before extraction and were
      not updated from the extracted backend's own output.
- [ ] Plan 005's exact HMR ledger is unchanged; no bug is accidentally hidden
      or claimed fixed by the refactor.
- [ ] No dependency, lockfile, package export, build entry, or changeset changes.
- [ ] Full verification, paired performance, complete artifact-size,
      formatting, and scope gates pass.
- [ ] `plans/README.md` marks Plan 006 `DONE`, unless the dispatching reviewer
      explicitly owns the index update.

## STOP conditions

Stop and report if:

- Plans 002–005 are not complete or their baselines are unstable.
- The proposed neutral contract needs a legacy `Program`, checker, symbol,
  node, source file, `FileParser`, Vite server, or `ModuleNode`.
- Any generated metadata, component/prop ordering, target expression, warning,
  project membership, dependency list, HMR ledger, or public type changes.
- Function `propFilter` or `componentNameResolver` cannot retain its exact
  legacy behavior in the legacy adapter.
- Dependencies after a recoverable parse failure cannot be preserved.
- Watch/project-service reset or disposal leaves a pending promise/open handle,
  a completion can reject, or an older revision can overwrite/invalidate after
  a newer one.
- Cache-first ordering cannot be made safe with a complete, cheaply validated
  membership proof, or project membership gains an independent second
  authority.
- A dependency, lockfile, public export, build entry, or changeset appears
  necessary.
- The paired comparator reports a greater-than-15% cold, warm, or HMR median
  regression after the high-variability rerun, or any complete shipped artifact
  category/packed archive grows more than 2% after duplication is removed.
- A verification fails twice after one focused correction.

## Maintenance notes

- This is a session boundary, not a compatibility facade for legacy TypeScript
  objects. A future backend must implement the local DTO and lifecycle directly.
- Keep public upstream callback options routed only through the legacy adapter
  until a later product decision defines a backend-neutral replacement.
- Keep dependency paths complete—including relevant external declarations and
  linked packages—and preserve their explicit contract. Plan 008
  may introduce a separate canonical comparison key only when Plan 005 proves
  identity is causal; Vite-facing/cache paths must remain distinct.
- Do not remove the legacy backend for at least one release after any native
  backend becomes opt-in; rollback and parity evidence are part of the hybrid
  strategy. While legacy remains shipped or supported, Plan 008's HMR repair
  remains mandatory rather than being waived by native feasibility evidence.
