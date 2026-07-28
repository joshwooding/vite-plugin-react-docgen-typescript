# Plan 015: Refresh dynamic TypeScript project membership without a Vite restart

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. A dispatching
> reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 418ecde..HEAD -- packages/vite-plugin-react-docgen-typescript/src/plugin.ts packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts`
> Plan 012 is expected to change `plugin.ts`; revised Plan 013 is expected to
> replace the obsolete listener-Promise completion probe in
> `importedTypeHmrContract.ts`. Reconcile only those reviewed predecessor
> changes and stop on other semantic drift.

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plans 012 and 014
- **Category**: bug / tests
- **Planned at**: commit `418ecde`, 2026-07-27

## Why this matters

Once project state exists, the host rejects a TypeScript creation event unless
the path was already tracked. A newly created matching component is also
skipped during transform with an instruction to restart Vite. ProjectService
and the builder therefore never get a chance to refresh configured project
membership, and recreating a previously missing imported type can leave docgen
stale. File creation/deletion is rare enough to allow a conservative project
refresh, but ordinary edits must remain selective.

## Current state

- `src/plugin.ts:420-427` rejects matching transform targets absent from the
  initial `projectState.docgenFiles`.
- `src/plugin.ts:478-491` computes affected files from existing reverse edges,
  then returns before backend update for an untracked creation.
- `src/docgen/legacyBackend.ts:1280-1290` independently ignores untracked files
  for configured projects.
- `src/__tests__/support/importedTypeHmrContract.ts` covers two imported edits
  and component-touch recovery, not create/delete/recreate membership.
- Vite 6+ delivers `create` and `delete` through its supported per-environment
  `hotUpdate` hook; it invokes legacy `handleHotUpdate` only for `update`.
  The first regression harness observed only `handleHotUpdate`, so its timeout
  was a harness boundary rather than evidence that a second watcher is needed.
- Vite 3–5 do **not** deliver create/delete uniformly through
  `handleHotUpdate`. Their public dev-server API does expose both the existing
  `server.watcher` and `server.reloadModule(module)`. Compatibility therefore
  requires a listener on Vite's watcher, not another filesystem watcher, and
  explicit reload of the affected component modules after shared backend
  refresh.
- File selection remains owned by `utils/fileSelection.ts`; project membership
  remains owned by the backend. Do not merge those boundaries.

Current rejection:

```ts
const isTracked = projectState
  ? isConfigChange ||
    projectState.trackedFiles.includes(normalizedFile) ||
    (projectState.configFiles.length === 0 && isPotentialTypescriptFile)
  : isPotentialTypescriptFile;
