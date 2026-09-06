# Plan 024: Corrected persistent-cache measurement

**Verdict: SIMPLIFY_OR_DEPRECATE.** On the two measured fixtures, persistence does not meet the predeclared benefit threshold and makes direct-plugin HMR slower in every scenario/mode comparison. Keep persistence disabled by default and prepare a bounded simplification or deprecation plan. This evidence commit changes no runtime behavior, removes no option, and does not announce deprecation.

For the 16-component large-project fixture, a populated-cache restart takes **20.6–21.7% longer** for the cold transform batch than cache disabled. For the three-component fixture with real React declarations, a restart saves **141–161 ms**, but only **10.4–11.7%**, below the required 20%. After restart, the measured HMR cycle takes **23.4–68.4% longer** across the four scenario/mode pairs. These are aggregate benchmark observations; they do not attribute costs to individual functions.

## Evaluated implementation and controls

The isolated worktree is on `codex/024-measure-corrected-persistent-cache`, created from **5f448ec8d596854eace55f59faa669193d187310**. This includes Plan 022's cache-freshness validation and existing external-type watching fixes. The complete runtime, benchmark harness, fixtures, package files and lockfile remain unchanged from that commit. Plan 021's skipped timings and correctness findings remain historical evidence and were not overwritten.

| Input | Observed value |
| --- | --- |
| Node / OS | 24.10.0 / Windows 10.0.26340, x64 |
| Runtime TypeScript / typecheck alias | 6.0.3 / 6.0.2 |
| Vite / react-docgen-typescript | 8.1.5 / 2.2.2 |
| React / @types/react | 18.3.1 / 18.2.25 |
| Plugin package version | 0.8.0 |
| Lockfile SHA-256 | `782c9e80e0789b79ecf721c60b38587fabf1d26eccb636e87471469fd530d9c4` |
| Built index.mjs SHA-256 | `8446e4c027f8f3506117209a857d6d55f30687db40a627351f4ab4f7f9390f5f` |
| Harness SHA-256 | `6a7330f4a949277a5d1eae2ca5b540a4939056d35c6d4e10b2eb58ce5f9203bc` |

The [capture manifest](024-evidence/capture.json) binds the current source, built index, harness and lockfile to the correctness-probe identity before sampling, and checks a combined source/build/fixture fingerprint around every invocation. All before/after fingerprints match. Its source fingerprint is `d702c9ee3bc1c298b306aaec4d41c6f281fcfb5049950a984df1fb83445958be`. The harness uses a different file-tree hashing algorithm: its source fingerprint is `de949667cf8d4bae96a0cc42a6c68742cb7a99fccc099b9cb931f0bcaf1aeb86`, and its complete dist-tree fingerprint is `abdf0b0cfdc30b9916700d30b1c884dc6e525ab1205744bea8bf5702bded80e6`. Each is compared only with values from the same algorithm.

Build and typecheck passed. The advisor ran the full suite independently: **337 tests across 13 files passed**, exit 0, 131.26 seconds. The suite's snapshot status artifact had no content diff and identical normalized HEAD/working blob IDs; only the index entry was refreshed. Existing ancestor dependencies were reused without installation. [controls.json](024-evidence/controls.json) records exact commands and tool-result provenance.

All **26 separate-process restart checkpoints** pass, including new declarations and augmentations, configuration and imported-type edits, unresolved-import creation, configured type-root creation, and equal-size content changes with exactly preserved timestamps. Every changed fixture changes its fresh cache-disabled oracle; cached output equals that oracle. Unchanged controls observe zero extraction calls after restart. See [restart-results.json](024-evidence/restart-results.json) and its [probe](024-evidence/verify-restart-cases.mjs).

All **four real-Vite watcher rows** pass, covering both modes with cache disabled and after validated persistent startup. Each observes one actual external change event and one in-root positive-control event, reaches hot-update hooks, and returns metadata equal to a separate fresh oracle. The probe never manually adds a dependency watch, emits an event, invokes a hot-update hook, or invalidates a module. See [watcher-results.json](024-evidence/watcher-results.json) and its [probe](024-evidence/verify-vite-watcher.mjs). Extraction instrumentation is used only in these correctness probes, never in timed processes.

