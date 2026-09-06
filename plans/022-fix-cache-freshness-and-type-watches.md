# Plan 022: Keep persistent metadata fresh and watch external type dependencies

## Status and authorization

- Status: DONE — bounded fix committed at
  `5f448ec8d596854eace55f59faa669193d187310` in its isolated worktree; integrated locally at `6eeed0e`.
  The confirmed pre-existing initial-missing-file review finding is deferred to
  [Plan 023](023-decide-missing-external-type-watches.md); see review disposition.
- Priority: P2; effort: M; risk: MED; category: correctness.
- Planned at: e698406bf86849263c260a81950af67f021e424d, 2026-09-05.
- Depends on: completed Plans 017–021 (all included in the base).
- User instruction: "Please fix that" refers to both demonstrated Plan 021 failures.
  Implementation, focused regressions and local verification are authorized.
- Verification: [022-verification.md](022-verification.md). Independent full
  suite 337/337; separate-process restart checks 26/26; real Vite watcher rows
  4/4; typecheck, lint, build and whitespace checks pass. Naming-only clarification
  rechecked with 52 tests; restored reviewed candidate rechecked with 25 strict
  HMR/external tests. Committed only in the isolated worktree; no merge/push.

## Why this matters

A new included global declaration or module augmentation created between sessions
can change component metadata while every previously recorded dependency hash
still matches. Separately, the plugin tracks external type-only dependencies in
reverse indexes without registering them with Vite's watcher. Plan 021 reproduced
both cases in legacy and ProjectService modes. Fix both without another cache,
directory-scanning subsystem, public option, default change or dependency upgrade.

## Git and ownership

Create one isolated worktree at exact base e698406bf86849263c260a81950af67f021e424d:
D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan022/vite-plugin-react-docgen-typescript
on branch codex/022-cache-freshness-and-type-watches. Preserve the repository basename
for existing path-sensitive snapshots. Root main remains at a360aca with untracked
plans; do not edit its source or older worktrees. Advisor owns main plan/index.
Executor owns scoped runtime/test/docs edits in the new worktree. No merge/push.
Freeze the final diff and report checks before committing. Commit only after
advisor approval. One-command git -c commit.gpgsign=false commit is allowed;
do not change Git config. Git metadata writes may require sandbox escalation.

Drift check: git diff --stat e698406..HEAD -- packages/vite-plugin-react-docgen-typescript/src README.md
Expected empty before implementation.

## Current source and constraints

All source paths below are relative to packages/vite-plugin-react-docgen-typescript.

- src/plugin.ts: transform returns identical-source memory hits before backend
  initialization. The persisted branch similarly returns before initialization:
  const persistedCachedTransform = readCachedTransform(this, normalizedFileId, src);
  It registers only proof.configFiles with this.addWatchFile, then records
  dependencies in trackModuleDependencies. Fresh analysis also only updates that
  reverse index. readCachedTransform validates hashes and unresolved candidates.
  writeCachedTransform builds the proof from analysis.project.configFiles and
  analysis.dependencies.
- src/utils/cache.ts: FILE_SYSTEM_CACHE_VERSION is 8. FileSystemCacheProof contains
  backendFingerprint, componentFile, configFiles, dependencyFingerprints and
  selectionFingerprint. createFileSystemCacheProof normalizes/sorts paths and
  hashes existing files. isFileSystemCacheProofValid checks shape, identities and
  recorded content hashes; it cannot discover newly included ambient files.
- src/docgen/backend.ts: BackendProjectState has configFiles, docgenFiles,
  generation and trackedFiles. DocgenBackend exposes initialize, analyze, update,
  reset, dispose and recordCacheHit.
- src/docgen/legacyBackend.ts: getProjectState copies canonical membership sets.
  syncInitialProjectFiles fills trackedFiles from configured project roots.
  syncProjectFilesFromProgram adds non-default-library program source files and
  referenced-project roots. Default/watch initialization has a Program already.
  ProjectService initialize only creates a service; its initial trackedFiles is
  NOT a complete program snapshot. getProjectServiceProgram(fileName, source)
  opens the target client and retrieves its actual configured program; analysis
  calls syncProjectFilesFromProgram after obtaining that program.
- collectTrackedFileDependencies already walks compiler-resolved dependencies and
  shared ambient sources. Reuse existing discovery, normalization and lifecycle
  code rather than duplicate TypeScript's project semantics.
