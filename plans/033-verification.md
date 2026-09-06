# Plan 033 verification: reuse backend canonical dependency output

Status: COMPLETE — source correctness, exact-artifact compatibility, all 24 predeclared samples and independent audit pass. External review returned no findings. The three reviewed files are integrated and verified at unsigned local source commit `09039b9f32bab728b2418b24e74636f93703b998`, explicitly authorized by the user.

Base: `eb7a7650a3541d08630ed60d4e684f495123d343`. Candidate implementation was developed on `codex/033-reuse-backend-canonical-dependencies`. The exact three-file source change is committed on `codex/simplify-changesets-publish`; its parent is the planned base. No push, release, dependency upgrade or public API/default change is part of this work.

## Change and canonical contract

The patch removes three whole-array normalization passes from backend success, caught-error and persistent-validation results. The dependency collector receives a normalized entry; ambient seeds and direct edges must match canonical project membership. Its own Set returns a fresh sorted array. The real compiler, request, membership and missing-path boundaries still normalize inputs. No new cache or watcher state is introduced.

The new test file characterizes both stable modes on the unchanged baseline before implementation. Real filesystem aliases, transitive diamond imports and an unrelated component exercise exact physical dependency arrays, edits, deletion/recreation, config-path and ambient selection resets, controlled parser failure/recovery, current-revision validation and fresh array ownership. Full metadata and dependency results match a freshly constructed backend at each relevant phase. Live alias retargeting without a corresponding update/reset is not claimed.

Only `legacyBackend.ts`, `backendCanonicalDependencies.test.ts` and one patch Changeset change. Root read the complete diff, new tests and adjacent ownership paths. See the [provenance audit](033-evidence/implementation/provenance-audit.md) and [executor verification](033-evidence/implementation-verification.md).

## Correctness and artifact

- Four new baseline characterization cases passed before changing production code.
- Candidate full suite: **343 tests / 14 files passed**. Independent root focused run: **78 tests / 3 files passed**, 42.13s.
- TS6 typecheck, scoped Biome, package build, Yarn pack and whitespace checks passed. All five archived distribution files match the built output.
- Exact-artifact compatibility: **10/10 matrix equivalents passed**, covering TypeScript 4.3–6, Vite 3–8 and Windows/Ubuntu 22.04 under WSL2. These are 72 mode/topology combinations, 144 type-edit and 216 dynamic-membership checks, with zero watcher handles. Matrix events are simulated through real Vite listeners; native delivery is checked separately.
- **26 persistent-restart checkpoints passed**, including current membership, ambient/config changes, missing-import creation, preserved mtime/size and deletion/recreation. Cache-hit outputs equal same-path fresh-process outputs.
- **Four real Vite watcher rows passed**, covering both stable modes with fresh and validated-persistent startup. A separate packed lower-bound Windows probe passes native edit/delete/recreate/final delivery, exact dependent-only updates and shutdown.
- **Eight actual-Program diagnostics passed** across both artifacts, workloads and stable modes. Salt has 401 roots, 1190 Program files, correct real workspace resolution and zero TS errors; the shallow fixture has 4 roots and zero TS errors.

Archive SHA256: `a7aa4620b18c2eebfffbeab4cb623d94f91b4f0371b684b37eacd52ee901dfbe`. Distribution index SHA256: `0039755d18125248d78268a266405aded347fa1dfbd8034f2e08e9b5363bb1cb`. Full hashes are in the [artifact manifest](033-evidence/compatibility/artifact.json), [source freeze](033-evidence/source-freeze.json) and [compatibility summary](033-evidence/compatibility/summary.json).

The initial executor CRLF lint and sandbox esbuild attempts are retained with their successful corrections. Main artifact preparation initially compared historical CRLF matrix bytes with the current LF checkout; exact normalized bytes and parsed contents agree. The first WSL compatibility attempt inherited Windows npm and failed before plugin verification. Its saved attempt is followed by successful rows using the existing Linux Node/npm PATH. An initial controls invocation omitted required common-module CLI arguments; the corrected command passes. None of these setup attempts is a performance sample. No successful timing sample may be dropped or replaced.

## Predeclared comparison

The baseline is the exact reviewed Plan029 candidate archive, SHA256 `6dd49e628729c4314c5f32a46533d5b62ecb27231433914757eb323e38d61ce8`. The new candidate is compared on the same owned Salt and shallow consumer paths, dependency locations, compiler, source/config, parser options and target lists. All 12 full semantic oracle files retain their original bytes; both workload identities exactly match frozen029. Disk cache is off.

The fixed budget is 24 sequential fresh processes: three counterbalanced pairs per stable mode per workload, shallow first. Round order is legacy AB/ProjectService BA, legacy BA/ProjectService AB, legacy AB/ProjectService BA. Cold, unchanged warm, component HMR, cumulative shared HMR and awaited close are measured. Every phase checks full metadata; HMR records complete affected lists (Salt215/215, shallow2/3). Source writes, semantic comparisons and added proof serialization remain outside phase timing. HMR source reads remain inside timing, inherited from029. Heavy correctness checks ended before sampling.

Useful Salt benefit requires at least 10% and 100 ms median cold/shared reduction in each mode, with all three paired directions positive. MAD above 20% or mixed paired direction makes a phase inconclusive. Salt component/session regression above 10% and 100 ms, or warm regression above 10 ms, is flagged. Shallow cold/HMR/session regression above 10% and 20 ms is flagged. No variance extension, successful-sample replacement or oracle adjustment is allowed. Each child has a 20-minute timeout with guarded restoration of only its owned edits.