## Method and bounded sampling

There are **60 timed CLI invocations**, five independent Node processes for each of 12 scenario/mode/cache combinations. Every invocation uses one mode, scale 1 and `--iterations 1`. Modes `default` and `projectService` map to the stable legacy and project-service backends. Cache states are disabled (`off`), initially empty (`populate`), and prepopulated by a separately awaited process at the same fixture paths (`restart`).

The existing schema-2 `scripts/benchmark-playground.mjs` is the only timing engine. Its [runner](024-evidence/run-matrix.mjs) awaits each CLI process sequentially and rotates cache order each round: off/populate/restart, then populate/restart/off, then restart/off/populate. Code/build identity, parser configuration, fixture hash, file count, affected/invalidated module counts, cache entry lifecycle, HMR `updated` status and measured child PID are validated. The React fixture also verifies real inherited `disabled: boolean` and the imported `intent` union, with zero compiler diagnostics in a separate preflight process.

The timing boundaries are:

- **Cold batch:** plugin configuration plus its first transform batch. Node launch, fixture copying, cache clearing and separate-process seed/preflight are excluded.
- **Warm batch:** the same plugin instance transforms the unchanged files through its memory cache.
- **HMR:** after writing its component-description edit, the harness times the plugin hot-update hook and affected transforms until fresh metadata is observed. This is direct-plugin work, not native-watcher delivery or browser latency.
- **Session:** plugin construction/configuration through first batch, warm batch, marker write, direct HMR, metadata validation and awaited close. Fixture restoration and separate seed/preflight processes are excluded.

These are fresh **Node processes on a warmed OS/filesystem cache**, not physical cold-disk measurements. The harness and identity checks read source outside timing; no operating-system cache flush is claimed. No heavyweight advisor/executor verification ran concurrently with the timing matrix.

Before sampling, the rules required median and median absolute deviation (MAD), with exactly one extension to ten samples for all three cache states of any scenario/mode whose cold, HMR or session MAD exceeded 20% of its median. **No group crossed that gate**, so all rows remain at five samples. No sample was discarded or replaced. The deterministic [summary](024-evidence/summary.json) contains full-precision metrics and every raw-report path; [capture.json](024-evidence/capture.json) preserves exact executable/arguments, invocation order, timestamps, child PIDs, stdout/stderr and the control amendment below.

### Recorded PID-guard stop

The first runner incorrectly required measured PIDs to be globally unique. Windows assigned PID 26648 to invocation 15, which finished at 12:52:53.272 UTC, then reused it for invocation 26, which started at 12:53:42.325 UTC. Both were separate `execFile` launches that exited successfully, with one first measured instance and report timestamps inside their distinct lifetimes. Invocation 26 was rejected only by the extra PID-uniqueness assertion.

The advisor independently checked all 26 completed reports and approved replacing that assertion with unique invocation IDs, launch/report PID equality, expected schedule order, and nonoverlapping process lifetimes. The [stopped manifest](024-evidence/capture-pid-guard-stop.json) and [original runner](024-evidence/audit/run-matrix-before-pid-guard.mjs.txt)/[summarizer](024-evidence/audit/summarize-before-pid-guard.mjs.txt) are preserved. The exact-stop-only continuation revalidated every existing report and current fingerprints, retained all 26 raw samples, recorded the original failure and their hashes, then continued at invocation 27. No benchmark invocation was rerun.

The pause between invocation 26's finish and invocation 27's start was **346.865 seconds**. Capture spanned 12:51:45.398–13:02:06.559 UTC on 2026-09-05, including that pause and unmeasured setup/seed work. The interruption is a host-condition limitation of this run; it is not hidden or treated as a reason to replace inconvenient timings. The sampling budget and decision thresholds remained unchanged.

## All timing rows

Values are **median (MAD), milliseconds**, with five process samples per row. `large` is the large-project fixture; `React` is react-typing. Each raw link points to one of that row's five unmodified harness JSON reports.

