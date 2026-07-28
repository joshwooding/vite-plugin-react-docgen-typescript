# Plan 012: Invalidate persistent cache entries when imported dependencies change

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. A dispatching
> reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 418ecde..HEAD -- packages/vite-plugin-react-docgen-typescript/src/utils/cache.ts packages/vite-plugin-react-docgen-typescript/src/plugin.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`
> Expected before this plan, apart from Plan 011's workflow-only commit: no
> output.

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 010
- **Category**: bug / tests
- **Planned at**: commit `418ecde`, 2026-07-27

## Why this matters

The optional filesystem cache keys a transform by component path and component
source and validates backend, selection, and config-file fingerprints. It
persists imported dependency paths but does not fingerprint their contents.
When an imported prop/type file changes while Vite is stopped, the next plugin
instance can return stale docgen without initializing a backend. Cold cache
reuse must prove every imported dependency still has the recorded contents.

## Current state

- `src/utils/cache.ts:37-43` defines a proof containing only backend identity,
  component path, config files, and selection identity.
- `src/utils/cache.ts:368-424` hashes and validates config files only.
- `src/plugin.ts:285-298` persists `dependencies` beside the result but passes
  only `state.configFiles` into `createFileSystemCacheProof`.
- `backendContract.test.ts:435-559` proves config changes invalidate a cold
  entry.
- `index.test.ts:572-649` proves cross-instance reuse without changing an
  imported dependency; same-process HMR coverage is not a cold-start proof.

Relevant current shape:

```ts
export interface FileSystemCacheProof {
  backendFingerprint: string;
  componentFile: string;
  configFiles: FileSystemCacheConfigProof[];
  selectionFingerprint: string;
}
```

```ts
proof: createFileSystemCacheProof({
  backendFingerprint: backendDescriptor.cacheFingerprint,
  componentFile: normalizedFileId,
  configFiles: state.configFiles,
  selectionFingerprint,
}),
```

Use `normalizeBoundaryPath(s)` for compiler/Vite identity and the existing
SHA-256 helpers for disk proof. Do not introduce mtime-only validity.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused cache tests | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts` | all pass |
| Backend parity | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts` | all pass |
| HMR contract | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | all pass |
| Typecheck | `yarn typecheck` | exit 0 |
| Full tests | `yarn test --run` | all pass |
| Build | `yarn build` | exit 0 |
| Lint | `yarn exec biome ci <changed TypeScript files>` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `packages/vite-plugin-react-docgen-typescript/src/utils/cache.ts`
- `packages/vite-plugin-react-docgen-typescript/src/plugin.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts`
  only if needed for stable-mode cold-cache coverage
- one patch `.changeset/*.md`

**Out of scope**:

- enabling the filesystem cache by default;
- atomic writes, pruning, directory locking, or cache-size policy;
- changing callback serialization/closed-over function identity;
- changing in-memory transform cache semantics;
- changing docgen output, backend interfaces, runtime defaults, peers, or
  dependencies.

## Git workflow

- Branch: `codex/012-fingerprint-persistent-cache-dependencies`
- Base on the approved Plan 011 commit.
- Commit: `Invalidate stale persistent docgen dependencies`.
- Stage explicit in-scope paths only. Do not push.

## Steps

### Step 1: Add the failing two-instance regression

Create a fixture with a component importing a prop/type from another file.
Instance A must populate the filesystem cache and produce initial metadata.
Close it completely, change only the imported file, then construct Instance B
with identical plugin options and unchanged component source.

Run the case for omitted/default legacy and
`docgenMode: "project-service"`. Instance B must not return the old metadata;
it must initialize/analyze and return the changed union/description. Also keep
a control where no file changes and Instance B reuses the cold entry without
backend creation.

Add deleted and unreadable dependency cases: they invalidate the entry and
fall back to analysis/error handling rather than throwing from proof
validation.

**Verify**: the changed-dependency regression fails on `418ecde` for the
expected stale-cache reason while the unchanged control passes.

### Step 2: Extend the proof with dependency content identity

Add a clearly named dependency fingerprint array to
`FileSystemCacheProof`. Normalize, deduplicate, and sort paths before hashing.
Hash file contents with SHA-256, like config files. Validation must require an
exact well-formed set and fail closed on missing/unreadable files.

The component's current source is already part of the cache filename, but it is
acceptable to deduplicate it if it also appears in the dependency list. Do not
replace content hashes with mtimes or sizes.

Bump `FILE_SYSTEM_CACHE_VERSION` so old schema entries cannot be trusted.

**Verify**: focused proof tests cover changed, deleted, duplicate, malformed,
and unchanged dependency fingerprints.

### Step 3: Persist real analysis dependencies in the proof

Pass the same normalized dependency set stored on the cache entry into
`createFileSystemCacheProof`. A valid cold hit must still restore the reverse
dependency index without backend initialization. An invalid proof must behave
as a miss and use the existing warning/error boundaries.

Do not hash arbitrary project files: hash only the analysis dependencies
whose content can affect the cached transform.

**Verify**: both runtime-mode regressions and the no-change cold-hit control
pass.

### Step 4: Close the production gates

Add a patch changeset describing cold cache correctness, then run every command
in the command table.

**Verify**: full tests/typecheck/build pass; changed-file Biome and
`git diff --check` pass; only in-scope paths changed.

## Test plan

- Two complete plugin instances, not two transforms in one process.
- Default legacy and stable ProjectService rows.
- Imported dependency unchanged: cold hit, backend remains uninitialized.
- Imported dependency content changed: cold miss and fresh metadata.
- Dependency deleted/unreadable: proof invalid, no cache-read crash.
- Config/backend/selection proof behavior remains exact.
- Existing HMR and backend parity suites remain green.

## Done criteria

- [ ] Cold entries contain deterministic content fingerprints for every
      persisted analysis dependency.
- [ ] Validation checks those contents before returning a cached transform.
- [ ] The cache schema version is bumped.
- [ ] Changed/deleted dependency regressions pass in legacy and ProjectService.
- [ ] An unchanged dependency still produces a backend-free cold hit.
- [ ] Cache remains opt-in and public/runtime semantics are otherwise
      unchanged.
- [ ] Focused tests, HMR contract, parity, typecheck, full tests, build, Biome,
      and whitespace checks pass.

## STOP conditions

Stop and report if:

- analysis dependencies do not include the imported files that affect output;
- correctness requires hashing every TypeScript project file rather than the
  recorded dependency closure;
- dependency fingerprinting changes generated output or HMR delivery;
- the valid cold-hit path must initialize ProjectService; or
- callback serialization, cache locking, or a new runtime dependency becomes
  necessary.

## Maintenance notes

- Any future backend must report a complete dependency closure before its
  results can safely use this cache.
- Atomic writes, pruning, and callback-key truthfulness remain separate
  lifecycle work; do not claim this plan solves them.
- Review path normalization and deleted-file behavior carefully on Windows.
