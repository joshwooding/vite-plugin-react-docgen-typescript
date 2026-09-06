# Plan 024: Independent verification

Verdict: APPROVE evidence-only investigation; measured decision SIMPLIFY_OR_DEPRECATE.

Evidence commit: d6553de853530680b0d959120e3b0f9eeeaf8d33.
Evaluated runtime: 5f448ec8d596854eace55f59faa669193d187310.
Branch: codex/024-measure-corrected-persistent-cache.
Worktree: D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan024/vite-plugin-react-docgen-typescript.
The commit contains only plans/024-evidence/** and plans/024-persistent-cache-measurement.md:
80 files, mostly raw JSON reports, no runtime/harness/fixture/dependency changes.

## Independently checked

- Root full suite: 337 tests in 13 files, exit 0, 131.26 seconds (session 38864).
- Root typecheck and rebuild: exit 0. Rebuilt source/dist/fixture fingerprint exactly
  matches the timed inputs. Initial identity-helper spawn EPERM was rerun with
  escalation and passed; it did not affect captured samples.
- All 26 restart rows: cached semantic metadata equals the fresh oracle; effective
  mutations, same fixture paths and distinct simultaneously relevant process IDs.
  Unchanged controls skip extraction.
- All four real watcher rows: actual external and control events, hot hooks, and
  fresh metadata equal to separate oracles.
- Separate root inline calculation of all 60 raw samples, 12 median/MAD rows,
  four comparisons and projected break-even values reproduces the decision.
  Every row has five samples; no variance threshold required an extension.
- Independent fresh-process React/default cache-off and seeded-restart CLI controls
  pass metadata/workload checks. They are excluded from the timing matrix.
- Deterministic validator, six negative checks, EOL/data-mutation controls and all
  six script syntax checks pass. Cached whitespace and scoped inventory pass.
- All four untimed storage reports have matching entry counts, positive bytes and
  removed temporary roots. No retained-memory claim is made.

## Results

| Fixture / mode | Restart cold change | Restart HMR change |
| --- | ---: | ---: |
| large-project / default | 20.6% slower (343 ms) | 54.0% slower |
| large-project / projectService | 21.7% slower (374 ms) | 68.4% slower |
| react-typing / default | 10.4% faster (141 ms) | 23.4% slower |
| react-typing / projectService | 11.7% faster (161 ms) | 61.3% slower |

None meets the predeclared cold benefit rule of both 20% and 100 ms.
All populate/restart HMR comparisons meet the material slowdown rule.
Only React/projectService has a positive median session saving, 26 ms, projecting
seven reuse sessions to offset population overhead. That does not meet KEEP.

## Review corrections and limits

The first runner's global PID-uniqueness assertion was incorrect on Windows:
PID 26648 was recycled between nonoverlapping invocations 15 and 26. Root verified
all 26 successful benchmark reports, preserved the original stop and scripts, and
approved continuation at 27 with process lifetime/order checks. All original raw
samples were retained. The 346.865-second interruption is disclosed; thresholds,
workload and sample limits were unchanged.

The final reader tolerates Git CRLF checkout conversion when checking hashes of
original LF reports, with a data-mutation control. Raw reports and recorded hashes
were not changed. HMR timing documentation was corrected to exclude the marker
write, which belongs to session timing.

These are direct-plugin measurements on 16- and three-component fixtures, fresh
Node processes with warmed filesystem state, on this Windows/toolchain setup.
Initially missing external files remain the separate Plan 023 limitation.
This evidence supports planning simplification/deprecation of disk persistence
while retaining memory caching and correctness protections. It does not remove
the supported option, announce deprecation, merge, push or change defaults.

Main workspace remains at a360aca with untracked plans. Evidence is committed
only in the clean isolated worktree.