| Fixture / mode | Cache | Cold | Warm | HMR | Session | Raw samples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| large / default | off | 1662.2 (33.8) | 8.15 (0.12) | 918.3 (7.5) | 2625.1 (47.0) | [1](024-evidence/timings/large-project-default-off-01.json) [2](024-evidence/timings/large-project-default-off-02.json) [3](024-evidence/timings/large-project-default-off-03.json) [4](024-evidence/timings/large-project-default-off-04.json) [5](024-evidence/timings/large-project-default-off-05.json) |
| large / default | populate | 2160.0 (40.4) | 8.20 (0.33) | 1307.2 (52.2) | 3479.4 (78.9) | [1](024-evidence/timings/large-project-default-populate-01.json) [2](024-evidence/timings/large-project-default-populate-02.json) [3](024-evidence/timings/large-project-default-populate-03.json) [4](024-evidence/timings/large-project-default-populate-04.json) [5](024-evidence/timings/large-project-default-populate-05.json) |
| large / default | restart | 2005.4 (35.5) | 8.44 (0.67) | 1413.8 (48.5) | 3397.0 (49.0) | [1](024-evidence/timings/large-project-default-restart-01.json) [2](024-evidence/timings/large-project-default-restart-02.json) [3](024-evidence/timings/large-project-default-restart-03.json) [4](024-evidence/timings/large-project-default-restart-04.json) [5](024-evidence/timings/large-project-default-restart-05.json) |
| large / projectService | off | 1723.3 (36.6) | 12.47 (0.33) | 678.1 (27.7) | 2430.6 (74.5) | [1](024-evidence/timings/large-project-projectService-off-01.json) [2](024-evidence/timings/large-project-projectService-off-02.json) [3](024-evidence/timings/large-project-projectService-off-03.json) [4](024-evidence/timings/large-project-projectService-off-04.json) [5](024-evidence/timings/large-project-projectService-off-05.json) |
| large / projectService | populate | 2207.7 (52.1) | 12.79 (1.06) | 1028.6 (10.4) | 3248.0 (43.8) | [1](024-evidence/timings/large-project-projectService-populate-01.json) [2](024-evidence/timings/large-project-projectService-populate-02.json) [3](024-evidence/timings/large-project-projectService-populate-03.json) [4](024-evidence/timings/large-project-projectService-populate-04.json) [5](024-evidence/timings/large-project-projectService-populate-05.json) |
| large / projectService | restart | 2097.3 (68.2) | 12.72 (0.47) | 1142.2 (25.6) | 3316.0 (64.1) | [1](024-evidence/timings/large-project-projectService-restart-01.json) [2](024-evidence/timings/large-project-projectService-restart-02.json) [3](024-evidence/timings/large-project-projectService-restart-03.json) [4](024-evidence/timings/large-project-projectService-restart-04.json) [5](024-evidence/timings/large-project-projectService-restart-05.json) |
| React / default | off | 1360.8 (19.6) | 1.75 (0.06) | 601.7 (27.7) | 1968.0 (56.7) | [1](024-evidence/timings/react-typing-default-off-01.json) [2](024-evidence/timings/react-typing-default-off-02.json) [3](024-evidence/timings/react-typing-default-off-03.json) [4](024-evidence/timings/react-typing-default-off-04.json) [5](024-evidence/timings/react-typing-default-off-05.json) |
| React / default | populate | 1448.6 (12.1) | 1.68 (0.14) | 664.1 (10.3) | 2107.2 (33.8) | [1](024-evidence/timings/react-typing-default-populate-01.json) [2](024-evidence/timings/react-typing-default-populate-02.json) [3](024-evidence/timings/react-typing-default-populate-03.json) [4](024-evidence/timings/react-typing-default-populate-04.json) [5](024-evidence/timings/react-typing-default-populate-05.json) |
| React / default | restart | 1219.6 (27.6) | 1.68 (0.06) | 742.6 (22.7) | 2003.9 (15.1) | [1](024-evidence/timings/react-typing-default-restart-01.json) [2](024-evidence/timings/react-typing-default-restart-02.json) [3](024-evidence/timings/react-typing-default-restart-03.json) [4](024-evidence/timings/react-typing-default-restart-04.json) [5](024-evidence/timings/react-typing-default-restart-05.json) |
| React / projectService | off | 1381.8 (35.2) | 2.33 (0.02) | 212.2 (6.6) | 1601.1 (27.2) | [1](024-evidence/timings/react-typing-projectService-off-01.json) [2](024-evidence/timings/react-typing-projectService-off-02.json) [3](024-evidence/timings/react-typing-projectService-off-03.json) [4](024-evidence/timings/react-typing-projectService-off-04.json) [5](024-evidence/timings/react-typing-projectService-off-05.json) |
| React / projectService | populate | 1478.0 (31.5) | 2.47 (0.23) | 262.0 (15.1) | 1783.9 (21.5) | [1](024-evidence/timings/react-typing-projectService-populate-01.json) [2](024-evidence/timings/react-typing-projectService-populate-02.json) [3](024-evidence/timings/react-typing-projectService-populate-03.json) [4](024-evidence/timings/react-typing-projectService-populate-04.json) [5](024-evidence/timings/react-typing-projectService-populate-05.json) |
| React / projectService | restart | 1220.3 (16.0) | 2.49 (0.09) | 342.4 (2.0) | 1574.8 (8.4) | [1](024-evidence/timings/react-typing-projectService-restart-01.json) [2](024-evidence/timings/react-typing-projectService-restart-02.json) [3](024-evidence/timings/react-typing-projectService-restart-03.json) [4](024-evidence/timings/react-typing-projectService-restart-04.json) [5](024-evidence/timings/react-typing-projectService-restart-05.json) |

