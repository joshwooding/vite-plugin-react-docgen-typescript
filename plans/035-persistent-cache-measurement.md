# Plan 035: Persistent cache measurement on the optimized runtime

Status: COMPLETE. Measurement, deterministic verification and root independent statistics audit pass; evidence is integrated locally. See [root verification](035-verification.md).

Verdict: **SIMPLIFY_OR_DEPRECATE** under the predeclared Plan024 retention rule. The unchanged optimized runtime produced true persisted hits, but none of the four measured workload/mode groups met both restart-cold benefit thresholds (20% and100ms). Every cache population and restart HMR comparison exceeded both material-regression thresholds (>10% and>10ms). This supports a compatible simplification/deprecation proposal for these measured cases; no runtime change, deprecation, default change or release was made.

## Scope and identity

Measured the unchanged schema2/direct-plugin CLI for large-project scale1 (16 component files) and react-typing scale1 (3), stable legacy (CLI default) and project service (CLI projectService), cache off/populate/restart. Each of60 timed CLI processes ran one measured instance, one mode and one iteration. Five rounds rotated state order. All60 samples passed; no cold/HMR/session MAD exceeded20% of its median, so no extension was justified or executed. No zero denominator occurred.

Environment: Node v24.10.0; win32 10.0.26340 x64. Measured TypeScript 6.0.3; installed typecheck alias typescript6 is separately 6.0.2. Other measured dependencies: Vite8.1.5, react-docgen-typescript2.2.2, React18.3.1, @types/react18.2.25. Base commit `ec7455ac7bf3986610b7f79291dd1acae644beba`.

All five dist files match the accepted033 archive SHA256 `a7aa4620b18c2eebfffbeab4cb623d94f91b4f0371b684b37eacd52ee901dfbe`; index SHA256 `0039755d18125248d78268a266405aded347fa1dfbd8034f2e08e9b5363bb1cb`. Runtime Git content is unchanged since033; the only subsequent src-tree change is034 externalTypeWatch.test.ts. Source-tree byte hashes include that test and exact current checkout line endings. Existing CRLF/LF differences are not treated as production drift. Working-tree and committed input drift checks were empty. All source/build/fixture/manifest/lockfile, selected resolved dependency files, Node executable and six evidence scripts were frozen and checked on every invocation before and after its awaited process lifetime.

See [frozen identity](035-evidence/frozen-identity.json), [root runtime proof](035-evidence/reused-runtime-proof.json), [root readiness](035-evidence/root-readiness.json), and [full capture manifest](035-evidence/capture.json). The26 earlier restart checkpoints, four033 native watcher rows and eight034 native boundary rows apply to the identical production artifact; they were not rerun.

## Timing results

All values are milliseconds, shown as median / median absolute deviation (MAD). Each row contains five retained measured samples. Cold includes configuration plus first batch; warm is same-instance memory reuse; direct HMR excludes the marker write. Session spans construction/configuration through first/warm/HMR and awaited close, including marker write, excluding fixture creation/restoration, cache clearing, process launch and child seeding/validation. These are no claims about cold OS caches or browser/Vite-server latency.

| Scenario | Mode | Cache | n | Cold median / MAD | Warm median / MAD | HMR median / MAD | Session median / MAD |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| large-project | default | off | 5 | 1168.575 / 8.107 | 8.103 / 0.300 | 556.729 / 11.113 | 1734.875 / 9.245 |
| large-project | default | populate | 5 | 1490.302 / 24.463 | 8.056 / 0.403 | 782.449 / 7.249 | 2276.519 / 29.871 |
| large-project | default | restart | 5 | 1591.770 / 51.864 | 8.172 / 0.140 | 917.810 / 10.023 | 2531.073 / 55.871 |
| large-project | projectService | off | 5 | 1272.250 / 24.605 | 13.233 / 0.514 | 304.214 / 11.911 | 1598.146 / 36.902 |
| large-project | projectService | populate | 5 | 1567.069 / 22.237 | 14.331 / 1.245 | 511.633 / 9.076 | 2080.297 / 24.585 |
| large-project | projectService | restart | 5 | 1717.949 / 24.682 | 14.303 / 1.026 | 631.774 / 50.370 | 2364.982 / 128.442 |
| react-typing | default | off | 5 | 1251.884 / 52.173 | 1.701 / 0.091 | 542.816 / 16.518 | 1798.175 / 49.917 |
| react-typing | default | populate | 5 | 1270.591 / 6.389 | 2.005 / 0.274 | 606.445 / 9.065 | 1971.755 / 22.877 |
| react-typing | default | restart | 5 | 1172.209 / 54.138 | 2.161 / 0.212 | 648.934 / 38.239 | 1802.639 / 39.489 |
| react-typing | projectService | off | 5 | 1301.184 / 31.025 | 2.721 / 0.297 | 155.434 / 12.207 | 1474.540 / 26.965 |
| react-typing | projectService | populate | 5 | 1339.738 / 30.757 | 2.419 / 0.126 | 183.922 / 1.987 | 1537.104 / 37.437 |
| react-typing | projectService | restart | 5 | 1221.703 / 9.294 | 2.613 / 0.053 | 252.185 / 7.918 | 1468.806 / 17.561 |

