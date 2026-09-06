# Plan 029 verification: reuse canonical dependency paths

Status: COMPLETE — implementation, correctness checks, paired measurement and external review passed. The reviewed five-file change is integrated locally in signed commit `41b536a1293ba8a2b13a3f42c18f6b414334e22c`; its rebuilt distribution matches the tested artifact exactly. No push or release has been made.

Base: `2fd034af84b135122c0bd8e313480b95e48fae82`. The isolated branch is `codex/029-reuse-canonical-dependency-paths`.

## Change and ownership audit

The plugin reuses dependency paths already canonicalized by the backend. It constructs new arrays/Sets for its own state, retains watch ordering/deduplication and existence checks, and keeps normalization at Vite IDs/events, newly inferred missing candidates, TypeScript output and disk boundaries. No realpath cache, new retained index, public option, cache format, watcher lifecycle, ambient dependency selection, or mode change was introduced.

- `legacyBackend.ts` is the sole production backend implementation for all modes. Successful and failed analyses already normalize dependency arrays. Missing compiler candidates normalize before entering the Program-scoped cache. Project membership is canonicalized by `syncFiles`; snapshots copy its ordered Sets.
- `prepareCacheValidation` previously returned the `path.resolve`-only dependency collection. It now canonicalizes its result at the producer boundary, matching normal analysis.
- `collectUnresolvedRelativeDependencies` has one caller: current-revision analysis. Its resolved membership now uses a fresh Set directly; every newly inferred relative candidate still normalizes.
- `watchFiles` has two callers: current analysis, or accepted persistent entries. Both now supply canonical config/dependency/missing-candidate arrays. Its fresh Set+sort, `existsSync`, and watcher/addWatchFile calls are preserved.
- `trackModuleDependencies` handles accepted persistent entries, project-excluded files with undefined dependencies, successful analysis, and failed analysis. Its Set and reverse-index ownership are unchanged.
- Cache acceptance still validates the raw proof, revision, project membership and teardown state. Config/dependency names come from copies of the current validated backend snapshot. The serialized dependency field remains unused. Serialized unresolved candidates retain type/existence rejection and normalize once before use.
- Cache writes copy the already-canonical arrays; proof generation retains all existing normalization/content checks. No cache version change is necessary.
- Fake backends in backend contract/runtime-mode tests use absolute temp/workspace paths and do not introduce raw alias/query strings into internal arrays. Existing canonical/sorted snapshot expectations were retained.

The production diff is confined to `plugin.ts`, `docgen/backend.ts` and `docgen/legacyBackend.ts`. One focused regression was added to `persistentCacheFreshness.test.ts`, plus `.changeset/reuse-canonical-dependency-paths.md`.

## Correctness and negative controls

The new regression runs both stable modes with real backends. It seeds dependent and unrelated components, replaces only serialized missing candidates with junction aliases, accepts a real persistent hit, then creates the type at its physical path. It asserts exact dependent-only HMR and equality with fresh same-path metadata. Temporarily omitting only decoded candidate normalization makes both cases fail by including the unrelated component through the general creation fallback. The candidate was restored in `finally`; the failure log is retained at `.yarn/simplification-evidence/029/disk-alias-negative-control.txt`.

- Focused backend/cache suites: 54/54 pass, 19.88 s.
- Independent root full suite: 339/339 across 13 files, 131.36 s. Its snapshot-only line-ending rewrite was restored; the five frozen files were rechecked.
- TS6 typecheck, source Biome checks, build and package pass.
- Exact artifact compatibility: 10/10 matrix rows pass, plus 26 restart checkpoints and 4 native Vite watcher rows. Separate packed lower-bound native edit/delete/recreate/final verification passes. These records distinguish simulated matrix events from actual native delivery.
- The candidate archive SHA256 is `6dd49e628729c4314c5f32a46533d5b62ecb27231433914757eb323e38d61ce8`; candidate index SHA256 is `921ba5e5038dfc0f8d2c6e32e6e0f61cd5be7891293f442411e318ace6b04263`. See [artifact identity](029-evidence/compatibility/artifact.json) and [compatibility summary](029-evidence/compatibility/summary.json).