The work counts below are identical across cache states and all five samples. `invalidated` is the fake-server invalidation count, not total affected work; the hook's returned modules still cause the listed affected transforms.

| Fixture / mode | Component files | HMR affected | HMR invalidated | Cache entries off / populate / restart (initial → final) |
| --- | ---: | ---: | ---: | --- |
| large / default | 16 | 9 | 0 | 0 → 0 / 0 → 16 / 16 → 16 |
| large / projectService | 16 | 9 | 0 | 0 → 0 / 0 → 16 / 16 → 16 |
| React / default | 3 | 2 | 0 | 0 → 0 / 0 → 3 / 3 → 3 |
| React / projectService | 3 | 2 | 0 | 0 → 0 / 0 → 3 / 3 → 3 |

## Decision and session costs

KEEP required a restart cold median saving of **both at least 20% and 100 ms** on at least one workload, with no material same-workload HMR regression of **both over 10% and over 10 ms**, assessing populate and restart against off. Freshness is required in the covered scope. None of the four cold comparisons reaches both benefit thresholds. All eight populate/restart HMR comparisons exceed both regression thresholds. Variance does not force an INCONCLUSIVE result.

Positive cold/session savings mean persistence saves time; negative values mean it costs time. Positive HMR deltas mean slower HMR. Calculations use full-precision medians, then round for display.

| Fixture / mode | Restart cold saving ms (%) | Populate HMR delta ms (%) | Restart HMR delta ms (%) | Population session overhead ms | Restart session saving ms | Projected reuse sessions to break even |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| large / default | -343.2 (-20.6%) | +389.0 (+42.4%) | +495.5 (+54.0%) | +854.4 | -771.9 | No demonstrated break-even |
| large / projectService | -374.0 (-21.7%) | +350.5 (+51.7%) | +464.1 (+68.4%) | +817.4 | -885.4 | No demonstrated break-even |
| React / default | +141.3 (+10.4%) | +62.5 (+10.4%) | +140.9 (+23.4%) | +139.2 | -35.9 | No demonstrated break-even |
| React / projectService | +161.5 (+11.7%) | +49.8 (+23.5%) | +130.2 (+61.3%) | +182.8 | +26.3 | 7 |

Population overhead is `median(populate session) - median(off session)`. Restart session saving is `median(off session) - median(restart session)`. For a positive saving, projected reuse sessions are `ceil(max(0, population overhead) / restart session saving)`; otherwise no break-even is demonstrated. The seven-session value is a projection from a fixed workload, not a measured repeated-session sequence, and it does not satisfy the independent cold/HMR KEEP requirements.

