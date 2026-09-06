# Plan 026: Deprecate disk persistence through a compatible release window

Status: PREPARED — backlog item 3's requested proposal is complete; no deprecation
has been implemented or published. Priority P3; effort S for stage A, M for stage B;
risk MED because this is a public option. Planned at d6553de853530680b0d959120e3b0f9eeeaf8d33,
2026-09-05. Depends on Plan 022's retained correctness fixes, Plan 024's historical
evidence and the completed Plan 035 current-artifact recheck. Updated 2026-09-06.

## Decision and limits

Recommend a compatible documentation/type-annotation deprecation first, followed
by removal in a later release explicitly designated breaking. Keep the existing
default off throughout. Removing disk persistence does not remove in-memory
transform caching or TypeScript Program reuse.

Plan 024 measured 60 valid fresh-process samples on Windows with TypeScript 6.0.3
on historical source `5f448ec8d596854eace55f59faa669193d187310`, before Plans 029/033.
None of its four workload/mode comparisons met the predefined retention rule.
For 16-component fixtures, persisted restarts were 20.6–21.7% slower; for the
three-component React fixture, cold startup improved 10.4–11.7%, below that rule.
Restart HMR was 23.4–68.4% slower across the four comparisons. These are fixture
results, not a claim that persistence cannot help any consumer. See
[024 verification](024-verification.md) and the immutable evidence at d6553de.
Plans 027/032 profile a larger Salt DS consumer with disk caching off; neither
establishes a Salt-specific persistence on/off result. Plan 029 changed both
analysis and persistent-hit paths. Plan 033 removes the remaining backend pass
in analysis and cache validation; correctness and cache-off measurement pass,
and external review is clean. The change is integrated at user-authorized unsigned
local source commit `09039b9`.
The historical percentages are not measurements of either optimized artifact.

Plan 035 now measures the unchanged post-033 runtime at base `ec7455a`, with all
five distribution files identical to the accepted033 artifact. All 60 measurements
and genuine-hit/full-metadata controls pass. No tested group meets the original
retention rule: large-project restart cold is 35.0–36.2% slower; react-typing saves
6.1–6.4%, below both benefit thresholds. Restart HMR is 19.5–107.7% slower; every
population and restart edit comparison exceeds the material-regression limits.
The result is SIMPLIFY_OR_DEPRECATE on these two Windows scale1 fixtures and stable
modes. It supplies current-artifact support for the compatible notice, without a
Salt-specific or universal removal claim. See [035 verification](035-verification.md)
and the [measurement report](035-persistent-cache-measurement.md).

Current validation deliberately initializes TypeScript and checks current project
membership before accepting a disk hit. That cost protects against new declarations,
augmentations and offline changes. Do not revive backend-free acceptance or replace
content hashes with mtime/size checks to improve benchmark numbers.

## Evidence freshness before a new retention decision

This gate is COMPLETE in Plan 035 for the unchanged post-033 runtime and the two
declared fixtures. A compatible stage A notice may cite those bounded results;
Plan 024 must remain labeled historical. Neither report measures Salt persistence
or proves that removing the option always helps. Do not rerun the completed matrix
on identical inputs just to implement documentation. If relevant runtime/workload
inputs change before relying on a new current-performance claim, repeat this gate:

1. Freeze the actual final integrated source, package artifact, compiler, existing
   corrected benchmark and workload identities. Use the artifact that is being
   considered for retention/removal, including the accepted Plan 033 change.
2. Reuse Plan 024's corrected benchmark and meaningful controls: cache off,
   initially empty, and a restart seeded by a separately awaited process at the
   same paths; both stable modes; unchanged fixture/options; fresh metadata,
   equal affected work and verified persistent hits. Keep offline freshness and
   existing external-file watcher behavior intact.
3. Declare the workloads, fixed process budget/order, variability handling and
   retention rule before sampling. Report population cost, restart and edit
   cycles, including inconclusive results. Do not use cache-off Salt profiles or
   synthetic native-prototype timings as a persistence comparison.
4. Save a separate current-artifact report with raw results and a KEEP,
   SIMPLIFY_OR_DEPRECATE or INCONCLUSIVE conclusion. Preserve Plan 024 unchanged.
   This targeted revalidation is justified by changed runtime paths; it does not
   require repeating completed TS7, Storybook or watcher-policy experiments.

The completed gate supports the present performance rationale within its stated
scope. A later removal decision must check for relevant drift and review consumer
reliance or new evidence. If removal is instead a maintenance-policy decision,
record that choice explicitly; do not substitute historical timings for current
evidence. Neither route bypasses the published-release gates below.

## Current contract and owner boundary

Use the latest integrated reviewed stack after a drift check. The historical
measurement commit is an evidence reference, not the next execution base.
Read these files before editing:

- packages/vite-plugin-react-docgen-typescript/src/utils/options.ts: public
  FileSystemCacheOptions and DocGenOptions.fileSystemCache.
- packages/vite-plugin-react-docgen-typescript/src/utils/cache.ts: normalization,
  directory resolution, namespace/proof serialization and persisted entry IO.
- packages/vite-plugin-react-docgen-typescript/src/plugin.ts: persistent read/write,
  initialization and invalidation alongside the independently useful memory cache.