The first unbuild attempt could not spawn esbuild under the sandbox; the scoped approved build passed. Local Git clone/identity reads also required scoped child-process permission. These setup failures are not benchmark samples. No dependency versions were changed.

## Workloads and identities

Salt is pinned at `2e1da8e4fbc398b2a7dfffbd357feedf222f7e07`, with 215 non-test TSX targets, 201 metadata files and 221 components. The owned Plan 029 clone has its own `@salt-ds` namespace pointing to its core/icons/styles/window sources. Existing pinned npm packages are reused through junctions; the old Plan 027 consumer remains untouched. Only the already-documented core tsconfig source-path adaptation is applied.

Four untimed actual-Program diagnostics (baseline/candidate × both stable modes) select the owned core config with 401 roots and 1190 Program files, 0 TS errors, correct actual workspace resolution, and StatusIndicator color/size/status metadata. Config, source, lock, dependency and target hashes match Plan 027. Six independently generated Plan 027 path-neutral full metadata oracle summaries are reused with an explicit consumer/artifact location adaptation; they retain their original hashes. Both variants must match all 215 files at every phase.

The shallow control copies the existing three-component real-React fixture to the fixed owned path `C:/Users/Joshu/AppData/Local/Temp/rdt029-react`. It uses the benchmark's exact `retainNativeDisabled` filter, literal enum extraction, and optional-undefined removal, with real React 18.3.1/@types 18.2.25 from the main installation. Four actual-Program diagnostics pass with 4 roots/61 Program files and 0 TS errors. Six fresh-process baseline-artifact oracles cover both modes and the cumulative edits.

An initial shallow diagnostic incorrectly expected default-filtered `onClick` to appear. Actual React resolution and compiler checks were already valid. Before any oracle or sample, the shallow parser options were aligned with the existing benchmark and the assertion changed to disabled+intent. The original diagnostic, log and identity are retained under `.yarn/simplification-evidence/029/audit/initial-shallow-default-filter`. Salt options are unchanged.

[Control verification](029-evidence/controls.json) confirms stable-mode parity for every stage, exactly 7 component-documentation and 33 shared-type metadata changes in Salt, and 1/3 changes in the shallow control. Stale-component, stale-shared and workload-identity negative controls invoke the same actual helpers as the driver.

## Predeclared measurement

Three fresh-process pairs per mode per workload: 12 Salt and 12 shallow processes, each sequential after heavy checks finish. Round order is default AB/ProjectService BA, then default BA/ProjectService AB, then default AB/ProjectService BA. A is baseline, B candidate. Two fixed artifacts share identical consumer/config/dependency paths within each workload. Disk cache is off. No profiles are mixed with samples; Plan 027's existing profiles remain the attribution evidence.

The driver measures plugin creation/configuration plus the first full transform batch, identical-source warm batch, component edit, cumulative shared edit and awaited close. HMR includes the hook and transforms of returned/invalidated targets. Source edits, metadata comparisons and identity checks are outside phase timings. Every phase verifies full semantic metadata. Salt's affected sets remain 215 for both edits; the shallow expected sets are 2/3. This measures direct-plugin CPU/filesystem work; browser rendering and native-event transport are outside the measured phases. Fresh-process cold starts reset plugin/compiler state. The operating-system filesystem cache is not flushed, and the alternating pairs share the same host.

Useful Salt benefit requires at least 10% and 100 ms median reduction in cold and shared-edit cycles in each mode, with all three paired deltas positive. MAD above 20% or conflicting paired direction makes that phase inconclusive. Flag component/session regressions exceeding 10% and 100 ms, or warm regression exceeding 10 ms. The shallow control flags cold/HMR/session regressions exceeding 10% and 20 ms. No sample-budget extension is allowed. All values, medians/MAD and paired deltas will be reported, including inconclusive phases.

