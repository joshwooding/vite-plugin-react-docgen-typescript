# TypeScript nightly docgen timing check

Status: DONE — current-nightly native prototype smoke, eight repeated docgen
processes, and independent evidence audit passed. Evidence only; no production compiler, plugin, dependency, or
configuration migration is part of this check.

## Results

Installed `typescript@next` separately, pinned to **7.1.0-dev.20260905.1**.
Four counterbalanced pairs on 188 synthetic components / seven projects give:

| Measurement | TS6 6.0.3 project-service | TS7 nightly native | Reduction |
| --- | ---: | ---: | ---: |
| Median cold total | 2,376.855 ms | 1,334.201 ms | 43.87% |
| Median per-process mean shared-type edit | 693.351 ms | 411.329 ms | 40.68% |
| Median retained RSS after cold extraction, including native child | 318.006 MiB | 206.740 MiB | 34.99% |

Every pair favored the nightly backend for cold total and mean edit time. All
eight raw child outputs match exactly after normalization: 188 components, each
with four expected properties and the final shared revision. The original harness
also passed cold/freshness checks, full affected-component counts on all 24 edits,
and structured-versus-generated output checks. This establishes the tested
fixture's output agreement, not complete native-backend compatibility.

| Pair / backend order | TS6 cold ms | Nightly cold ms | TS6 mean edit ms | Nightly mean edit ms |
| --- | ---: | ---: | ---: | ---: |
| 1 / TS6, nightly | 2,407.488 | 1,313.123 | 646.330 | 410.840 |
| 2 / nightly, TS6 | 2,441.765 | 1,335.451 | 719.687 | 411.817 |
| 3 / TS6, nightly | 2,307.732 | 1,332.950 | 692.715 | 414.571 |
| 4 / nightly, TS6 | 2,346.222 | 1,354.022 | 693.986 | 360.527 |

Cold median absolute deviations were 47.771 / 10.536 ms (TS6 / nightly); mean-edit
MADs were 13.486 / 1.865 ms. No process was replaced or excluded. The smoke run was
excluded as declared. Windows x64, Node 24.10.0, Intel i9-9980HK, 16 logical CPUs.
Cold total includes module load, setup and extraction, but excludes Node process
startup. Edits are shared-type invalidation plus all affected transforms, not
live-browser HMR latency. Do not compare these values directly with Salt DS or
Plan 029 results: this measures an older prototype with different extractors.

Raw aggregate: [`native-188x7.json`](030-evidence/native-188x7.json).
Independent audit and all individual values:
[`native-audit.json`](030-evidence/native-audit.json), produced by
[`audit-native.cjs`](030-evidence/audit-native.cjs). The audit checks all eight
preserved child files, compiler versions/resolution, native executable identity,
artifact and harness hashes, execution order, final output equality and arithmetic.
The generated workspace and process log are retained. No production source,
package manifest, or root lockfile was changed.

## Current scope (user clarification)

The requested compiler is `typescript@next`, resolved from npm on 2026-09-05 to
**7.1.0-dev.20260905.1** and installed in an isolated ignored runtime. The main
package and lockfile are unchanged. See `030-evidence/next-resolution.json`.

The current plugin uses the legacy compiler API. The nightly root export contains
only version information, but the existing experimental native backend can use
its `unstable/sync` API. Snapshot the existing compiled prototype from checkout
`5b496e9484dc6cc4eca9734ff8a732b063686795`; this is an existing artifact, not a
freshly reproduced build or the Plan 029 candidate. Hashes and paths are recorded
in `030-evidence/native-artifact.json`. Only the snapshot's `typescript7next`
resolution points at today's nightly; the original checkout stays unchanged.

A one-component, one-project smoke test completed on both TypeScript 6.0.3
project-service and the native nightly. Its normalized final docgen output matched
exactly and its shared-type edit was observed. The smoke is excluded from repeated
measurement; see `030-evidence/native-smoke.json`.

Before repeated sampling: use the prototype's existing backend benchmark on
188 generated components across seven referenced projects, three shared-type
edits per process, and four runs per backend (eight fresh child processes total).
Run serially with TS6/native order alternating each pair, preserving raw child
outputs and generated fixture. Do not flush the OS file cache. Use identical
artifact, fixture and options for both backends. Enable the harness's required
normalized output parity check; its per-edit checks require full invalidation and
updated shared-property descriptions, but cross-backend field parity is checked
on final output. Independently compare final output digests across all eight runs.

Report raw values, medians and paired differences for cold total (module load +
setup + extraction), and the mean of the three shared-type edits in each process.
Do not interpret three edits as independent fresh-process runs. Native diagnostic
timing collection is enabled by this older harness; request profiling is disabled.
The fixture is synthetic, not Salt DS, and the HMR hooks use a mock module graph,
not a live Vite browser. These results cannot establish a speedup for Plan 029 or
a pure compiler-only speedup: the two modes also use different extractors/APIs.

## Superseded CLI setup (no formal samples taken)

The following was the initial setup before the user clarified that the requested
comparison was the current nightly. It was stopped before formal CLI sampling;
its preflight outputs and helper are retained as evidence. The TS6 and TS7 negative
controls both produced the expected TS2322 diagnostic, but exited with 2 and 1
respectively. The helper incorrectly required exit 2 for both and stopped. Do not
treat that assertion failure as a compiler failure or as a timing result.

Original, superseded protocol:

Use the installed TypeScript 6.0.3 and TypeScript 7.0.2 CLIs on the same restored
Salt core and small real-React consumers used by Plan 029. Invoke each through its
published Node CLI entry point. Measure complete fresh-process wall time for
`--noEmit --incremental false --pretty false --noCheck false --project CONFIG`.
Native parallelism remains at its default. This measures typechecking, not docgen,
HMR, browser behavior, emit, or an incremental build. The operating-system file
cache is not flushed.

Before sampling, require successful semantic-check diagnostics, matching root
inputs and non-compiler file inventories, and a deliberate type-error control for
both compilers. Record bundled standard-library differences separately. Freeze
the consumer/config/input and compiler identities and preserve every output.

Predeclared sample budget: five pairs per workload, twenty processes total, one
process at a time. Odd rounds run TS6 then TS7 for Salt and TS7 then TS6 for the
small control; even rounds reverse those orders. Do not replace samples or extend
the budget. A failed or timed-out process stops sampling and remains recorded.
Per-process timeout: 120 seconds. Report all values, medians, median absolute
deviations and paired differences. Mixed paired direction or MAD above 20% of a
median makes a timing comparison inconclusive.

The installed TS7 root export exposes only version information, while the plugin
and react-docgen-typescript require the JavaScript compiler API. Microsoft states
that TS7.0 does not ship the supported API and describes side-by-side TS6 use for
API consumers in its [TypeScript 7 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).
These CLI measurements cannot establish a TS7 speedup for this plugin.
