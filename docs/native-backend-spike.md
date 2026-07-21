# Native TypeScript 7 docgen feasibility spike

## Verdict

**CONDITIONAL — research is viable; the legacy backend remains the only
production backend and the default.**

The first decisive conditional gate is public-output ordering: both native
versions return the optional union as `"modern" | "pill" | undefined`, while
the shipped legacy contract returns `"pill" | "modern" | undefined`. The
`componentNameResolver` callback is also intentionally unsupported because its
public signature requires legacy TypeScript symbols.

Performance independently prevents a `GO`. Across fourteen paired processes,
the stable native prototype regressed every named metric on both large fixtures
by more than 50% except first-component time, which regressed by 81% and 88%.
This does not become an immediate `NO-GO` because the installed high-level API
has supported bulk overloads for `getSymbolAtLocation`, `getTypeOfSymbol`, and
`getTypeAtLocation`, while the prototype currently sends sequential requests.
The one authorized retry is to vectorize those lookups, batch independent
prop documentation/tag/type work through a per-project scheduler, demonstrate
a material reduction from the current checker-request ledger, and recapture the
same fourteen-pair suite. No public option, peer widening, or native package
dependency is authorized by this result.

## Baseline and isolation

- Roadmap baseline: `ffd553b`.
- Compiler-neutral backend seam completed at `c71e6cd`.
- Legacy imported-type HMR repair completed at `5932a78` before the native HMR
  comparison.
- The spike is private and outside the Yarn workspace at
  `experiments/native-docgen`; it is not reachable from the package build.
- Production remains on `react-docgen-typescript@2.2.2` and supports
  `typescript >=4.3.0 <7`.

The exact experiment aliases are:

| Alias | Version | Role |
|---|---:|---|
| `typescript7` | `7.0.2` | Stable native decision target |
| `typescript7next` | `7.1.0-dev.20260719.1` | Frozen forward-churn probe |
| `typescript6` | `6.0.3` | Legacy direct-extractor control |

## Declared API capability inventory

Both stable and next passed the same real-module probe using only these
declared subpaths:

- `unstable/async`
- `unstable/fs`
- `unstable/ast`
- `unstable/ast/is`

The probe exercised API creation/close, config parsing, snapshots, root and
referenced projects, programs, source files, AST traversal, symbols,
declarations, call signatures, parameter/property types, type strings,
documentation, tags, timing, and the high-level bulk checker calls needed for a
retry. The prototype contains no `unstable/sync`, `unstable/proto`, `.internal`,
generated wire format, `@typescript/native-preview`, or legacy-object facade.

## Correctness evidence

The isolated suite passes 30/30 tests on the exact artifacts.

| Gate | Stable 7.0.2 | Next 7.1 snapshot | Result |
|---|---|---|---|
| In-memory source overlay without disk writes | Pass | Pass | Exact |
| Virtual create/delete and directory visibility | Pass | Pass | Exact |
| Root `files: []` plus composite references | Pass | Core probe pass | Exact required slice |
| Two imported-type edits | Pass | Core probe pass | Fresh on both edits |
| Rapid revision supersession | Pass | Core probe pass | Older work cannot publish |
| Ambient, path alias, package, and symlink identity | Pass | Core probe pass | Canonical physical paths |
| Multiple dependents and unrelated selectivity | Pass | Core probe pass | Exact affected set |
| Dispose during pending work and idempotent teardown | Pass | Pass | All snapshots balanced |
| Real Vite HMR | Pass | Pass | Empty failure ledgers |

The real-Vite matrix covers fake-backend immediate and pending lifecycles,
overlap/disposal, same-file and referenced-project topology, ambient
declarations, path aliases, symlinked packages, and multiple dependents. The
legacy oracle also remains empty across its eight rows after the separate Plan
008 repair.

## Public-contract parity and quality ledger

| Corpus row | Stable | Next | Classification |
|---|---|---|---|
| Imported props and multiple components | Exact | Exact | Must-have pass |
| Rich metadata and enum values | All fields exact except raw/value union order | Same difference | Public ordering gap |
| Local `propFilter` callback | Neutral DTO works | Not required | Supported slice |
| `componentNameResolver` callback | Controlled unsupported diagnostic | Not required | Legacy-symbol contract blocker |

The wider quality corpus records no unclassified regression. Forward-ref casts,
HOCs/factories, `Object.assign` compound components, and polymorphic/default
generic components are intentional prototype improvements. Discriminated
unions, inherited DOM filtering, methods/class components, and namespace/member
imports remain context-dependent/unsupported. The capitalized one-parameter
utility false positive is a legacy defect retained by the prototype rather than
silently changed.

## Performance evidence

Evidence was captured on Node `v24.10.0`, Windows
`win32-10.0.26300`, x64. Raw machine-readable files are outside the repository:

- `C:\Users\Joshu\AppData\Local\Temp\vprdts-native-bench-evidence-20260721\primary`
  (`primary`, global samples 1–7)
- `C:\Users\Joshu\AppData\Local\Temp\vprdts-native-bench-evidence-20260721\variance`
  (`variance`, global samples 8–14)

Each sample is a fresh Vitest process containing all four arms, with first-arm
order alternated by global sample number. Every non-teardown batch contains at
least 250 ms of measured work. Teardown is one positive process-lifecycle
observation per pair because amplifying a sub-millisecond close would launch
thousands of full helper processes and measure retirement backlog. The final
comparator validates manifests, Vitest output, exact environment/backend/API
identities, fixture hashes, request counts, complete pair keys, freshness,
selectivity, memory fields, and timing schema. It exits `2` with
`valid-threshold-failure`; this is valid evidence, not an infrastructure error.