Each child has a declared 20-minute timeout. The runner stops on failure without replacement, preserves logs/attempts, and restores only its two owned edit files if a terminated child cannot execute `finally`. Success/failure sample names cannot be overwritten. Frozen workload/artifact identities, per-attempt records and final comparison belong under `029-evidence/`.

## Measured result

All 24 planned samples passed without replacement or budget extension. Both Salt modes satisfy the predeclared useful-benefit rule: cold and shared-edit medians improve by more than 10% and 100 ms, and all three paired deltas are positive. Component and total-session timings also improve in every pair. No regression threshold was triggered in either workload.

Salt medians are seconds; each cell shows baseline → candidate (reduction).

| Mode | Cold batch | Component HMR | Shared-type HMR | Plugin session total |
| --- | --- | --- | --- | --- |
| Legacy | 174.786 → 64.641 (63.0%) | 175.331 → 64.500 (63.2%) | 174.883 → 63.741 (63.6%) | 525.745 → 192.324 (63.4%) |
| ProjectService | 179.240 → 65.916 (63.2%) | 177.422 → 61.834 (65.1%) | 173.384 → 62.557 (63.9%) | 528.422 → 193.701 (63.3%) |

The shallow real-React control has smaller absolute gains. Medians below are milliseconds; all cold/component/shared/session paired deltas are positive.

| Mode | Cold batch | Component HMR | Shared-type HMR | Plugin session total |
| --- | --- | --- | --- | --- |
| Legacy | 1154.193 → 1075.856 (6.8%) | 485.331 → 421.683 (13.1%) | 513.955 → 435.613 (15.2%) | 2159.024 → 1951.937 (9.6%) |
| ProjectService | 1181.701 → 1136.418 (3.8%) | 171.966 → 120.867 (29.7%) | 200.789 → 135.117 (32.7%) | 1571.925 → 1391.431 (11.5%) |

Warm and close phases are inconclusive in all four groups because paired directions conflict; no improvement is claimed for those phases. They do not trigger a declared regression flag. All cold/component/shared/session phase MADs are below the declared 20% threshold. The slower first ProjectService baseline cold sample (280.220 s, versus a 179.240 s median) is retained; no outlier was discarded or replaced.

[Complete raw values, medians/MAD and paired deltas](029-evidence/comparison.json) include every phase. The [Salt attempt ledger](029-evidence/salt-attempts.json) and [shallow attempt ledger](029-evidence/shallow-attempts.json) retain exact row order, timestamps and log hashes; each links its saved per-process log and the individual sample files remain under `029-evidence/samples/`. [Independent root audit](029-evidence/reviewer-audit.json) recomputed the statistics and checked full affected sets/metadata, all log hashes, non-overlap, both restored consumers, the source/harness freeze and both artifacts/archive. Comparison SHA256: `50457d05bc04488c4e0f5767d9ff05c96098f8716b4098745e92a59b09002467`.

Recommendation: retain the small canonical-path reuse change; external review has passed. This experiment demonstrates useful elapsed-time savings without another cache. The approximately 63–65% Salt gains apply to this deeply nested Windows/junction setup and the full conservative dependency graph. The shallow result supports a smaller benefit under shorter paths; it does not establish the gain on another OS, consumer, browser workflow, or storage layout. Salt still reprocesses all 215 targets for both edits; dependency-graph narrowing remains a separate correctness/design decision.

## Reproduction and review

Setup and identity: `setup.mjs`, `freeze-inputs.mjs`, `diagnose-project.mjs`; independent tiny controls: `oracle.mjs`, `verify-controls.mjs`; fixed sampling: `run-samples.mjs shallow`, then `run-samples.mjs salt`; complete reporting: `summarize.mjs`. These scripts are scoped evidence, not changes to the repository's regular benchmark/CI. Run from the Plan 029 worktree. Setup refuses to overwrite frozen artifacts or the owned shallow fixture.

