# Plan 036: current trunk versus the reviewed performance stack

Status: measured comparison and independent correctness audit PASS. The protocol
was frozen before the smoke and measured runs; all planned samples completed.

The user authorized a fresh trunk comparison, signed pushes, and reuse of the
existing pull requests. The agreed stack is #87 for the benchmark foundation,
a new performance PR based on #87, then the existing #86 for TypeScript 7.
This work does not merge a pull request or publish a package.

## Frozen comparison

Trunk is fetched `origin/main` at `c3767eeb910d1602e966905da626141b90046d22`.
The performance candidate is `ea077567e23ccde17e8742c2a9f1559ffabe91c0`, a signed
merge of the reviewed local performance work with #87's exact head
`841a9ad002ae851e7c975302ada385f9911c8cd9`. Its package source and built runtime
are unchanged by the merge. The packed candidate is byte-identical to the
accepted Plan 026 Stage A archive; see
[integration verification](036-evidence/performance-stack-verification.json).

Both revisions were built with the same existing dependency installation.
Actual resolved versions are Node 24.10.0, TypeScript 6.0.3,
react-docgen-typescript 2.2.2, React 18.3.1, @types/react 18.2.25, Vite 8.1.5,
and glob 13.0.6. Dependency paths, package hashes, loaded-source hashes,
archive members, and harness identity are in the
[frozen protocol](036-evidence/protocol.json) and
[environment record](036-evidence/environment.json).

The unchanged #87 harness generates one 188-component, seven-project fixture.
It runs trunk/default, trunk/ProjectService, performance/default, and
performance/ProjectService in four rotating rounds. Each lane occupies each
position once. Every child starts a new Node process, performs cold extraction
and ten shared-type edits, then closes before the next child. Disk persistence
is disabled. A prior ten-component smoke is excluded from the statistics.

The primary metrics are cold total time and each process's median edit time.
The analysis uses four independent process samples per lane, with arithmetic
midpoint medians and unscaled MAD. The ten edits inside each process are
correlated. Improvement is called consistent only if all four paired rounds
favor the candidate and both variants' MAD is at most 20% of their median.
Otherwise the result is inconclusive. There is no variance extension, discarded
successful sample, speedup threshold, or p-value.

## Correctness and limits

The unchanged harness rejects incomplete/stale revision descriptions after cold
extraction and every edit, and requires every generated component to be affected.
The independent [audit script](036-evidence/analyze-measured.py) read all
16 retained child results, compared every normalized final component and prop
record with the expected fixture, verified digests and order, and retained the raw
child files. All checks passed. Intermediate full metadata is not retained, so this does not claim
an independent fresh oracle for every phase.

These are Windows direct-plugin measurements with a generated shared-type
fan-out workload. Cold includes module load, configuration and first transforms;
edit time includes the source write/read, hook, transforms and metadata decode.
OS caches may be warm, and memory sampling overhead is present in both variants.
Source inspection and small edits in the separate TS7 worktree continue during
measurement; no builds, test suites, installs or heavy checkout operations run
concurrently. Other host activity is not controlled. The comparison makes no
claim about browser latency, TypeScript 7, or total Salt/Storybook speedup.

The earlier per-change Salt measurements and persistence studies retain their
original scope and bytes. Their incremental ratios are not multiplied into a
claimed trunk-to-stack improvement.

## Results

| Mode | Metric | Trunk median ± MAD | Performance median ± MAD | Reduction | Paired rule |
| --- | --- | ---: | ---: | ---: | --- |
| default | coldMs | 24973.7 ± 1557.8 ms | 4467.3 ± 297.4 ms | 82.1% | CONSISTENT_IMPROVEMENT |
| default | editMedianMs | 24347.9 ± 1589.0 ms | 3359.5 ± 262.7 ms | 86.2% | CONSISTENT_IMPROVEMENT |
| projectService | coldMs | 26494.9 ± 1297.3 ms | 6119.7 ± 675.0 ms | 76.9% | CONSISTENT_IMPROVEMENT |
| projectService | editMedianMs | 24226.1 ± 840.8 ms | 3878.4 ± 529.8 ms | 84.0% | CONSISTENT_IMPROVEMENT |

All four paired rounds favor the performance candidate for both primary metrics
in both stable modes, and each MAD satisfies the frozen 20% rule. These results
support this workload only. Raw process results, phase assertions, complete final
outputs and the audit are retained in [036-evidence](036-evidence).

Memory is a tradeoff, not a blanket improvement. Post-edit median retained RSS
rose from 293.2 to 665.1 MiB in default mode (+126.8%), and from 243.3 to
433.6 MiB in ProjectService (+78.2%). Median post-edit retained JavaScript heap
was slightly lower (109.8 to 108.2 MiB and 127.5 to 125.9 MiB respectively).
Peak RSS was 865.3 to 701.3 MiB for default, and 397.6 to 434.8 MiB for
ProjectService. RSS includes allocator/OS behavior and does not alone establish
a live-object leak; no memory release gate was frozen. See
[memory diagnostics](036-evidence/memory-diagnostics.json).

## Delivery verification

The combined performance source passed all 347 tests across 14 files using
Vitest with two workers (the local resource limit), plus the existing build and
typecheck. The full Biome CI command passes after excluding immutable plan
evidence, generated `.yarn` workspaces and build output. Historical evidence is
kept byte-for-byte. Formatting converted checked-out source CRLF to LF; Git
confirms no package, test, fixture or harness source blob changed. The exact
measured CRLF harness files are retained in `036-evidence/frozen-harness/` and
match the frozen protocol. Measurement input hashes passed before formatting.
The sole tracked readiness configuration change is `biome.json`.

CI fixture checks and remote stack readiness are recorded in a separate delivery
record so that the measured protocol and outputs remain unchanged.