if (!isTracked) return;
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Backend contract | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts` | all pass |
| Project selection | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts` | all pass |
| Real Vite HMR | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | all modes/topologies pass |
| Parity | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts` | all pass |
| Packed runtime matrix | build/pack once and run every Plan 014 JSON row against the same archive | all Vite 3–8 rows pass their selected modes |
| Typecheck/full/build | `yarn typecheck && yarn test --run && yarn build` | all pass |
| Lint/whitespace | changed-file Biome and `git diff --check` | exit 0 |

## Scope

**In scope**:

- `packages/vite-plugin-react-docgen-typescript/src/plugin.ts`
- `packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts`
  if needed for matching/out-of-project creation boundaries
- `scripts/verify-runtime-compatibility.mjs`
- one patch `.changeset/*.md`

**Out of scope**:

- changing include/exclude semantics or automatically including files outside
  configured project/reference membership;
- broad invalidation for ordinary tracked edits;
- creating a second filesystem watcher or watching paths outside Vite's
  existing watcher;
- changing runtime defaults, public options, peers, or dependencies;
- TypeScript 7/native work.

## Git workflow

- Branch: `codex/015-refresh-dynamic-project-membership`
- Base on approved Plans 011–014.
- Commit: `Refresh dynamic TypeScript project membership`.
- Stage explicit in-scope paths only. Do not push.

## Steps

### Step 1: Add exact create/delete/recreate contracts

Extend the real Vite support harness with an observer that implements
`hotUpdate`, `handleHotUpdate`, and the Vite 3–5 compatibility delivery path,
matching Vite's versioned event contract. Then cover:

1. create a matching component after plugin initialization and transform it;
2. create an imported type that resolves a previously missing import;
3. delete a tracked imported type;
4. recreate it with changed prop metadata; and
5. repeat the cycles in same-project and referenced-project topologies.

Run default legacy, stable ProjectService, and WatchProgram. Assert fresh
metadata, no hot errors/full reloads, and clean teardown. For a newly created
component with no pre-existing module-graph node, assert fresh transformability
and metadata after its first request; do not invent a delivery expectation.
Reserve exact HMR delivery assertions for already-transformed dependents during
the imported dependency delete/recreate cycles. Ordinary edit selectivity must
remain exact.

Add negative controls: a matching glob outside configured TypeScript
membership remains skipped, and a non-TypeScript/unselected creation does not
reset the project.

**Verify**: at least the new matching/recreate cases fail on `418ecde` for the
documented initial-discovery/tracked gate, while negative controls pass.

### Step 2: Route candidate TypeScript creations through backend membership

Extract one backend-neutral update pipeline that accepts an explicit
`create`, `update`, or `delete` kind.

- Route all Vite 6+ events through `hotUpdate`. It may run once per
  environment: update shared backend/cache/revision state exactly once per
  `(type, file, timestamp)` event, then collect and return module identities
  from the current hook environment without replaying the backend lifecycle or
  leaking client nodes into another environment.
- Retain `handleHotUpdate` for ordinary Vite 3–5 updates.
- In `configureServer`, feature-detect the pre-environment Vite server shape
  and subscribe to `add` and `unlink` on Vite's existing `server.watcher` only
  for Vite 3–5. Run the same logical update pipeline, then call the public
  `server.reloadModule(module)` once for each unique affected component module.
  Catch asynchronous listener failures and report them through Vite's error
  channel. Store exact handler references and every in-flight listener task.
  During teardown, first remove both listeners so no new work can start, then
  drain the captured tasks before disposing backend/cache state. A late task
  must never call `reloadModule` or send an error after server closure.

Do not register the compatibility listeners on Vite 6+, instantiate another
watcher, emit synthetic filesystem events, send full reloads, or process an
ordinary update through both hooks.

In that shared pipeline, distinguish `create` from ordinary `update` before
the old tracked-file early return. Apply two separate boundaries:

- a newly created docgen transform target must pass the shared include/exclude
  selection before it can become transformable; and
- a non-docgen TypeScript dependency such as `props.ts` may request project
  membership/dependency refresh when it belongs to the configured
  project/reference graph, but it must never become a docgen transform target
  merely because it triggered refresh.

The backend must re-resolve configured project/reference membership for a
candidate creation and return either:

- refreshed state containing the file; or
- an ignored/not-member result that preserves the current project.

Use the existing reset/initialization lifecycle and revision guards; do not add
a second watcher or mutate TypeScript internals.

**Verify**: matching new components become transformable without restart;
out-of-project negative controls remain excluded; every event advances the
backend revision once even when Vite 6+ invokes multiple environments; a
focused fake-backend hook test proves that revision invariant directly; Vite
3–5 listener counts return to their baseline and all listener tasks settle
before teardown resolves.

### Step 3: Recover unresolved imported dependencies conservatively

When a candidate TypeScript creation has no reverse edge because resolution
previously failed, refresh backend state first. If the refreshed program makes
the file a project member but an exact dependent cannot be recovered, invalidate
the already transformed component set for that creation event only. Subsequent
tracked edits must rebuild exact reverse edges and return to selective
invalidation.

Delete and recreate must not leave stale transform or persistent cache entries.
Respect Plan 012's dependency proof.

**Verify**: missing-import recreation produces fresh metadata in all required
modes/topologies; the next ordinary edit invalidates only exact dependents.

### Step 4: Remove the restart-required behavior

Replace the warning that tells users to restart for matching newly created
files with truthful diagnostics only for files outside active configured
membership. Do not suppress genuine misconfiguration warnings.

Add a patch changeset for dynamic membership/HMR recovery.

**Verify**:

```sh
rg -n 'restart the Vite server to include newly created files' packages/vite-plugin-react-docgen-typescript/src
```

returns no output.

### Step 5: Close all gates

Run focused backend/selection/HMR/parity tests, typecheck, full tests, build,
and changed-file Biome/whitespace checks. Extend the packed runtime verifier so
each selected mode exercises create, delete, and recreate of a missing imported
type in addition to its two ordinary edits. Assert fresh metadata, exact
dependent delivery, no full reload/hot error, and clean watcher teardown. Keep
the private one-revision-per-event assertion in the focused fake-backend test;
do not infer it from packed black-box output. Then run the complete Plan 014
Vite 3–8 matrix against one archive.

**Verify**: all pass; only in-scope source/tests/changeset changed.

## Test plan

- Same-project and project-reference topology.
- Default, stable ProjectService, and deprecated WatchProgram.
- New matching component after initialization.
- Missing imported type created, deleted, and recreated with changed metadata.
- Negative out-of-project and unselected file cases.
- Exact invalidation returns after the conservative creation recovery.
- Overlapping revision and teardown controls remain exact.

## Done criteria

- [x] Matching project-member components created after initialization transform
      without restarting Vite.
- [x] Missing imported types can be created/deleted/recreated with fresh
      metadata in all required modes/topologies.
- [x] Candidate creation refresh does not admit files outside configured
      project/reference and selection boundaries.
- [x] Conservative broad invalidation is limited to unresolved creation
      recovery; normal edits remain selective.
- [x] No extra filesystem watcher is introduced; Vite 3–5 compatibility
      listeners on the existing watcher are removed and their in-flight tasks
      are drained before backend teardown.
- [x] Vite 6+ `hotUpdate`, Vite 3–5 `handleHotUpdate`, and Vite 3–5
      add/unlink compatibility listeners share one logical update pipeline
      without duplicate backend revisions or cross-environment module leakage.
- [x] The packed Vite 3–8 verifier proves create/delete/recreate behavior, not
      only ordinary edits, for every selected runtime mode.
- [x] Restart-required warning text is removed.
- [x] Focused/full tests, parity, typecheck, build, Biome, and whitespace gates
      pass.

## STOP conditions

Stop and report if:

- create/delete still do not reach Vite 6+ `hotUpdate` after the real-server
  harness observes the correct supported hook;
- Vite 3–5 parity cannot be implemented using listeners on Vite's existing
  watcher plus its public `reloadModule` API, or requires synthetic watcher
  events, a second watcher, client-code injection, or full reloads;
- correctness requires changing include/exclude or tsconfig membership;
- WatchProgram cannot refresh without sleeps/polling waivers;
- every ordinary edit must invalidate all transformed modules;
- backend-neutral contracts require TypeScript-specific fields; or
- Plan 012 cache freshness regresses.

## Maintenance notes

- Creation is intentionally allowed a more conservative invalidation strategy
  than normal edits; review that branch so it cannot leak into the steady
  state.
- Vite environment hooks provide the direct event surface on Vite 6+. Keep the
  smaller Vite 3–5 listener adapter isolated and removable when that peer range
  is eventually dropped.
- The performance experiment after this plan must benchmark the final refreshed
  project-state lifecycle rather than the pre-membership baseline.
