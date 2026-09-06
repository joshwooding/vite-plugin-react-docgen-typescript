# Plan 032: Profile Salt DS after canonical-path reuse

Status: COMPLETE — four post-029 artifact CPU profiles, eight full metadata checks and independent attribution/restoration audit pass. The backend's final dependency-normalization pass was selected and subsequently removed in completed [Plan 033](033-verification.md), integrated at `09039b9`. This investigation itself made no production source changes or installs; its evidence is consolidated during goal closeout. Nothing was pushed or released.

Planned at `eb7a7650a3541d08630ed60d4e684f495123d343`, 2026-09-06. Source checkpoint `41b536a1293ba8a2b13a3f42c18f6b414334e22c` contains the reviewed canonical-path optimization. Depends on completed Plans 027 and 029. Priority P2; effort S; production risk LOW because this stage collects evidence only.

## Question and fixed scope

The earlier profile identified work that Plan 029 has since removed. This investigation asks where the optimized implementation now spends its sampled time, and which remaining work justifies a separately reviewed optimization. It does not rerank backends or add another before/after timing experiment.

Reuse the exact Plan 029 owned Salt checkout, candidate artifact, dependency locations, parser options and six independently checked fresh-process oracle summaries. Salt is pinned at `2e1da8e4fbc398b2a7dfffbd357feedf222f7e07`. Targets are all 215 non-test core TSX files; expected metadata covers 201 files and 221 components. The source graph and paths remain the deeply nested Windows/junction setup from Plan 029. Its default-off disk cache stays disabled in both stable modes.

The actual current main distribution and candidate artifact must match all five recorded build hashes. All five reviewed source hashes, eight inherited harness hashes, complete workload identity and six oracle workload identities must match before and after profiling. The [preflight](032-evidence/preflight-before.json) records these checks. No dependency installation or build is necessary because the tested artifact is unchanged.

## Protocol and ownership

Two fresh processes run sequentially: legacy/default, then ProjectService. Each runs cold, identical-source warm, component-documentation edit, shared-type edit and awaited close. Separate V8 inspector sessions capture only cold and shared-type HMR; component HMR remains an unprofiled correctness step between them. Full metadata must match the appropriate fresh-process oracle at every stage, including warm. Both effective edits must retain exactly 215 affected targets and restore original fixture bytes through nested `finally` blocks.

Cold starts before plugin construction/configuration and ends after all first transforms, with source preloading and plugin import outside that window. A cold guard rejects compiler/parser preloading. Shared HMR includes the actual hook, affected-module accounting and affected transforms. As in Plan 029, those HMR transforms read the affected source files inside the window. Metadata comparisons, edit application, profile serialization and workload identity hashing remain outside the profiles. No real native watcher-delivery transport, browser rendering or full Storybook startup is measured.

The two fixture edits are confined to the existing disposable Plan 029 consumer: the Button disabled-prop description and ValidationStatuses.profilePending addition. No concurrent task may mutate that consumer. All prior evidence and sources remain untouched. Source snapshots and source-hash verification detect incomplete restoration. The parent monitors each process against a 20-minute limit; any failed attempt is preserved and investigated before a retry. Successful profiles are never replaced or extended based on their results.

The new [common wrapper](032-evidence/common.mjs) re-exports frozen Plan 029 helpers, changing only new evidence destinations. The [driver](032-evidence/driver.mjs) adapts the old driver with separate inspector windows and explicit metadata proof records. The [summary](032-evidence/profile-summary.mjs) adapts Plan 027's weighted aggregation to the current candidate artifact URL. Raw profiles remain local under ignored `032-evidence/raw/profiles`; each completed report retains its hash, path and exact phase boundaries. The [protocol](032-evidence/protocol.json) and [harness freeze](032-evidence/harness-freeze.json) were written before profiling.

These are time-delta-weighted self samples and nearest-caller attributions. Self and ancestor percentages overlap and must not be added. Sample shares are diagnostic evidence, not exact causal allocations, statistical elapsed-time savings or proof that a function can safely be removed. The small sample count and Windows/path setup limit generalization.

## Commands and acceptance criteria

From `D:/OSS/vite-plugin-react-docgen-typescript`, with existing Node 24.10.0:

```powershell
node plans/032-evidence/preflight.mjs salt candidate before
node plans/032-evidence/driver.mjs salt candidate default post029
node plans/032-evidence/driver.mjs salt candidate projectService post029
node plans/032-evidence/profile-summary.mjs salt candidate
node plans/032-evidence/preflight.mjs salt candidate after
```

Do not rerun commands against existing successful outputs. Preflight requires exact source/artifact/workload identities; each driver must exit 0 after all four metadata checks and both affected-set checks. Summary requires four hash-verified profiles with matching samples/timeDeltas. Independently recompute the weighted attribution, inspect actual native call chains, and verify restored consumer/source state. Keep the tracked source diff empty. Existing production tests and compatibility matrices need not be repeated for this evidence-only run.

## Results

All two planned processes completed without profile replacement. Four raw profiles are hash-verified. All eight phase checks match the fresh oracle summaries for 215 files, 201 metadata-bearing files and 221 components. Both effective edits still affect exactly all 215 targets in both modes; warm results also match. Consumer sources, config, dependency identities, inherited harness and current source/artifact hashes match before and after the runs. Both compiler-preload guards pass, and the recorded process timestamps do not overlap.

Percentages below are shares of time-delta-weighted samples. The final column includes the backend normalization column; do not add them.