- README.md says filesystem caching is opt-in, default false. Runtime default
  legacy and stable opt-in ProjectService remain. Do not remove watch mode or
  weaken supported TypeScript >=4.3 <7, Vite or Node ranges.
- Tests use Vitest, fixture temp directories with finally/await close cleanup,
  vi spies for backend contracts, and real Vite integration helpers. Match this.
  Existing importedTypeHmrContract helper manually emits watcher events; those
  tests must remain, but cannot establish real filesystem delivery.

## Scope

Only these production/docs files may change:
- src/plugin.ts
- src/utils/cache.ts
- src/docgen/backend.ts
- src/docgen/legacyBackend.ts
- README.md (small explanation of persistent validation/startup tradeoff only)

Test scope:
- src/__tests__/backendContract.test.ts
- src/__tests__/backendParity.test.ts (warm-start backend count assertions only)
- src/__tests__/index.test.ts
- src/__tests__/viteHmr.contract.test.ts
- src/__tests__/persistentCacheFreshness.test.ts (new focused file if useful)
- src/__tests__/externalTypeWatch.test.ts (new focused file if useful)
- src/__tests__/support/externalTypeWatchContract.ts (new small helper if useful)
- src/__tests__/support/importedTypeHmrContract.ts (invalidation observation only)

Do not change Plan 021 historical scripts/results/decision, benchmark implementation,
package manifests, lockfile, generated snapshots, default options, release files,
or any additional cache/index subsystem. Small disposable independent verification
scripts/raw outputs may live in ignored .yarn/simplification-evidence/022.
Advisor may author review records under main plans; executor does not edit them.

## Implementation steps

1. Create the worktree and reproduce both bug shapes with focused tests that fail
   on the base for stale metadata/event delivery, not broken fixtures. For restart,
   seed/cache-restart/fresh-oracle use fresh plugin instances and actual same-path
   files; independent advisor process-isolated verification will supplement suite
   cases. Include both new global interface declarations and module augmentation.
   Also cover an already-included unrelated declaration file changing from
   `export {};` to a global interface contribution: project file names stay the
   same, but ambient dependencies change. The advisor reproduced this in both
   stable modes against the Plan 021 build; evidence is
   `.yarn/simplification-evidence/022/reviewer-existing-root-baseline.json`.
   For watcher, real Vite middleware server, sibling shared/types.d.ts outside
   root, actual file edits, normal transformRequest, positive control within root.
   Wait until control is watched before writing. No watcher.emit, watcher.add
   workaround, manual HMR call or test-driven module invalidation.

   Verify the new focused tests fail for the intended metadata mismatches or
   absent external event before production edits. Preserve a concise failure log.

2. Validate current compiler membership before accepting persisted output. Reuse
   the existing backend and actual target Program; never treat the pre-analysis
   ProjectService configured-root list as complete. A small optional internal
   backend capability such as prepareCacheValidation({ fileName, source }) returning
   `{ project: BackendProjectState, dependencies: readonly string[] }` with a
   complete current program snapshot (or undefined if unavailable) is acceptable.
   It should get the actual program using existing lifecycle helpers, synchronize
   program membership, and avoid react-docgen parsing/extraction. Unsupported or
   unavailable validation must reject the persistent hit and analyze normally.

   Persist a canonical complete membership baseline in the proof; compare current
   membership and config membership before accepting a hit. Reject missing,
   malformed, noncanonical or old baselines conservatively and bump the private
   cache schema/version. Preserve recorded content hashes, unresolved-candidate
   checks, namespace/version checks and memory cache behavior. Membership includes
   configured/referenced roots and compiler-discovered non-default-library files;
   use the same membership definition at capture and validation.
   Also collect current component dependencies (including shared ambient files)
   through existing collectTrackedFileDependencies and compare their membership
   with the stored dependency proof. This rejects existing unrelated files that
   become ambient and resolution changes that leave overall membership unchanged.
   Do not solve that case by hashing every unrelated project file per component.

   Initialize lazily when a matching transformed component actually needs work.
   Persistent hits may now load the backend/compiler and build a program; that
   deliberate cost is accepted. Unchanged valid entries must still skip docgen
   extraction. Do not silently disable all persistent hits to make tests pass.
   Avoid new membership caches, hash caches, filesystem scanners, cross-session
   state or scheduling systems. Handle resets, revisions and concurrent transforms
   through existing lifecycle machinery; do not accept a proof validated against
   a superseded project state. Keep in-memory hits cheap.

   Verify focused backend/cache regressions and typecheck pass. Demonstrate at
   least one unchanged hit in both stable modes with extraction skipped, and prove
   ProjectService validation sees a new implicit ambient/type-root declaration or
   transitive program member beyond its initial configured root list.

