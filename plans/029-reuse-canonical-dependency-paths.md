# Plan 029: Reuse canonical dependency paths inside the plugin

Status: COMPLETE — implementation and measurements independently verified;
external review passed with no findings. The change is integrated and verified
in the main workspace at signed source commit 41b536a.
Executor: codex/029-reuse-canonical-dependency-paths, isolated same-basename
worktree from 2fd034af84b135122c0bd8e313480b95e48fae82. Root checked scoped drift
from the planned commit: none. Main plans/index remain root-owned.
Priority P2; effort M; risk MED. Planned at 6eeed0e746242f813b7d5ee57083d67372116d20,
2026-09-05. Planning source baseline was reviewed 5f448ec. Depends on the completed
[Salt profile](027-salt-ds-profile.md); recheck scoped drift before execution.

## Problem and evidence

The full 215-target Salt core workload reveals repeated filesystem canonicalization
at a scale the earlier 16/3-component fixtures did not expose. Root ran the legacy
profile and independently checked both modes' raw cold/shared profiles. Native
realpath accounts for 75.14–75.97% of weighted self samples; nearest
resolvePhysicalPath ancestry accounts for 80.82–82.15%. These sample proportions
identify work, not achievable wall-clock savings. The profiles are not
uninstrumented timing distributions.

Inspect the final 027 report for both modes, path depth, Windows/junction setup,
raw profile hashes and scope. Do not revive the earlier inconclusive project-state
snapshot cache or infer benefit from fewer calls alone.

Current ownership:

- src/docgen/pathIdentity.ts under packages/vite-plugin-react-docgen-typescript:
  normalizeBoundaryPath calls realpathSync.native, walking existing parents for
  absent paths. This behavior correctly collapses aliases and must remain at
  actual filesystem/Vite boundaries.
- src/docgen/legacyBackend.ts: analyze's successful and error results explicitly
  normalize dependency arrays; syncFiles maintains canonical project arrays.
- src/plugin.ts: collectUnresolvedRelativeDependencies renormalizes the complete
  resolved dependency list; watchFiles renormalizes lists; trackModuleDependencies
  renormalizes them again. The same arrays pass through these helpers each transform.
- Persisted entries cross a different boundary: proof/config/unresolved strings
  from disk must not silently be treated as trustworthy canonical internal arrays.

## Intended result

Normalize each newly observed path at its ownership boundary, then reuse canonical
strings while copying/deduplicating internal arrays or sets. Preserve physical
alias identity, absent-path handling, dependency completeness and all freshness
checks. Add no process-wide path cache, membership index, public option or protocol.

## Executor ownership and scope

Create a clean codex/029-reuse-canonical-dependency-paths branch in an isolated
same-basename worktree from the latest integrated descendant, after checking scoped
drift against6eeed0e. Root owns main plans/index and independent review.