The first-five statistics and final statistics are identical because no extension ran. [Initial summary](035-evidence/initial-summary.json) and [final summary](035-evidence/summary.json) retain full precision, raw sample paths and deterministic variance selection.

## Retention and break-even decision

KEEP requires restart cold saving both>=20% and>=100ms in at least one group, with no population/restart HMR regression exceeding both10% and10ms anywhere. All groups fail the benefit threshold independently, as well as the aggregate HMR guard. Positive cold/session saving means cache restart was faster; positive HMR delta and population overhead mean slower.

| Scenario | Mode | Restart cold saving ms / % | Populate HMR delta ms / % | Restart HMR delta ms / % | Population session overhead ms | Restart session saving ms | Projected restart sessions to break even |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| large-project | default | -423.196 / -36.215 | +225.720 / +40.544 | +361.080 / +64.857 | +541.645 | -796.198 | No demonstrated break-even |
| large-project | projectService | -445.698 / -35.032 | +207.419 / +68.182 | +327.560 / +107.674 | +482.151 | -766.837 | No demonstrated break-even |
| react-typing | default | +79.676 / +6.364 | +63.629 / +11.722 | +106.118 / +19.550 | +173.580 | -4.464 | No demonstrated break-even |
| react-typing | projectService | +79.481 / +6.108 | +28.488 / +18.328 | +96.751 / +62.245 | +62.564 | +5.735 | 11 |

Break-even is ceil(max(0, population session overhead) / positive restart session saving), otherwise no demonstrated break-even. The nominal11-restart value for react-typing/projectService comes from only5.735ms median session saving; that is smaller than the off/restart session MADs (26.965/17.561ms) and is not robust evidence of a practical benefit. Negative deltas are retained. All four per-group eligibleWithinGroup flags are false. Disk persistence may help other workloads; this evidence does not establish universal removal benefit or a Salt-specific result. No paired speedup ratio is inferred against historical024 timings from another artifact.

## Untimed correctness and equal-work controls

Four corrected groups used a separate owned OS-temp fixture root each, matching the unchanged harness topology and exact fixture source hash, tsconfig, parser options, component selection, description markers and React dependency junction. Off, populate, seed, restart and edited-source oracle ran in fresh awaited processes at identical paths within each group. The real unchanged harness exports prepareIteration/measureModeIteration/warmMode drove the controls. Forwarding wrappers observed actual Parser.getComponentInfo calls and all generated docgen assignments; no hook, invalidation result or timed script behavior was repaired. This is direct-plugin proof, not a native watcher claim.

| Scenario / each stable mode | First-batch extraction calls off / populate / restart | Cache entries off / populate / restart (initial→final) | Affected / transformed / invalidated identities |
| --- | ---: | --- | ---: |
| large-project |32 /32 /0 |0→0 /0→16 /16→16 |9 /9 /0 |
| react-typing |6 /6 /0 |0→0 /0→3 /3→3 |2 /2 /0 |

Warm batches added zero extraction calls. Positive persisted file counts were not accepted as hit proof: the separately seeded restart first batch had zero extraction calls, while off/populate and seed extracted positively. Seed metadata equaled fresh off metadata, and each seed PID differed from its restart PID. First/warm/edit semantic maps matched across cache states; all component names/descriptions and every prop name/description/required/type/defaultValue were compared. An independent fresh cache-disabled child extracted the edited source at identical paths; full composed post-edit metadata matched it, the description edit was effective, and untouched components were identical. Actual sorted affected, transformed and invalidated path sets matched across states, including the second dependent React wrapper. No sentinel-only freshness claim is used.

Every observed plugin close was awaited exactly once and the original fixture source hash was restored before the next state. All26 corrected control children exited0, had nonoverlapping lifetimes, matched recorded PIDs and produced no stderr. They comprise12 state measurements, four observed seeds, four fresh edited-source oracles and six compiler-validation children. Corrected controls and their full metadata remain in [controls-results](035-evidence/controls-results.json), [child output directory](035-evidence/controls-os-temp/), [control runner](035-evidence/controls.mjs), and [offline readiness audit](035-evidence/pre-timing-readiness.json). Fixtures remain owned and retained, including junctions; no recursive cleanup traversed dependencies.