3. Register tracked type dependencies with the Vite transform context on both
   fresh analysis (including dependency-bearing errors) and accepted persistent
   hits. Use existing normalized dependency sets plus unresolved candidates where
   appropriate, retain config watches and reverse invalidation. Preserve watcher
   ownership/cleanup, event deduplication and supported old/new Vite hook behavior.
   Respect Vite/user ignore configuration; do not globally unignore node_modules,
   watch whole filesystem trees, or add synthetic event dispatch. For nonexistent
   dependencies, reuse Vite addWatchFile semantics; cover actual creation and
   deletion/recreation in a small external fixture where practical.

   Verify real external edit changes label metadata from string to number in both
   stable modes, with cache disabled and seeded persistent cache enabled. The
   enabled case is now a validated persistent startup, not "compiler unloaded".
   Require actual external watcher events and effective in-root controls. Also
   assert only affected module metadata changes and that closing the server settles
   callbacks before fixture removal.

   Verified Vite boundary refinement during implementation: addWatchFile enters
   import-analysis dependency tracking, so passing nonexistent resolution
   candidates can fail module resolution. Register existing dependency/config
   paths using Vite's path normalization. Preserve missing candidates in the
   plugin's reverse index without handing those missing paths to Vite. Exercise
   deletion/recreation of an already watched external file; initially absent
   external directories are not permission to add broad ancestor watches.
   Vite's bundled watcher was also observed to drop an external file after
   unlink. The advisor verified two real deletion/recreation cycles by re-adding
   exactly the deleted path through public server.watcher.add after unlink;
   no explicit directory watch or synthetic event was needed. Evidence:
   `.yarn/simplification-evidence/022/reviewer-rearm-proof.json`. A small
   configureServer unlink handler for already-tracked external dependencies may
   queue that exact-path re-registration, guard shutdown and use existing listener
   cleanup ownership. This resolves the bounded watcher stop condition; preserve
   the four real recreation assertions and verify cleanup. Do not use private
   Chokidar fields or create another directory inventory.

   Final watch API refinement: registering type-only files through transform
   addWatchFile creates Vite import-graph nodes. Existing HMR recreation tests
   demonstrated that orphan watched nodes then force full-page reloads. During
   serve, register existing exact dependency paths through the already captured
   public server.watcher.add instead; the existing reverse dependency index and
   hooks already supply affected component modules. Keep addWatchFile as the
   build/no-server fallback. Preserve config watching and user watcher ignores.
   Do not add orphan-module filters or a runtime-observed membership set. If this
   removes the extra graph edges, restore the original HMR helper assertions and
   omit the now-unnecessary invalidation instrumentation changes.
   Public watcher registration is asynchronous. The real recreation fixture may
   allow the same 150 ms registration grace as its startup control, while still
   requiring actual unlink/add events and fresh metadata. Record that boundary:
   immediate recreation during watch registration is not a guaranteed delivery
   contract. Do not add polling, private watcher APIs or another state mechanism
   to claim stronger guarantees than the public watcher provides.

   Review revision 1: the final direct serve-watcher API can also register missing
   exact paths. The retained existsSync guard was required only by addWatchFile;
   in serve it leaves external imports already missing at startup unobserved when
   created later. Allow existing reverse-index unresolved candidates through the
   public serve watcher, retain the existence guard for build/direct addWatchFile
   contexts, and add real initial-missing/creation coverage in both modes with
   cache off/on. Verify baseline failure before the fix. Also check offline
   deletion and alternate candidate extension creation within the existing scope.
   Do not add explicit broad directory watches, a scanner, another state index or
   an ignore override. Public exact-path watch registration may manage its own
   missing-path discovery; do not reproduce that machinery in the plugin.
   Outcome: the attempted exact-path registration did not deliver missing-file
   creation events and regressed all eight existing recreation rows because
   multiple candidate directory readers conflict inside the bundled watcher.
   This attempt and its six tests were preserved as ignored exploration, then
   reverted exactly. Reliable initial-missing support crosses the original watch
   scope/performance boundary and is now a separate Plan 023 decision. This
   revision instruction is superseded and is not part of the committed code.

   Cross-project verification: after transforming components from two referenced
   ProjectService projects, an external dependency of the earlier project must
   still update. The advisor reproduced a real delivered event with stale output
   because the latest project snapshot describes only the other program:
   `.yarn/simplification-evidence/022/reviewer-multiple-projects.json`.
   Reuse the existing affected-component reverse index to recognize those known
   dependencies in plugin shouldProcess and backend update classification; do
   not add another membership index. Add a real two-reference regression with
   cache off/on and preserve selective metadata refresh.

