# Plan 013: Declare the Node runtime contract and refresh vulnerable dependencies

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. A dispatching
> reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 418ecde..HEAD -- package.json packages/vite-plugin-react-docgen-typescript/package.json yarn.lock README.md .github/runtime-compatibility-matrix.json .github/workflows/ci.yml`
> Plan 011 is expected to change `ci.yml`; Plans 011–012 must not otherwise
> change these paths. Reconcile only the reviewed predecessor diff.

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plans 010 and 011
- **Category**: migration / security / tests
- **Planned at**: commit `418ecde`, 2026-07-27

## Why this matters

The published package declares Vite 3–8 compatibility but no Node engine. Its
locked direct `glob@13.0.1` dependency declares Node `20 || >=22`, while every
CI row uses Node 24. Users therefore receive an undocumented effective Node
floor. The same lock resolves a vulnerable `minimatch@10.1.2` on the runtime
glob path. Establish a truthful Node contract, exercise its lower family, and
refresh only the dependencies needed to remove reachable runtime and current
Vite test-harness advisories.

## Current state

- `packages/.../package.json` has no `engines` field, depends on
  `"glob": "^13.0.1"`, and peers Vite 3–8.
- `yarn.lock` resolves `glob@13.0.1` and `minimatch@10.1.2`.
- root `package.json` declares `"vite": "^8.0.0"`.
- `.github/workflows/ci.yml` hard-codes Node 24.
- Plan 010's matrix JSON has TypeScript/Vite versions but no Node version.
- `scripts/verify-runtime-compatibility.mjs` currently treats a Promise returned
  directly by Vite's watcher listener as the only proof that an asynchronous
  HMR cycle started. Patched Vite 8 releases dispatch that work without
  returning the Promise through the EventEmitter listener, so the harness
  stops before its metadata and exact-delivery assertions.
- `src/__tests__/support/importedTypeHmrContract.ts` duplicates the same
  listener-Promise completion assumption for the 14-row HMR contract matrix.
  The shared test support must use the same observable, deadline-bounded
  completion signal as the packed verifier.
- `npm view glob@13.0.6 engines` reports a compatible maintained release, and
  its minimatch range can resolve a patched `10.2.x`; re-check live metadata
  during execution rather than trusting this planning-time observation.

The chosen package contract is Node `20 || >=22`. This matches the direct
runtime dependency's supported release lines without falsely claiming Node 21,
which is excluded upstream and is not exercised by CI. Do not claim Vite 3's
historical Node 14 floor.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Refresh lock | `yarn install` | exit 0 and deterministic lock update |
| Immutable install | `yarn install --immutable` | exit 0 |
| Dependency trace | `yarn why glob && yarn why minimatch && yarn why vite` | direct glob resolves current patched minimatch; root Vite is patched |
| Audit | `yarn npm audit --all --recursive --severity high` | any remaining findings are classified as dev-only/unreachable; no vulnerable direct package glob path |
| Focused selection | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/projectSelection.test.ts` | all pass |
| Packed current row | run `scripts/verify-runtime-compatibility.mjs` with a freshly packed archive, TS 6.0.3, current Vite 8.x | passes |
| Packed patched Vite boundary | run the same archive/verifier with TS 6.0.3 and the latest patched Vite 8.0.x | passes |
| Typecheck | `yarn typecheck` | exit 0 |
| Full tests | `yarn test --run` | all pass |
| Build | `yarn build` | exit 0 |
| Lint | `yarn biome:ci` | exit 0 on LF checkout; document baseline-only CRLF deviation on Windows |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `package.json`
- `packages/vite-plugin-react-docgen-typescript/package.json`
- `yarn.lock`
- `README.md`
- `.github/runtime-compatibility-matrix.json`
- `.github/workflows/ci.yml`
- `scripts/verify-runtime-compatibility.mjs`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts`
- one patch `.changeset/*.md`

**Out of scope**:

- changing TypeScript or Vite peer ranges;
- updating `react-docgen-typescript`;
- broad opportunistic dependency upgrades;
- supporting Node below 20 by downgrading the file-selection stack;
- changing file-selection behavior or glob semantics;
- TypeScript 7 support.

## Git workflow

- Branch: `codex/013-declare-node-support-and-refresh-runtime-dependencies`
- Base on approved Plans 011–012.
- Commit: `Declare and verify the Node runtime floor`.
- Stage explicit in-scope paths only. Do not push.

## Steps

### Step 1: Reconfirm upstream metadata and audit reachability

Query npm for current `glob`, `minimatch`, and Vite versions, engines, and
dependency ranges. Trace the locked graph with `yarn why`. Record which audit
entries are:

- direct published runtime path;
- peer/test harness path; or
- unrelated dev-only transitive path.

Do not promise that a general audit is clean if unrelated tooling still has
advisories.

**Verify**: the current vulnerable minimatch is proven to descend from the
published `glob` dependency and a patched compatible glob release exists.

### Step 2: Declare Node 20 and Node 22+ and add them to compatibility data

Add `"engines": { "node": "20 || >=22" }` to the published package. Document
the exact supported Node release lines in README compatibility guidance; do
not describe the range as “20 or newer,” because that would include Node 21.

Add a `node` field to every compatibility matrix entry. Exercise an exact
Node 20 release compatible with the selected Vite pair (use at least 20.19 for
Vite 7/8 rows) and Node 24 for the current upper-family row. Update CI to read
the matrix value rather than hard-code Node 24.

**Verify**: JSON parses; every row has a Node value; workflow setup-node reads
`${{ matrix.node }}`.

### Step 3: Refresh only the affected dependency paths

Raise the published glob range to the current compatible patched 13.x release
and the root Vite range to the current patched Vite 8 release. Regenerate the
lockfile with Yarn 4. Do not update `react-docgen-typescript` or unrelated
majors/minors merely because Yarn reports them.

Confirm the resulting published glob path no longer resolves a minimatch
version named by the three current high-severity ReDoS advisories.

**Verify**: `yarn why` and audit output prove the direct path is patched;
immutable install succeeds.

### Step 4: Re-run behavior and packaging gates

Adapt both the packed verifier and the shared imported-type HMR contract
helper's asynchronous-cycle probes to the same Vite-version-neutral observable
completion signal. They may wait with their existing deadline helpers for an
HMR payload captured from the client hot channel after the synthetic watcher
event. Do not treat a synchronous EventEmitter return value or a
listener-returned Promise as the sole completion oracle. Keep the existing
post-cycle requirements unchanged: fresh metadata, no full reload, exactly one
dependent delivery, and zero unrelated deliveries for both topologies and both
edits. Preserve the contract helper's hook-completion, invalidation, returned
module, identity, teardown, and leak assertions.

Run focused selection tests, full tests, typecheck, build, packed verification
with both the current Vite 8.x row and the latest patched Vite 8.0.x boundary,
Biome, and whitespace checks. Add a patch changeset naming the Node contract
and dependency refresh without claiming TypeScript 7 support.

**Verify**: every command passes and package peer ranges/exports remain
unchanged.

## Test plan

- Matrix JSON validates every row's Node version.
- At least one compatibility row runs on Node 20 and the upper row runs Node
  24.
- Existing selection tests lock glob behavior.
- Freshly packed package passes same-project and project-reference HMR with the
  refreshed graph on current Vite 8.x and the latest patched Vite 8.0.x.
- The verifier waits for observable hot-channel delivery and retains its exact
  metadata/module-delivery assertions; it does not add a fixed sleep or weaken
  a failed delivery into a pass.
- Audit/`yarn why` prove direct runtime remediation; unrelated dev-only
  advisories are reported, not hidden.

## Done criteria

- [ ] Published package declares Node `20 || >=22` and README matches without
      claiming Node 21.
- [ ] Compatibility rows carry and consume explicit Node versions.
- [ ] Direct glob/minimatch runtime path is on a patched compatible release.
- [ ] Root Vite test harness is on a patched Vite 8 release.
- [ ] `react-docgen-typescript`, peer ranges, exports, and runtime behavior are
      unchanged.
- [ ] Immutable install, focused/full tests, typecheck, build, packed check,
      Biome, and whitespace checks pass.
- [ ] The packed verifier works across patched Vite 8.0.x and current Vite 8.x
      without weakening metadata freshness or exact-delivery assertions.

## STOP conditions

Stop and report if:

- the patched glob release changes include/exclude semantics in focused tests;
- a clean direct runtime path requires a glob major change or Node above 20;
- Vite patching requires changing the declared Vite peer range;
- Yarn attempts a broad unrelated lock rewrite that cannot be isolated; or
- compatibility requires lowering the already effective Node floor.

## Maintenance notes

- Supporting an old Vite major does not imply supporting that Vite release's
  historical minimum Node version; the package engine is authoritative.
- Plan 014 consumes the new per-row Node field and must preserve the lower
  Node-family coverage.
- Revisit the Node floor intentionally in a major release, not indirectly
  through a transitive dependency.
