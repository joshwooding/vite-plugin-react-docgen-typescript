# Plan 022 verification

Status: APPROVED for the bounded Plan 022 scope and committed at
`5f448ec8d596854eace55f59faa669193d187310`; one confirmed pre-existing review
finding is consciously deferred to Plan 023. This is not a clean-helper result.

## Frozen scope

- Request: "Please fix that" — both demonstrated Plan 021 correctness gaps.
- Branch: `codex/022-cache-freshness-and-type-watches`.
- Base: `e698406bf86849263c260a81950af67f021e424d`.
- Worktree: `D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan022/vite-plugin-react-docgen-typescript`.
- Scope: nine files; four production TypeScript files, README, two existing
  contract test files and two new regression test files. Production-only change:
  170 additions, 18 deletions at initial freeze; 174 additions, 18 deletions after
  the naming-only clarification and formatter wrapping. README adds two lines.
- Production owner boundary: persisted-cache validation and Vite dependency
  watch registration. No public options/defaults, package/lockfile changes,
  historical evidence rewrites, benchmark changes or new state subsystem.
- Intended behavior: validate the actual current compiler program before
  accepting persisted metadata; still skip extraction for unchanged entries;
  deliver real external type-file events and refresh affected component metadata.
- Behavior-probe source SHA256: `c6e3a84d1cb3ee97c213326a983f4b3e17fdba33ac015be5e2b84c3080f21742`.
- Behavior-probe built index SHA256: `dfb9a141e52388074c8403440c267f8051eb3d24a2d1c273f22563fe15fe2eaf`.
- Reviewed source SHA256 after naming clarification: `2421d8ccc6a79558a86c71b33dceb1803766b73ee47af5f32d70e64ee61bbffd`.
- Rebuilt index SHA256 after naming clarification: `8446e4c027f8f3506117209a857d6d55f30687db40a627351f4ab4f7f9390f5f`.

## Independent behavior evidence

Ignored local artifacts reside under the worktree's
`.yarn/simplification-evidence/022/` directory. They do not replace or overwrite
the historical Plan 021 evidence.

- `restart-results.json`: **26/26 PASS** in separate seed/restart/oracle processes
  at the same fixture paths. Both stable modes cover unchanged metadata,
  imported-type/config/existing ambient edits, new globals and augmentations,
  unresolved import creation, deletion and recreation, exact size/mtime-preserved
  rewrites, existing modules becoming global/augmentation contributors, and
  creation of a configured type-root package outside include patterns.
- Unchanged controls in both modes: seed extraction count 1, persisted restart
  count 0, cache-disabled oracle count 1. Every changed fixture has an effective
  fresh-oracle metadata change. Source/build identity is stable throughout.
- `watcher-results.json`: **4/4 PASS** across both modes and fresh/persistent
  startup. Each row observes one actual external change and one in-root control
  change, then matches a cache-disabled fresh-process oracle. Persistent startup
  extraction count is zero; fresh startup count is one. No synthetic watcher
  event, manual hot hook or test-driven module invalidation establishes this proof.
- The extraction observer loads parser dependencies. Its compiler-loaded fields
  are not valid lazy-startup measurements and support no timing/performance claim.
- Real integration tests also cover two referenced projects, unrelated component
  stability, external unlink/recreation and shutdown cleanup.

## Checks

- Executor: focused 114/114; original strict HMR 17/17; full suite 337/337 in
  13 files; typecheck, eight-file scoped lint, build and whitespace checks pass.
- Advisor: typecheck and eight-file scoped lint pass; independent build passes
  and exactly reproduces the behavior probes' source/build hashes.
- Advisor full-suite rerun: **337/337 PASS**, 13 files, 142.16 s, exit 0;
  `reviewer-full-tests.log`.
- Autoreview local bundle dry run: exit 0; target is this nine-file uncommitted
  diff, default Codex Sol/high with documented access-only Terra fallback.
- Review authorization: the initial automatic approval rejection was resolved
  by the user's explicit "I approve" for this Plan 022 nine-file diff and scoped
  follow-up reviews. No workaround or alternate egress was attempted.
- The approved helper stopped locally before engine invocation because its
  secret-assignment heuristic mistook the new lifecycle-counter alias
  `const token = lifecycleToken` for a credential. The advisor verified the
  scanner rule and the numeric lifecycle source. The executor clarified this
  new local alias to `validationLifecycle`, with no behavior change. Executor and
  advisor each passed 52 affected tests, typecheck and scoped lint; executor build
  and whitespace check pass. The advisor independently reversed only that local
  rename and formatter wrap in memory and reproduced the entire original source
  tree hash (`reviewer-lifecycle-rename.json`), connecting prior behavior evidence
  to the review candidate without rewriting historical evidence.