Four separate **untimed storage diagnostics** ran after the matrix, each using restart plus `--keep-temp`. They await close, inspect only the cache directory, validate the exact temporary-root containment/prefix, unlink the fixture's node_modules junction itself, and remove only that verified fixture. Their timing fields never enter the matrix statistics. See [storage.json](024-evidence/storage.json).

| Fixture / mode | Cache bytes | Cache files / JSON entries |
| --- | ---: | ---: |
| large / default | 221834 | 16 / 16 |
| large / projectService | 221834 | 16 / 16 |
| React / default | 23259 | 3 / 3 |
| React / projectService | 23259 | 3 / 3 |

These byte counts describe disk files, not allocation size or retained memory. **Retained memory is unmeasured.**

## Limits and next bounded action

The scenario named large-project has only 16 component files at scale 1; the React fixture has three components with real installed React declarations. The result is specific to these workloads, this Windows host/toolchain, five samples per row, warmed filesystem state and the disclosed pause. It is not a claim about every consumer repository, operating system, compiler version, browser or long-running editing sequence.

Plan 023 remains separate: initially missing external type files created after startup can lack watcher events with cache disabled or enabled. These timings cover the existing-file/restart workflows that Plan 022 verifies. They do not claim that absent-file creation is fixed. Watcher readiness and deletion/recreation evidence includes registration grace and does not guarantee immediate recreation during registration.

The next implementation proposal should target the **persistent filesystem cache's complexity**: document this result, keep the opt-in default off, and define a compatible simplification/deprecation path before removing a supported option. Preserve the correctness fixes while persistence exists; this measurement provides no basis to restore stale-hit shortcuts. Additional cache layers or special fast paths need a concrete consumer workload that demonstrates enough benefit to offset both validation and edit-cycle cost. No broader watcher behavior or default backend change is justified by this decision alone.

## Reproduction and evidence validation

To reproduce the experiment, create a fresh worktree from the evaluated commit with the repository basename preserved, copy only the six `.mjs` files from `plans/024-evidence` into the equivalent directory, and use the dependency versions above. Existing generated evidence is intentionally not overwritten by `--capture`.

Run the build in `packages/vite-plugin-react-docgen-typescript`, then run these commands from the worktree root. Use the installed ancestor tool paths recorded in [controls.json](024-evidence/controls.json) for build, typecheck and full-suite validation before timing.

```text
node plans/024-evidence/verify-restart-cases.mjs
node plans/024-evidence/verify-vite-watcher.mjs
node plans/024-evidence/run-matrix.mjs --capture
node plans/024-evidence/run-matrix.mjs --storage
node plans/024-evidence/summarize.mjs
node plans/024-evidence/verify-evidence.mjs
```

The original invocation shape is `node scripts/benchmark-playground.mjs --scenario SCENARIO --scale 1 --modes MODE --cache STATE --iterations 1 --output REPORT`; its full absolute arguments are retained for every process. `--resume-pid-guard` is a one-off audit recovery for the preserved exact stop, not general failed-run recovery.

The [deterministic validator](024-evidence/verify-evidence.mjs) reproduces the saved summary from all raw reports and rejects wrong cache state, mismatched scenario identity, stale HMR, missing samples, unjustified extensions and duplicate invocation IDs. It also checks that all pre-pause invocation records and raw-report hashes are preserved. Hash verification tolerates Git's CRLF checkout conversion by reading it as the original LF; raw reports and recorded hashes remain untouched. Synthetic CRLF content passes, while a data-byte mutation still changes the hash. It passed, as did syntax checks for all six evidence scripts and `git diff --check`.

The advisor independently recomputed all 12 rows' median/MAD values, four cold and session comparisons, break-even values and the verdict using a separate inline program. It also ran two fresh React/default CLI controls (off and separately seeded restart), validated fresh metadata and equal affected work, and kept those reports outside the matrix. Independent typecheck and rebuild passed; the rebuilt dist/source/fixture fingerprint still matched capture exactly. All four storage diagnostics were independently validated, including removal of their temporary roots. These checks add validation, not extra statistical samples.