The timing matrix separately used 40 additional untimed seed/validation children, recorded in the capture manifest. These are not timing samples. Unique invocation IDs, exact args, spawned/report PID equality, separate within-run seed PID, nonoverlapping CLI lifetimes, stdout/stderr, exits and SHA256 of every raw report are retained. Nonoverlapping OS PID reuse is allowed. No failed, replaced, silently repeated or discarded measured invocation exists.

## Commands, validation and retained setup evidence

Working directory for scripts was the isolated035 worktree; build ran from its package directory. Executable was `C:/nvm4w/nodejs/node.exe`. No install, dependency upgrade, full suite, repeat native matrix or extra timed workload ran.

| Command / check | Exit / result |
| --- | --- |
| git diff --stat ec7455ac7bf3986610b7f79291dd1acae644beba..HEAD -- scripts/benchmark-playground.mjs packages/vite-plugin-react-docgen-typescript/src benchmarks/fixtures package.json yarn.lock |0, empty |
| git diff --stat ec7455ac7bf3986610b7f79291dd1acae644beba -- selected frozen inputs, including package manifest |0, empty |
| node MAIN/node_modules/unbuild/dist/cli.mjs (package cwd, sandbox) |1, esbuild spawn EPERM; retained |
| Identical build with normal subprocess access |0, all five033 dist hashes match |
| node --check plans/035-evidence/{common,freeze,controls,run-matrix,summarize,verify-evidence}.mjs, each separately |0 for all six |
| node plans/035-evidence/freeze.mjs |0 |
| node plans/035-evidence/controls.mjs (corrected OS-temp topology) |0, four groups /26 children |
| node plans/035-evidence/run-matrix.mjs --capture |0,60 measured invocations |
| node scripts/benchmark-playground.mjs --scenario SCENARIO --scale 1 --modes MODE --cache STATE --iterations 1 --output REPORT |0 each; exact actual args retained |
| node plans/035-evidence/verify-evidence.mjs |0, deterministic statistics and seven negative validations |

[Verification](035-evidence/verification.json) independently reloads raw reports to reproduce the saved summary, verifies full input/script/dependency/Node hashes and retained first-five statistics, and rejects wrong cache/scenario identity, stale HMR, a missing sample, unequal affected work, an unjustified variance extension and a duplicate invocation. Root independently reproduced all raw-data statistics, identities, thresholds, global veto and break-even values: [independent statistics audit](035-evidence/independent-statistics.json). No additional timings were needed.

Two setup issues are retained and excluded from measured evidence. An initial shell redirection failed before launching a build because evidence-directory creation used the package cwd; exact owned empty directories and its own .gitattributes were removed nonrecursively ([note](035-evidence/setup-note.txt)). The actual sandbox build then hit esbuild spawn EPERM; the identical scoped normal-access build succeeded ([sandbox log](035-evidence/build-sandbox.txt), [successful build log](035-evidence/build-escalated.txt)). Its pre-existing Browserslist data-age message did not trigger a dependency update.

The first26 untimed control children all passed, but root review identified that their worktree-descendant fixture topology could inherit MAIN node_modules/@types unlike the real OS-temp benchmark. Those results, child outputs, fixture directories and script snapshots remain preserved as setup evidence ([original controls](035-evidence/controls-results-worktree-topology.json), [classification](035-evidence/setup/topology-correction.json)). All four corrected groups were rerun in OS-temp before root readiness and before any measured samples. Original frozen identity before the stronger uncommitted-drift check is also retained. No sampled script or input changed after capture started.

Final identity checks confirmed86 frozen source/build/fixture/manifest files, six scripts,14 selected dependency files and the Node executable unchanged. All six scripts passed syntax checks. Git no-index whitespace checks for those scripts and this new report returned the expected new-file difference exit1 with no diagnostics; the final committed-input drift check returned0 and empty. See [final checks](035-evidence/executor-final-checks.json). The first whitespace audit had assumed exit0 for --no-index; that command expectation was corrected and retained separately without changing any sampled bytes ([note](035-evidence/setup/final-whitespace-command-note.json)).

The optional storage diagnostic was omitted: it would add four extra CLI invocations without resolving the declared latency decision, which already fails every benefit threshold and the HMR guard. Retained memory is unmeasured. Findings are bounded to these two scale1 Windows workloads, the exact artifact/toolchain and direct-hook contract; automatic initially missing external-file discovery remains the separate023 gap. No external review upload, commit, merge, push or publish was performed by the executor.