4. Update small existing tests whose contract intentionally changes from
   backend-free hits to backend-validated hits. Add malformed/missing baseline
   rejection and unchanged-hit extraction-spy coverage. Preserve unrelated tests,
   supported modes and exact generated output snapshots. Add a short README
   explanation that persistence avoids repeat extraction but validates current
   TypeScript project membership at startup.
   Update backendParity.test.ts warm backend creation counts from one/two to
   two/three as required by validated reuse; preserve its metadata assertions.
   addWatchFile introduces real Vite graph edges. The existing HMR helper must
   distinguish raw invalidateModule invocations from effective HMR invalidations:
   isHmr=false is a separate file-change invalidation phase, and a seen-set call
   with unchanged invalidation state is a no-op. Preserve hard-from-soft upgrades
   as effective work, retain raw invocation observations, and leave delivery,
   selectivity and metadata assertions unchanged. The advisor verified these
   rules against installed Vite's invalidateModule/updateModules source.

5. Run scoped lint, typecheck, focused tests, full suite and build. Freeze diff.
   Advisor independently reviews all hunks, re-runs focused/full behavior checks,
   compares output to fresh oracles, and runs the autoreview helper on the scoped
   frozen code diff. Do not call external review yourself or spawn more agents.
   Report issues if a check cannot run; don't silently count failures as success.
   Do not run timing measurements; those are separate future work after this fix.

## Commands

Installed ancestor dependencies can be reused; no install is required.
Use PowerShell login:false and these exact paths:

- Typecheck:
  node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json
- Focused tests:
  node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendContract.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/persistentCacheFreshness.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
  Omit nonexistent optional new files; include any changed existing test file.
- Full suite:
  node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
- Build, cwd worktree/packages/vite-plugin-react-docgen-typescript:
  node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs
- Lint, pass only changed TS files:
  node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/@biomejs/biome/bin/biome ci <changed TS paths>
- Whitespace: git diff --check

Expected success exit0/all tests pass. Full baseline has 309 tests/11 files.
New meaningful regressions add to that baseline. Esbuild/Vite/child-process tests
may require sandbox escalation. Do not substitute a restricted-environment spawn
failure for a behavioral result. Never update snapshots: known test EOL/index
artifact may be refreshed only after empty diff and exact normalized HEAD blob
equality (existing snapshot OID be29172562fb6497b81d0a554e96f3ae0b311aac).

## Done criteria and stop boundaries

- Both originally stale restart cases match fresh cache-disabled metadata in both
  stable modes. Existing restart controls (config, imported/ambient edit, unresolved
  creation, deletion/recreation, exact preserved-mtime rewrite) remain correct.
- Unchanged persistent hits still skip extraction; stale/old/unsupported proof
  cases safely miss; ProjectService validation uses an actual program.
- Real filesystem events and fresh metadata are observed for external declarations
  with cache off and on; no artificial event/hook invocation establishes the proof.
- Typecheck, all affected tests, full suite, build, lint and whitespace pass.
- No source changes outside scope; historical Plan 021 evidence preserved.
- Independent review has no accepted actionable findings before commit.
- Stop and report a specific obstacle if completeness cannot be established via
  existing backend machinery or a new public option/dependency/whole-tree scanner
  seems necessary. Conservative misses in unsupported cases are allowed.
  Do not expand scope to rescue persistence with another optimization subsystem.

## Maintenance

The new membership field is a private persisted format change, so old entries are
cache misses, not data needing migration. Review must scrutinize ProjectService
program selection, reference/type discovery, revision races, and watcher lifecycle.
No performance claim follows from fewer extraction calls; measure later using the
repaired harness only after all correctness prerequisites pass.