| Mode | Phase | Native realpath within final backend analysis normalization | Native existence checks within watchFiles | All native realpath |
| --- | --- | ---: | ---: | ---: |
| Legacy | Cold | 47.90% | 24.80% | 51.48% |
| Legacy | Shared-type HMR | 48.59% | 24.61% | 52.05% |
| ProjectService | Cold | 46.92% | 24.00% | 50.73% |
| ProjectService | Shared-type HMR | 49.69% | 25.26% | 53.13% |

The dominant chain is native realpath → resolvePhysicalPath → normalizeBoundaryPath → normalizeBoundaryPaths → analyze. The next largest chain is native existsSync → watchFiles → transform. These patterns hold in both cold and shared-edit profiles. This identifies current work worth investigating; it does not predict a 47–50% runtime reduction if a later change is made.

Direct TypeScript self-frame shares range from 4.14% to 7.70%, and parser self frames from 2.46% to 2.71%. These exclude helper work attributed to native/Node frames and are not a complete accounting of compiler or parser cost. They do not justify a TS7/backend migration decision.

The immediately duplicated membership normalization under syncFiles → syncProjectFilesFromProgram is much smaller: approximately 0.21–0.28% in these profiles. Physical resolution from collectUnresolvedRelativeDependencies totals approximately 2.56–2.78%; only a subset of that is the avoidable existing-candidate work identified by source review. Neither is the first priority.

[Full weighted summary](032-evidence/profile-summary.json), [independent audit](032-evidence/independent-audit.json), and [vetted source/harness review](032-evidence/source-findings.json) retain exact values and call chains. The two completed process reports are [legacy](032-evidence/profiles/salt-default-post029-candidate.json) and [ProjectService](032-evidence/profiles/salt-projectService-post029-candidate.json). Logs and individual raw profile hashes are retained. Incidental instrumented durations remain in those records; no medians, backend ranking or new before/after speedup claim is made.

## Recommendations at the profiled checkpoint

The first recommendation below is now completed by Plan 033. All percentages and
source line references describe the post-029 baseline; they are not a new profile
of the final 033 artifact. The remaining dispositions are current in [BACKLOG.md](BACKLOG.md).

1. **Prove and reuse the backend collector's canonical output (M, MED risk).** `legacyBackend.ts:712` accepts direct edges only when they exactly match canonical projectTrackedFiles; `:732` seeds the traversal with an already-normalized entry and shared-ambient names filtered through the same set. The collector returns a fresh sorted Set expansion. Nevertheless, success at `:1505`, errors at `:1540` and cache validation at `:1439` normalize the complete result again. Both callers must retain consistent path identity. First characterize real aliases, transitive imports, selective edit/delete/recreate, reference/config switching and alias retargeting. Then remove this pass only if the producer contract and lifecycle tests establish equivalence. Preserve normalization for raw requests, compiler membership, genuinely new/missing paths and decoded disk inputs. No new cache, index, mode or public API is needed. Validate a candidate with both modes, persistent/error contracts, exact compatibility checks and paired unprofiled Salt plus shallow-control measurements before claiming savings.
2. **Keep watcher existence checks while their lifecycle contract is needed.** This is substantial sampled work, but both accepted disk entries and current analysis can contain missing paths. Existing missing-file registration and native external delete/recreate tests protect this behavior. A retained already-watched set would add state and invalidation obligations. The profiles alone do not establish a safe removal or cache.
3. **Defer dependency-graph narrowing to a design investigation.** Salt's shared module augmentation imports seven prop types through the core barrel; the backend seeds every closure with shared ambient inputs and follows those imports/re-exports. This explains conservative reachability to all 215 targets. The fact that these particular edits change only 7/33 outputs does not establish that the other dependencies are irrelevant to later edits. Any narrowing needs augmentation, globals, merged declarations, re-exports, cycles and consecutive effective-edit characterization, with a conservative fallback. This is a larger, higher-risk effort than testing the remaining canonical-output pass.

The source review additionally found the adjacent membership double pass and existence-before-normalization short-circuit candidate. Their small or only partially attributable cost makes them later options, not reasons to broaden the first patch. No new correctness defect was established by this scoped investigation.

## Independent checks, limitations and retained attempts

A separate read-only reviewer checked the harness against frozen 029 helpers and 027 aggregation. In the first cold profile, every one of the 374 candidate-artifact nodes was correctly classified, including the index and both chunks. Root then independently recomputed all four raw profile sums, self-owner shares and native caller-chain groups in Python; all match the JavaScript summary. The audit also checks exact affected lists, full metadata hashes, process non-overlap, all raw profile hashes, source/artifact equality and fixture restoration. Run `python plans/032-evidence/audit-profiles.py` only when its output does not already exist; successful reports are preserved.

The first audit asserted that every V8 timeDelta was nonnegative. The two cold profiles contain 6 and 8 negative microsecond deltas, totaling only -0.107 ms and -0.158 ms; shared profiles contain none. The initial failure is retained in [audit attempts](032-evidence/audit-attempts.json). Raw profiles and the primary signed-delta summary were left unchanged. A separate sensitivity calculation set only negative deltas to zero: the largest ownership-share change is below 0.0002 percentage points and the two leading owners are unchanged. The source of these small timestamp anomalies was not investigated; no sample was discarded or rerun. A script-generation assertion failed before any profiling began and is recorded in the protocol.

This is a post-change profile of the same deeply nested Windows/junction consumer used for Plan 029. It is not a shallow-path/other-OS replication, a disk-persistence comparison, a native watcher/browser timing test, or a new whole-repository audit. Runtime source and the existing evidence remain unchanged. Source equivalence keeps the prior 339-test/ten-row compatibility evidence applicable; those suites were not rerun for this evidence-only task.