- Approved review ran with a 73,992-character bundle, Codex Sol/high. It returned
  one P2 finding: an external unresolved type file already absent at startup is
  not observed when created later. Result preserved in `autoreview-round1.json`
  and `autoreview-round1.txt`.
- The advisor confirmed this additional case independently: four rows, both
  modes and cache states, had no actual add event and stale metadata; cached
  rows were genuine extraction-free hits. Evidence:
  `reviewer-missing-startup-baseline.json` and `reviewer-missing-startup.mjs`.
- Review revision 1 attempted the smallest change: move the existence guard to
  only the build/direct addWatchFile fallback. Six new integration regressions
  covered initially absent files, cached-absent startup and offline deletion
  followed by another candidate extension. They still failed; the eight existing
  recreation rows also regressed. Backend/cache 52 and HMR 17 remained passing.
- Source diagnosis: bundled Chokidar's missing-file fallback registers a parent
  directory reader filtered to one target filename. Its directory-wide readdir
  throttle can suppress the other candidate readers. The single missing-file
  re-arm proof does not establish multi-candidate delivery. Vite disables glob
  handling, and direct parent registration would broaden recursive directory
  watching. No private API, ignore override or new watcher subsystem was added.
- The exploratory diff was saved in `review-round1-exploration.patch` and removed
  from the landing candidate. Advisor and executor each verified the restored
  source/build hashes exactly match the reviewed candidate. The original eight
  external and seventeen strict HMR tests passed again (25/25).
- The user was offered the concrete optional scope choice. No reply arrived
  during the clarification window; the advisor stated and followed the recommended
  default to retain the verified file-level fix and plan the additional case
  separately. This was not treated as approval for broader directory watching.
- Final disposition: the one finding is real, pre-existing at e698406 and outside
  the bounded production fix once the public API attempt proved insufficient.
  It requires a separate watch-scope/performance decision, recorded in
  [Plan 023](023-decide-missing-external-type-watches.md). The review's blanket
  incorrect-patch verdict is not accepted as an introduced regression. The helper
  exited 1; no clean-review claim is made. No redundant review was run against
  the identical restored candidate merely to obtain a different label.
- Final commit: `5f448ec8d596854eace55f59faa669193d187310`, parent
  `e698406bf86849263c260a81950af67f021e424d`, exactly nine files, 861 additions and
  50 deletions. Clean worktree and unchanged reviewed source/build hashes verified
  after commit. No push or merge; main remains at a360aca with untracked plans.
- Review command: `python C:/Users/Joshu/.agents/skills/autoreview/scripts/autoreview
  --mode local --prompt <scoped Plan022 context> --json-output
  .yarn/simplification-evidence/022/autoreview.json --output
  .yarn/simplification-evidence/022/autoreview.txt --stream-engine-output`.

## Review decisions and limits

The advisor read every production/test hunk and verified the new fixtures.
Compiler validation uses the existing target Program and dependency traversal,
including ambient membership. It does not hash all unrelated files or add another
membership cache. A revision check at the caller rejects proofs superseded across
the async validation boundary.

The initial addWatchFile approach created Vite import-graph nodes and caused
unnecessary full-page reloads after dependency recreation. Serve now uses the
existing public watcher directly; build/direct contexts use addWatchFile. The
original HMR helper and strict assertions are preserved, with no new orphan-node
filter, runtime-observed set or relaxed reload assertions.

After unlink, Vite's public watcher may drop an external file handle. The fix
re-registers only that already-known exact path, using existing teardown/task
ownership. Watch registration is asynchronous: the real recreation tests allow
150 ms for registration before recreating the file and still require real events
and fresh metadata. Immediate recreation within registration is not guaranteed.
Initially absent external directories do not cause broad ancestor watches.

Persistent startup now loads TypeScript to validate the current project. This is
an accepted correctness cost; unchanged memory hits stay cheap and persisted hits
still avoid extraction. No elapsed-time improvement is claimed or measured.

Snapshot content remains unchanged. Any apparent snapshot status is the known
EOL/index-stat artifact; normalized HEAD/worktree blob equality is required before
index-only refresh (`be29172562fb6497b81d0a554e96f3ae0b311aac`).
