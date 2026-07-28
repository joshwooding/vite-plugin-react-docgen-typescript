# Plan 014: Verify every shipped runtime across the packed compatibility matrix

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. A dispatching
> reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 418ecde..HEAD -- scripts/verify-runtime-compatibility.mjs .github/runtime-compatibility-matrix.json .github/workflows/ci.yml`
> Plan 011 is expected to restructure `ci.yml`; Plan 013 is expected to add
> Node values. Stop on any other semantic drift.

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: Plans 011 and 013
- **Category**: tests / dx
- **Planned at**: commit `418ecde`, 2026-07-27

## Why this matters

Plan 010's eight-row packed matrix proves only
`docgenMode: "project-service"`. This release still ships omitted/default
legacy, explicit stable legacy, both deprecated aliases, and WatchProgram.
Those modes can regress on an older TypeScript/Vite pair while the matrix stays
green. The matrix also rebuilds and repacks the identical artifact eight times
and has no recurring Windows path-sensitive row. Make the packed artifact the
single tested unit and exercise the complete supported runtime contract at
bounded cost.

## Current state

- `.github/runtime-compatibility-matrix.json` contains eight TypeScript/Vite
  rows; Plan 013 adds explicit Node values.
- `scripts/verify-runtime-compatibility.mjs:297` hard-codes:

```js
reactDocgenTypescript({
  docgenMode: "project-service",
  // ...
})
```

- `.github/workflows/ci.yml` installs, builds, and packs independently inside
  every matrix cell.
- `runtimeMode.test.ts`, backend parity, and the real-Vite contract prove mode
  equivalence only on the repository's primary dependency versions.
- Plan 011 makes release depend on all compatibility consumers. Preserve that
  invariant when splitting producer and consumer jobs.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Script syntax | `node --check scripts/verify-runtime-compatibility.mjs` | exit 0 |
| Matrix parse | `yarn node -e "const fs=require('node:fs'); const m=JSON.parse(fs.readFileSync('.github/runtime-compatibility-matrix.json','utf8')); console.log(m.include.length)"` | prints expected row count |
| Workflow parse | parse `.github/workflows/ci.yml` with `yaml` | exit 0 |
| Pack | `yarn build && yarn workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out <absolute temp tgz>` | archive created |
| Current row | verifier against TS 6/current Vite with all requested modes | both topologies and two edits pass |
| Full matrix | invoke verifier for each JSON row against the same archive | every local row exits 0 |
| Focused mode tests | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeMode.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --testTimeout=60000` | all pass |
| Full tests | `yarn test --run` | all pass |
| Typecheck/build | `yarn typecheck && yarn build` | exit 0 |
| Lint/whitespace | changed-file Biome and `git diff --check` | exit 0 |

## Scope

**In scope**:

- `scripts/verify-runtime-compatibility.mjs`
- `.github/runtime-compatibility-matrix.json`
- `.github/workflows/ci.yml`
- focused tests for verifier argument/schema helpers, if extracted

**Out of scope**:

- changing production source or public options;
- removing or changing any runtime mode;
- shrinking peers or skipping failed version pairs;
- changing generated docgen output;
- publishing or uploading package artifacts outside short-lived CI artifacts;
- adding TypeScript 7.

## Git workflow

- Branch: `codex/014-verify-every-shipped-runtime-combination`
- Base on approved Plans 011–013.
- Commit: `Verify every shipped runtime combination`.
- Stage only in-scope paths. Do not push.

## Steps

### Step 1: Parameterize the packed consumer by runtime mode

Add a strict mode list input. Use internal test IDs mapped to exact public
configurations:

- `default` → no runtime field;
- `legacy` → `docgenMode: "legacy"`;
- `project-service` → `docgenMode: "project-service"`;
- `experimental-watch` → `EXPERIMENTAL_useWatchProgram: true`;
- `experimental-project-service` →
  `EXPERIMENTAL_useProjectService: true`.