The [pre-sampling freeze](033-evidence/measurement-freeze.json) records 23 fixed inputs and the completed correctness checks. A separate read-only harness audit confirmed the intended adaptation: evidence destinations and post-timing metadata proof records only. The [independent Python audit](033-evidence/independent-audit.json) passes: it recomputed all statistics, inspected all 96 phase summaries and 48 exact affected lists, and checked logs, process order and source/artifact hashes. The actual identity helper separately verifies all four [restored workload/artifact identities](033-evidence/restored-inputs.json). Direct-plugin Windows/junction results do not establish browser startup, native event-transport latency, other-OS performance or narrower semantic dependencies.

## Measured result

All 24 planned fresh processes passed without replacement, discarded successful samples or budget extension. Both Salt modes meet the predeclared benefit rule: cold and shared-edit median reductions exceed 10% and 100 ms, and all three paired directions are positive. Every component/edit/session pair also favors the candidate, with no MAD-above 20% or regression flag for those phases. Complete values, MADs and paired deltas remain in [comparison.json](033-evidence/comparison.json); SHA256 `5df605996b91877d5bdf1992e29267c6c024d359b0e99b328614709b9187bf77`.

Salt medians below are seconds, baseline to candidate.

| Mode | Cold batch | Component HMR | Shared-type HMR | Plugin session |
| --- | --- | --- | --- | --- |
| Legacy | 64.798 → 29.968 (53.75%) | 63.132 → 29.120 (53.88%) | 63.014 → 28.663 (54.51%) | 191.866 → 88.739 (53.75%) |
| ProjectService | 67.073 → 31.400 (53.19%) | 61.871 → 27.750 (55.15%) | 61.267 → 28.479 (53.52%) | 190.607 → 87.305 (54.20%) |

Legacy Salt warm-batch median increased from 47.406 ms to 51.068 ms (+3.662ms,7.73%); all three paired warm changes were slower. This is a measured tradeoff below the declared 10 ms flag. ProjectService warm results are inconclusive. Close comparisons are inconclusive in every workload/mode; no close improvement is claimed.

The shallow real-React control does not establish an overall improvement. Cold medians are 1183.597→1185.812ms for legacy and 1263.874→1293.225ms for ProjectService; session medians are 2195.450→2216.170ms and 1565.603→1589.493ms. Those phases have conflicting paired directions. Legacy component/shared phases are also inconclusive. ProjectService component HMR improves consistently by 7.945 ms (5.28%); shared HMR is inconclusive. Its warm median rises 0.264 ms. No declared regression threshold is triggered in the control.

Recommendation: retain the small backend canonical-output reuse change. The external-review gate passed. This is a substantial additional benefit on the pinned, deeply nested Windows/junction Salt workload after 029; it adds no cache or public configuration. It does not show a universal speedup or justify changing dependency breadth, backend defaults or disk-cache policy. Both Salt edits still affect all 215 targets.

## Review and integration gates

The exact three-file local bundle and scoped source context are prepared in an isolated review copy. The helper's bundle construction, complete-input checks and secret/path validation pass without an external invocation. The final bundle includes the verified measurement results:134986 characters, SHA256 `a4814b3558d9374f8f7275ca8c321413cce581c9d16b000809282c7b61e0037d`. Its ordinary `--dry-run` verifies only command selection; the separate local validation calls the actual bundle and evidence-validation functions. The supplemental context consistently aliases the unchanged numeric lifecycle identifier `token` to `generation` to avoid the previously established scanner false positive. The three-file Git diff remains exact and unredacted.

The user approved the Plan 033 review. The helper exited0 using Codex `gpt-5.6-sol`, high reasoning, without fallback. Its [structured result](033-evidence/autoreview.json) contains no findings and concludes `patch is correct` with0.98 confidence. No finding required a change or follow-up review. Review task: `01a075dd-b296-7462-89e4-4d69283d3f9c`. Reviewer repository commands were denied by the helper's intended empty-workspace isolation; the exact validated diff and full scoped source context remained available in the bundle. See [review provenance and command](033-evidence/review-result.json). No additional review was run after this clean result.

## Main checkout verification and signing

After review, the exact three files were copied to the main checkout. Every source hash matches the reviewed freeze. The package build and TS6 typecheck pass; all five rebuilt distribution files match the tested archive. The four new alias/lifecycle/error cases pass in main with the worktree exclusion enabled. Whitespace validation passes. The already-completed full suite, compatibility matrix and timing samples remain tied to this unchanged source and identical build; they were not repeated. See [integration verification](033-evidence/integration-verification.json).

The configured signed-commit command timed out while 1Password was authorizing the GPG passphrase lookup. It created no commit; the [signing attempt](033-evidence/integration-signing-attempts.json) is preserved. The user then explicitly requested an unsigned local commit and no push, overriding the plan's signing requirement. `git -c commit.gpgsign=false commit -m "Reuse canonical backend dependency output"` created `09039b9`. The committed three blobs exactly match the reviewed source freeze, the commit has no signature, and persistent signing configuration remains unchanged (`commit.gpgsign=true`). See the [source commit verification](033-evidence/source-commit.json). Related plans and evidence are consolidated separately; the [goal audit](GOAL-COMPLETION.md) records the final scope.

All sampling processes have finished and both consumers are restored. The user-visible [three-file diff](033-evidence/reviewable-source.diff) is available for inspection.