### Large project medians

Times are milliseconds per operation. MAD is shown for the native arm.

| Metric | Current adapter | TS6 direct control | Native stable | Native MAD | Native vs current |
|---|---:|---:|---:|---:|---:|
| Initialization | 284.150 | 0.558 | 467.630 | 12.91% | +64.57% |
| First component | 273.567 | 257.977 | 495.178 | 11.12% | +81.01% |
| Cold batch | 320.653 | 301.254 | 1,184.173 | 9.11% | +269.30% |
| Warm batch | 15.029 | 21.849 | 650.085 | 12.63% | +4,225.63% |
| Two-edit imported refresh | 595.595 | 95.690 | 1,441.399 | 9.64% | +142.01% |
| Teardown diagnostic | 0.008 | 0.105 | 0.438 | 14.45% | +5,475.16% |

### Large design-system medians

| Metric | Current adapter | TS6 direct control | Native stable | Native MAD | Native vs current |
|---|---:|---:|---:|---:|---:|
| Initialization | 273.289 | 0.606 | 477.361 | 7.46% | +74.67% |
| First component | 277.572 | 268.456 | 521.860 | 10.04% | +88.01% |
| Cold batch | 319.314 | 295.012 | 1,618.422 | 4.14% | +406.84% |
| Warm batch | 23.241 | 33.387 | 1,087.374 | 7.29% | +4,578.59% |
| Two-edit imported refresh | 583.473 | 112.554 | 2,269.656 | 5.28% | +288.99% |
| Teardown diagnostic | 0.010 | 0.118 | 0.439 | 14.96% | +4,116.35% |

The native large-project rows made a median 6,363 high-level checker requests
for 147 analyze calls; the large design-system rows made 16,847 for 183. The
TS6 control recorded one program request per analyze call (medians 558 and 576
respectively). This attribution, together with the declared bulk overloads,
supports the batching retry; it does not assert that batching will meet the
threshold.

Median native-row process-tree RSS was 782.1 MiB for the large project and
823.6 MiB for the large design system, including roughly 134 MiB in the active
native helper. The async API closes the helper by ending its input stream but
does not await OS process exit, so retiring native helpers can still appear in
later non-native memory snapshots within a paired process. Process-tree RSS is
therefore retained as the authoritative native observation, but cross-backend
memory deltas are not claimed from this run. Timing order alternation and the
fourteen independent samples remain valid. Residual MAD above 20% after the
prescribed retry occurs only in non-decision playground TS6-control timings and
some sub-millisecond teardown diagnostics; every native large-fixture decision
row is below 15% MAD.

Fixture SHA-256 identities were stable across all arms and samples:

| Scenario | SHA-256 |
|---|---|
| Playground | `ff59db37a88c67d48349f27d59af5df14d4ba390018a3e5af6b0306c218e6fe5` |
| Large project | `10319952c0effbc9f18875ff6b76b3fb6ecbe4e51241b8c50346fd7095a57a7b` |
| Large design system | `336e40721390350790d0662d1dd70a7684705ccf0c4cdc14fc473fa75b44f829` |
| Monorepo shared graph | `b5912ad711a559498e390a84f71c593f7ea7b5f15eae761a1370873a94c51d02` |
| Multi-dependent imported edit | `86e7594a2c818a70771bc966c00ef762e72282c34b286bcad8acfefe541c1657` |

## Publication isolation

The production build succeeded and the actual packed archive at
`C:\Users\Joshu\AppData\Local\Temp\vprdts-native-package-20260721\plugin.tgz`
contains exactly:

1. `CHANGELOG.md`
2. `dist/chunks/fileSelection.mjs`
3. `dist/chunks/typescript.mjs`
4. `dist/index.d.mts`
5. `dist/index.d.ts`
6. `dist/index.mjs`
7. `package.json`
8. `src/__tests__/__fixtures__/AmbientDeclaration.types.d.ts`

Archive-name and extracted-text scans found no experiment path, native backend,
TypeScript 7 alias, unstable API, `tsgo`, helper binary, or native platform
package. The packed manifest contains only the existing production dependencies
and the TypeScript `<7` peer boundary. The package manifest, build config, and
public entry have no semantic diff from the pre-spike surface.

The archive also confirms the separately deferred packaging finding: the
manifest lists `README.md`, but no package-local README is present. That issue
is not caused or changed by this spike.

## Final verification

The completed branch passed:

- immutable dependency installation;
- the TypeScript 6 experiment typecheck;
- 30/30 isolated native spike tests;
- 29/29 unchanged legacy parity and real-Vite HMR oracle tests;
- 208/208 production tests;
- production typecheck and build;
- final comparator validation with exit `2`;
- Biome checks on all 43 changed JavaScript/TypeScript/JSON files;
- forbidden API/import, exact-pin, public-surface, archive, dist, and whitespace
  scans.

## Retry and adoption boundary

A retry must preserve the same stable/next correctness, parity, HMR, teardown,
archive, and fourteen-pair controls, then meet all roadmap thresholds. In
particular, every large metric must be within 15% of the current adapter and the
same winning metric—cold batch or imported-edit refresh—must improve by at least
20% on both large fixtures. The public union-order decision and a truthful
replacement for legacy-symbol callbacks must also be resolved before `GO`.

Until then, do not ship, expose, auto-detect, or document a native backend; do
not widen the TypeScript peer range; and do not inline or remove
`react-docgen-typescript`. The experiment is retained solely as reproducible
research evidence.
