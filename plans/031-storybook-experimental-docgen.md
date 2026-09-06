# Storybook experimental docgen comparison

Status: DONE — cold comparisons and independent audit complete; shared-type
freshness failure reproduced in the worker and live feature server. The failure
remains unresolved. Evidence only. No production plugin or dependency change.

## Findings

The published experimental server produces the expected cold metadata on this
fixture, but does not win the full-fixture extraction comparison. The primary
comparison below uses concurrent worker requests, matching the service's
`extractAllDocgen` fan-out. Each engine ran in three fresh processes, in rotating
order, with the same 188-component / seven-project fixture.

| Engine | Compiler | Median cold extraction, including engine initialization | MAD |
| --- | --- | ---: | ---: |
| Existing plugin prototype, project-service | TS6 6.0.3 | 2,184.958 ms | 24.432 ms |
| Existing plugin prototype, native | TS7 7.1.0-dev.20260905.1 | 1,259.560 ms | 10.034 ms |
| Storybook 10.6.0 experimental docgen worker, bulk requests | TS6 6.0.3 | 2,591.053 ms | 12.159 ms |

Storybook took 18.59% longer than the TS6 prototype and 2.06 times the native
prototype's time. The ordering held in each of the three rounds. This is a small
synthetic extraction comparison, not a Storybook startup/browser benchmark or a
comparison with the Plan 029 optimized plugin. Storybook's server-side architecture
can still improve preview startup by moving work out of the preview bundle; that
benefit is not measured here.

| Round | TS6 prototype ms | Native prototype ms | Storybook bulk ms |
| --- | ---: | ---: | ---: |
| 1 | 2,257.521 | 1,259.560 | 2,605.280 |
| 2 | 2,160.526 | 1,249.525 | 2,591.053 |
| 3 | 2,184.958 | 1,278.491 | 2,578.893 |

All 188 complete normalized component records matched the independent 030 oracle
on every cold run, including descriptions, required flags, defaults and enum
values. Storybook's ArgTypes were additionally checked for those fields. All
compiler versions, recorded artifact/harness hashes, output hashes, order and
summary arithmetic passed the independent audit.

**Shared-type edits failed correctness.** After changing an imported shared prop
from revision 001 to 002 in a running Storybook, the actual docgen service still
returned revision 001 after two and five seconds, including explicit re-extraction.
The story and component had been loaded through Vite. This needs a focused upstream
reproduction/investigation before relying on this path for equivalent live metadata
updates. No stale-response timings are presented as improvements, and no upstream
issue was sent.

Evidence: [bulk results](031-evidence/bulk-comparison.json),
[audit](031-evidence/audit.json), [live-server check](031-evidence/server-freshness.json),
[server log](031-evidence/server-attempt2.log). Full original payloads remain under
`.yarn/simplification-evidence/031/`. The temporary localhost server was stopped.

The first nine runs used sequential worker requests and are retained separately:
TS6 / native / Storybook medians were 2,176.709 / 1,245.747 / 2,641.731 ms. After
inspecting the service's bulk-request implementation, a second bounded nine-run
protocol was declared before measuring that path. None of the first samples were
replaced, pooled with the second protocol, or concealed. All 18 cold runs passed
the output audit. See [initial results](031-evidence/cold-comparison.json) and
[bulk protocol declaration](031-evidence/bulk-protocol.json).

## Scope and preflight

Use the published **Storybook / @storybook/react / @storybook/react-vite 10.6.0**
implementation of `features.experimentalDocgenServer`, installed separately with
**TypeScript 6.0.3**. The compiler version is deliberate: this provider imports the
legacy compiler API. See [the feature documentation](https://storybook.js.org/docs/api/main-config/main-config-features#experimentaldocgenserver).

Use the same 188-component, seven-project synthetic fixture and unchanged native
prototype artifact as 030, copied into an owned 031 directory. Shared types are
reset to revision 000 before every run. The fixture's React type roots remain
pinned to the original @types/react 18.2.25. This is not Salt DS.

The first published-worker extraction returned correct component metadata and
ArgTypes. A standalone worker then returned stale shared-type metadata after an
edit. A real Storybook dev server with the feature enabled reproduced the problem:
after loading the story/component through Vite and changing shared revision 001
to 002, both cached metadata and explicit service re-extraction returned 001 after
two and five seconds. See `031-evidence/server-freshness.json`. The server used
Storybook's ordinary service and worker; a local diagnostic Vite middleware called
its extraction command/read query. No Storybook package code was modified.

Do not count those fast stale responses as edit performance. HMR comparison is
correctness-blocked for this shared-type case; only cold extraction was timed.
This is one synthetic case on Windows, not a claim about every Storybook project.

Setup attempts are retained: the initial diagnostic config imported a registry
helper from the wrong public export, and an initial query used an incorrect
component id. Corrected private-registry import and actual indexed id allowed the
live-server check. Those setup errors are not attributed to Storybook performance.

## Initial cold measurement protocol (declared before formal sampling)

Three rounds, three engines, nine fresh child processes total. Rotate the order
each round: TS6 project-service / native nightly / Storybook, then native /
Storybook / TS6, then Storybook / TS6 / native. Run sequentially, timeout 120 s per
process, no replacement or extension. Stop on failure and retain every attempt.
The live dev server is stopped before timing. Do not flush OS file caches.

Measure engine import/initialization plus extraction and normalization of all 188
component records. Storybook runs its actual published core worker thread and
React provider, including CSF resolution, metadata and ArgTypes generation. The
plugin lanes run the unchanged 030 artifact's Vite transform hooks with its old
mock module graph and existing diagnostic instrumentation. Exclude Node process
startup, fixture reset, and full Storybook/Vite startup. This compares the cost of
obtaining all fixture metadata through these respective paths, not total Storybook
startup, browser responsiveness, or pure compiler performance. Server-side lazy
extraction may benefit first render without being fastest at extracting everything.

Require nonempty output, all 188 components, all four expected properties, correct
revision, descriptions, required flags, defaults and normalized types. Compare
every run's complete normalized output to 030's independently checked oracle with
the shared revision reset to 000. Retain original Storybook payloads (including
ArgTypes) and plugin outputs alongside the comparison. Report medians, raw values,
median absolute deviations and per-round differences; three samples are a bounded
diagnostic check, not a broad performance guarantee.