- src/__tests__/backendContract.test.ts and persistentCacheFreshness.test.ts under
  the package: option, restart, freshness and lifecycle contracts. Locate actual
  filenames with rg before editing; trace helper callers instead of assuming an
  entire cache module is exclusive to persistence.
- README.md, the package index/type exports, and existing .changeset entries.

Omitted fileSystemCache and false disable persistence; true enables it; an object
enables it unless enabled:false. Object.enabled's default true is not the public
option's default. Custom directory paths resolve from the Vite root.

## Stage A — compatible deprecation (future implementation)

Create a clean codex/ branch/worktree from the latest integrated source after a
drift check. Scope: README.md, options.ts JSDoc, and one patch Changeset. Add only
necessary type/export documentation changes; no production behavior or IO changes.

1. Mark fileSystemCache and its exported options type deprecated in JSDoc, with
   migration text: remove fileSystemCache from configuration, or set it to false.
   Retain the boolean/object type and all existing behavior during this release.
2. Add a brief README migration example and the chosen rationale. Label Plan 024
   results with their historical source and workload limits, or cite the new
   report if the evidence-freshness gate was completed. Explain that memory
   caching and compiler reuse continue.
   Do not promise a universal speedup, imply that caches are generally useless,
   or state an unapproved removal version/date.
3. Add the patch release note. State that removal is intended for a later breaking
   release after at least one published compatible release carrying this notice.
   A maintainer chooses the actual release boundary; this plan does not publish.
4. Prefer JSDoc and release documentation over adding runtime warning state or
   another public switch. No new warnings are necessary to complete this stage.
5. Verify the emitted declarations preserve the public shape and show deprecation
   comments; inspect packed declarations and the release-note path, review the
   repository README separately, and confirm the default remains off. Plan 034
   established that the root README is absent from the current archive and is not
   generated into the package; adding README packaging is outside this notice.

Done: users can follow a precise migration path, existing configurations still
work, docs/types/release note agree, and no persisted-hit freshness checks change.
Do not label this stage shipped before an actual release occurs.

## Stage B — later breaking removal (separate authorization/release decision)

Entry gates: record the actual version and publication evidence for at least one
compatible release carrying stage A; the maintainer selects a breaking release;
review any new consumer evidence or reported reliance. A local notice commit is
not a published release. Record the maintenance-policy decision or confirm the
Plan 035 evidence still applies, repeating the freshness gate only after relevant
input changes, before relying on current performance to justify removal.
If retention is reconsidered, use a concrete workload and correctness-preserving,
predeclared measurement rather than a new cache subsystem.

1. Inventory persistence-only call sites, types and tests. Remove file IO, persisted
   formats/namespacing and option exports only where exclusively owned by disk
   persistence. Keep shared hashing, dependency tracking, memory invalidation,
   current-program membership and configuration/watcher ownership where still used.
2. Remove fileSystemCache from accepted TypeScript options. For JavaScript callers,
   tolerate omission, undefined and literal false as an off-state migration
   convenience; reject true and every object form with an actionable instruction
   to remove the option. Use the existing option-validation boundary. This avoids
   retaining the old object-normalization contract. Document that TypeScript users
   remove the property entirely, including false, in the breaking release. Test
   this narrow rule; never silently ignore an enabled option or add a configuration layer.
3. Never recursively delete users' cache directories. Old cache files are inert;
   document optional manual cleanup of the previously configured cache directory.
4. Keep tests for same-process caching, new declarations/augmentations, config
   changes, dependency edits, external existing-file watching and awaited teardown.
   Remove only cases whose sole contract is disk persistence; retain equivalent
   backend/freshness coverage rather than deleting whole test files blindly.
5. Update README/types and add a breaking release note with migration and removal
   scope. Update benchmark documentation only where it references the removed
   option; archive prior evidence unchanged instead of rewriting historical reports.

Done: no enabled disk path remains, supported configurations fail helpfully if
obsolete, memory caching/reuse and metadata freshness remain verified, and the
package/migration documentation agrees with its actual exported API.

## Verification and execution controls

Use ancestor dependencies already installed; no dependency or peer-range upgrades.
From the isolated worktree root:

```powershell
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/@biomejs/biome/bin/biome ci CHANGED_SOURCE_FILES
```

Build from packages/vite-plugin-react-docgen-typescript:

```powershell
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs
```

Pack from worktree root with Yarn 4.13.0 and an owned ignored output path:

```powershell
node D:/OSS/vite-plugin-react-docgen-typescript/.yarn/releases/yarn-4.13.0.cjs workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out ABSOLUTE_TGZ
```

For stage A, source/API diff, build/typecheck, existing focused option tests and
packed-declaration inspection suffice; do not write implementation-mirroring tests
for JSDoc. For stage B, first demonstrate a behavioral regression test, then run
the focused contracts and full suite with --exclude '**/.yarn/**' --pool=threads
--maxWorkers=2. Run the unchanged packed compatibility matrix on the final artifact
and the affected real-watcher/freshness probes. Preserve failing attempts and exact
source/artifact identities. Run autoreview for nontrivial source edits; review its
actual findings and stop once no accepted actionable findings remain.

Stop for a proposed backend/default change, removal of freshness protection,
unmeasured shared cache, expanded filesystem watch scope, or missing release gate.
Stage B must not be bundled into stage A. Freeze the scoped diff for independent
review before an isolated commit; no push, publish or user-branch change follows
from this future implementation plan alone.