Reject unknown/duplicate/empty modes. For every selected mode, run both
same-project and project-reference fixtures, two imported-type edits, exact
freshness/delivery/selectivity, and clean teardown. Include mode and topology
in errors/output.

**Verify**: current TS/Vite packed archive passes all five modes locally.

### Step 2: Bound matrix cost without weakening coverage

Extend each matrix row with a mode list:

- every row runs `default`, `legacy`, and `project-service`;
- lower-bound and upper-family rows also run both experimental aliases.

Add two Windows rows representing lower and upper families, using the same
version data and explicit Node values. Windows rows must exercise stable legacy
and ProjectService plus watcher teardown. Do not duplicate all eight rows on
Windows.

**Verify**: a schema check confirms every row has `os`, `node`, `typescript`,
`vite`, and non-empty `modes`; every declared stable runtime appears in every
row; deprecated modes appear in both boundary families.

### Step 3: Build and pack once

Create a single producer job that checks out the exact SHA, performs immutable
install, builds, packs, records archive SHA-256 and source SHA, and uploads the
archive as a short-lived artifact. Pin upload/download actions by verified
commit, following Plan 011.

Each matrix consumer downloads that archive, verifies its digest/source
metadata, and runs only the exact peer installation and packed verifier.
Consumers must never import repository source. Release continues to depend on
every consumer, not only on the producer.

**Verify**: workflow text contains one workspace `pack` invocation; every
consumer verifies archive digest before execution.

### Step 4: Run all local compatibility rows

Build/pack once to a new absolute temp path. Iterate the JSON matrix serially
against that same archive. On the current Windows host, run every version/mode
combination regardless of the row's CI OS; this proves package/version behavior
and Windows path handling. Workflow structure is the Linux runner proof until
remote Actions runs.

If a pair fails twice, stop. Do not remove it, alter peers, or silently select
another runtime.

**Verify**: every row exits 0; outputs name all modes/topologies and report no
open watcher handles.

### Step 5: Close repository gates

Run focused mode/HMR tests, full tests, typecheck/build, YAML/JSON parsing,
changed-file Biome, and whitespace checks.

**Verify**: all commands pass and only in-scope verifier/matrix/workflow paths
changed.

## Test plan

- Strict CLI/schema cases: missing, empty, unknown, and duplicate mode values.
- Packed runtime cases: five public configurations, two topologies, initial
  metadata, two imported edits, exact delivery, unrelated selectivity, and
  teardown.
- Stable three-mode coverage on every TypeScript 4.3–6 / Vite 3–8 row.
- Deprecated modes on lower and upper boundary families.
- Representative Windows lower/upper rows.
- One exact archive built from and bound to the tested commit.

## Done criteria

- [ ] Every matrix row tests default, explicit legacy, and stable
      ProjectService.
- [ ] Both deprecated aliases are tested at lower and upper boundaries.
- [ ] Representative lower/upper Windows rows pass.
- [ ] CI builds and packs once; consumers verify and reuse the same archive.
- [ ] Release remains dependent on every compatibility consumer.
- [ ] Every local JSON row passes all selected modes/topologies/edits and
      teardown.
- [ ] Focused/full tests, typecheck, build, parsing, Biome, and whitespace
      checks pass.
- [ ] No production API, peer range, runtime behavior, or TypeScript 7 change.

## STOP conditions

Stop and report if:

- any supported TypeScript/Vite/runtime combination fails twice;
- WatchProgram cannot terminate without weakening teardown assertions;
- reusing one archive causes a consumer to resolve repository source;
- artifact reuse cannot be bound to the exact source SHA and digest;
- release would no longer depend on all consumers; or
- passing requires a peer-range reduction or runtime fallback.

## Maintenance notes

- Remove experimental-mode matrix rows only in the major release that removes
  those fields.
- Keep Windows coverage focused but path-sensitive; do not replace it with a
  one-time local note.
- Future matrix additions change JSON only; workflow must continue consuming it
  as the sole version/mode source.