All production and measurement input hashes were frozen before formal sampling. Source review used only the five source/test/Changeset files and scoped context. The user explicitly approved the external review after the initial approval review rejection. The completed Codex review required no source changes.

## External review closeout

The autoreview helper exited 0 using Codex `gpt-5.6-sol` with high reasoning; no fallback was used. Its [structured result](029-evidence/autoreview.json) contains no findings and concludes `patch is correct`. No findings needed acceptance, rejection or a follow-up patch. Review task: `01a07375-74c5-7de3-890a-e67dee71e5ac`.

Command, run from `.yarn/.codex-worktrees/review029/vite-plugin-react-docgen-typescript`:

```powershell
& C:/Python311/python.exe C:/Users/Joshu/.agents/skills/autoreview/scripts/autoreview --mode local --engine codex --prompt-file .yarn/simplification-evidence/029/review-scope.txt --dataset .yarn/simplification-evidence/029/review-context-redacted.md --json-output .yarn/simplification-evidence/029/autoreview.json --output .yarn/simplification-evidence/029/autoreview.txt --stream-engine-output
```

The initial approved helper attempts failed locally before upload. Its isolated Git environment omitted global `core.autocrlf`, causing unrelated line endings to appear in the diff and trigger bundle safeguards. Tracked text line endings were temporarily normalized in the review copy, then all 389 review-only changes were restored after the successful review. The exact five candidate files remained unchanged. A separate scanner false positive matched the numeric lifecycle variable `token`; the supplemental source dataset consistently aliases that identifier to `generation` with an explicit disclosure. The exact Git diff was unredacted. Neither safeguard was disabled. The successful bundle contained 142,190 characters. Reviewer repository-tool attempts were blocked by the helper's intended empty-workspace isolation; the supplied bundle remained its sole repository input and the review completed successfully.

## Main workspace verification and signed integration

After review, the five files were copied into `codex/simplify-changesets-publish` at base `2fd034af84b135122c0bd8e313480b95e48fae82`. All five byte hashes match the [frozen reviewed source](029-evidence/source-freeze.json). Existing unrelated planning and experiment files were preserved.

- TS6 typecheck passed: `node node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json`.
- Package build passed using the installed unbuild CLI from the package directory. All five distribution files match the previously tested package byte for byte; see [distribution hashes](029-evidence/integration-dist.json) and [build log](029-evidence/integration-build.txt).
- The alias regression passed in both stable modes in the main checkout: `node node_modules/vitest/vitest.mjs run packages/vite-plugin-react-docgen-typescript/src/__tests__/persistentCacheFreshness.test.ts -t 'tracks aliased missing candidates restored from disk by physical identity' --exclude '**/.yarn/**' --pool=threads --maxWorkers=2`. Result: 2 passed, 18 skipped, one file; see [focused test log](029-evidence/integration-alias-tests-main.txt). An earlier invocation omitted the worktree exclusion and passed six cases across three worktrees; that separate log is retained without treating it as a main-only run.
- Whitespace validation passed. The previously completed 339-test suite, ten compatibility rows, native watcher checks and 24 samples remain tied to this unchanged source and matching artifact; they were not rerun during integration.

Two configured signed-commit attempts timed out waiting for 1Password authorization, first in the implementation worktree and then in the main workspace. On the user-requested retry, the signed source commit succeeded: `41b536a1293ba8a2b13a3f42c18f6b414334e22c`, parent `2fd034af84b135122c0bd8e313480b95e48fae82`. It contains exactly the five reviewed source/test/Changeset files, with every committed blob matching the frozen SHA256. The GPG signature verifies successfully. Signing settings remain intact and no unsigned commit was made. Verification evidence is recorded separately from the source change. The evidence directory disables Git line-ending conversion so saved SHA256 values remain reproducible from committed files. Raw integration logs retain their original final blank lines; those three log files are excluded from the documentation whitespace check. Existing unrelated planning and experiment files are preserved. See [closeout state](029-evidence/review-closeout.json).