Scope: plugin.ts; backend.ts for concise internal path-contract documentation;
legacyBackend.ts only if a producer requires a minimal boundary correction;
focused path/backend/cache tests and one patch Changeset. Evidence belongs under
plans/029-evidence/**. Do not change pathIdentity semantics, shared-ambient input
selection, watch registration/lifecycle behavior, runtime modes, dependencies,
peer ranges, cache formats, benchmark defaults or the public API. Stop if those
changes appear necessary; do not turn this into a general path-cache redesign.

## Steps

1. Inventory every caller and producer of the three helpers, including successful
   and failed analysis, persisted hits, config recovery and test backends. Establish
   which arrays are already canonical. Document the internal backend contract at
   the owner boundary; do not simply assume arbitrary incoming strings are canonical.
2. Keep normalization for incoming Vite IDs/events, new unresolved candidates,
   TypeScript results crossing into internal ownership, and untrusted disk data.
   Normalize persisted inputs explicitly before they enter helpers that now assume
   canonical strings. Keep existing invalid-proof rejection and revision checks.
3. Replace only redundant internal realpath traversals with fresh Set/array copies
   or direct canonical membership checks. Preserve ordering where callers rely on
   it. Do not retain arrays across revisions or mutate backend-owned arrays.
4. Demonstrate behavior before claiming speed. Existing tests must continue to
   collapse symlink/junction aliases for existing and missing paths, refresh after
   create/delete/recreate and config changes, and reject noncanonical/stale cache
   proofs. Add a focused regression only for a real newly exposed boundary case;
   do not test implementation call counts as the sole correctness proof.
5. Validate the exact Salt baseline/component/shared oracles in both stable modes,
   preserving all215 targets, real workspace types, seven changed documentation
   outputs and33 shared-type outputs. Affected HMR sets remain unchanged by this
   optimization; no ambient-dependency narrowing is part of this plan.
6. Compare the baseline and candidate in alternating fresh-process pairs on the
   same corrected Salt setup, disk cache off, with identical metadata/work. Declare
   the sample budget, stopping rule and useful cold/HMR benefit before sampling.
   Keep profiler runs separate; also check a smaller/shallow-path fixture so a
   Windows deep-worktree result is not treated as universal. Preserve failures and
   all valid samples. A reduced realpath count without reproducible elapsed-time
   benefit is insufficient to retain a larger or more complex change.

## Measurement protocol declared before sampling

Use three baseline/candidate fresh-process pairs per stable mode on the complete
215-target Salt workload: twelve processes total. Retain cold, warm, component
edit, cumulative shared edit and awaited close, all with the existing full
semantic oracle checks. Run exactly one process at a time, after heavy correctness
checks finish. Order by round: default AB / ProjectService BA, then default BA /
ProjectService AB, then default AB / ProjectService BA; A is baseline, B candidate.

Both artifacts use the same owned consumer paths, selected configuration, source,
dependency installation, parser options and Node/TS runtime. Record differences
in plugin source/build identity explicitly; do not weaken consumer identity checks
to accept a different workload. Preserve all attempts and successful samples.
Profiler runs are separate from samples. Existing Plan 027 profiles remain intact.

Report raw values, median and MAD per variant/mode/phase and every paired delta.
Useful Salt benefit requires at least 10% and 100 ms median reduction in both
cold and shared-edit cycles for each mode, with all three paired deltas positive.
Flag component/session regressions exceeding both 10% and 100 ms, or a warm-batch
regression exceeding 10 ms. MAD over 20% of a phase median or conflicting paired
direction makes that phase inconclusive. No automatic sample-budget extension.

Also use three pairs per stable mode for the existing smaller real-React fixture,
with its supported cold/warm/HMR/close phases and fresh processes. Flag cold/HMR/
session regressions exceeding both 10% and 20 ms. Keep fixture setup/preflight
outside measured phases and retain actual paths so this control's shorter path
depth is reviewable. It does not substitute for a future other-OS Salt profile.

The executor must present the driver/artifact setup for review before any sample.
Failures, necessary setup adaptations and skipped checks remain explicit. No
change to the declared sample budget after seeing favorable or unfavorable data.

## Verification and review

From the isolated worktree, using existing ancestor dependencies:

```powershell
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/@biomejs/biome/bin/biome ci CHANGED_SOURCE_FILES
```

Build from the package with ancestor unbuild; pack with repository Yarn4.13.0.
Run the corrected scripts/verify-runtime-compatibility.mjs matrix on that exact
artifact, plus affected native watcher/restart checks. Keep supported TS4.3–6 and
Vite3–8 behavior. Read actual test assertions and negative controls, not just exits.
Freeze the small source diff for autoreview and independent root review; resolve
accepted findings within this owner boundary. No commit until reviewed, no push
or release without separate authorization.

Done: redundant internal resolution is removed without another cache, all semantic
and lifecycle contracts hold, and paired measurements establish a useful benefit.
Otherwise document the result and keep the simpler verified baseline.

## Execution verification — 2026-09-05

The five-file candidate is implemented in the isolated worktree above. It retains
normalization at the actual input boundaries, adds no path cache, and preserves
the existing freshness and watcher contracts. The production change is 45 added
and 46 removed lines across three files, plus a focused two-mode regression and
one patch Changeset.

All 24 predeclared processes completed successfully: three baseline/candidate
pairs per stable mode for Salt and the smaller React control. The independent
root audit verified the raw statistics, every affected-file list and metadata
hash, oracle parity, run ordering, logs, restored sources and frozen artifacts.
Both Salt modes meet the predefined useful-benefit rule. Median seconds:

| Mode | Startup baseline → candidate | Shared edit baseline → candidate |
| --- | --- | --- |
| Default | 174.786 → 64.641 (63.0% lower) | 174.883 → 63.741 (63.6% lower) |
| ProjectService | 179.240 → 65.916 (63.2% lower) | 173.384 → 62.557 (63.9% lower) |

Component-edit medians improve by 63.2%/65.1%. The smaller React control improves
startup by 6.8%/3.8% and edit cycles by 13.1–32.7%. Every cold/component/shared/
session pair improves. Warm and close results are inconclusive under the declared
direction rule; no phase crosses a regression threshold. All attempts, including
the slower first ProjectService baseline, are retained. These are direct-plugin
measurements on this Windows machine, with disk cache off; they do not establish
universal or browser-level savings.

Independent checks pass: 339 tests, TS6 typecheck, build/package, all ten exact
artifact compatibility rows, 26 restart checkpoints, four real Vite watcher rows,
and the separate packed lower-bound native edit/delete/recreate probe. Candidate
archive SHA256: 6dd49e628729c4314c5f32a46533d5b62ecb27231433914757eb323e38d61ce8.
See the [verification report](029-verification.md)
and its raw comparison/independent audit links.

The structured-review upload was initially rejected before launch because prior
approvals covered earlier plans and "Do 1" did not explicitly authorize the
external payload. The user then explicitly approved this review. Codex autoreview
(`gpt-5.6-sol`, high) completed with exit 0, no findings and `patch is correct`.
Review setup safeguards and the successful command are recorded in the verification
report. No source changes followed review; source/harness, archive and comparison
identities remain unchanged.

The five reviewed files are integrated in signed commit 41b536a, based on 2fd034a.
TS6 typecheck, build and both focused alias cases pass in the main workspace; all
five rebuilt distribution files match the tested artifact exactly. After two
1Password timeouts, the user-requested signing retry succeeded. The committed
source blobs match all five frozen hashes. No push or release occurred.
