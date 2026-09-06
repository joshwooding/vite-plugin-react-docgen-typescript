# Plan 034 verification: explicit external type directory watches

Status: EXECUTOR STEPS 1–5 COMPLETE. Steps 6–7 (supported-boundary probes,
independent final-byte run, scoped review and integration) remain root-owned.
Base: `4e78cf3bebcae3896b53ef4ae154d6cdca95b274`.
Worktree: `.yarn/.codex-worktrees/plan034/vite-plugin-react-docgen-typescript`.
No commit, push, publication, issue creation or external review was performed.

## Result and scope

The documented opt-in uses only Vite's existing public consumer configuration:
`apply: "serve"`, directory validation in `config()`, and
`server.watcher.add(normalizePath(directory))` in `configureServer()`. Validation
runs before Vite allocates its shared watcher. This keeps programmatic
configuration failures from requiring access to an unavailable failed server.
Production builds skip both hooks. The recipe retains ignored/depth settings,
shared watcher ownership and the existing automatic missing-file limitation.

Changed production runtime, public types, options, defaults, dependencies and
lockfiles: none. All 15 runtime/public-type files and all five distribution files
match the unchanged reviewed Plan033 build. The three Plan033 source-freeze
entries also matched at entry. A full source path diff against the planned base
contains only the permitted external watcher test file.

Reviewable change: root README example and four behavioral rows appended to the
existing external watcher test. Existing eight external and seventeen strict HMR
cases remain. The final two file identities are recorded in
`034-evidence/source-freeze.json`. Root packaging inspection found that the exact
Plan033 package archive contains no README and unbuild does not generate a package
README. These repository documentation and test changes do not alter the package
payload, so they require no Changeset or package release. The initially drafted
documentation Changeset was removed only after verifying its recorded SHA-256;
`source-freeze-before-documentation-scope.json` preserves the earlier three-file
manifest. README and test bytes are unchanged by this scope simplification.

## Native current-environment proof

Node 24.10.0, Vite 8.1.5, TypeScript 6.0.3, react-docgen-typescript 2.2.2,
Windows native filesystem delivery. Exact observed versions are also recorded
in the bounded result JSON files; these are correctness probes, not benchmarks.

Four permanent rows cover both stable modes and cache off versus genuinely
absent-seeded persistent hits. The seed server transforms all three components
and closes before the measured server starts. The two cache rows prove zero
initial `Parser.getComponentInfo` calls; the non-cache rows prove three calls.
Directory registration occurs before initial transforms through the documented
hooks. No filesystem allowance is expanded and no event is manually emitted.

Each row has two distinct initially missing external imports and one unrelated
component. `.d.ts` and `.ts` creation are covered; cache rows use `index.ts` in a
nested directory that already exists at startup. Each row verifies a positive
in-root native control, then first creation, second creation, edit, delete and
recreation: twenty mutation checkpoints total. Each checkpoint requires its
native event, an effective fresh cache-disabled backend/server oracle at the
same paths, complete normalized semantic metadata parity and the exact affected
component update set. Metadata includes names, descriptions, required flags,
types and default values; declaration positions and paths are not part of this
semantic comparison. Every unaffected component is compared unchanged.

Payload observation continues through metadata convergence and another 200 ms
before the exact set is checked; duplicate transport paths are permitted but no
other component path, full reload or error is permitted. Normal server close is
awaited, watched entries and unlink listeners are checked empty, and subsequent
writes produce zero observed events. Fixture removal is restricted to the owned
absolute temporary-directory prefix.

The first filtered run passed 4/4 new rows (8 existing rows intentionally skipped
by the name filter). The full focused run passed 29/29 across both files in
49.15 seconds. Afterwards a supplementary standalone test typecheck found two
observer typing issues that the package typecheck cannot see because tests are
excluded: Rolldown's possible MagicString result and the overloaded `hot.send`
signature. The final test normalizes the observed result with `String()` and
uses a compatible tuple-union observer signature. Final standalone types and
Biome pass. Root's independent focused repeat must cover these final frozen
bytes; the executor has not represented the earlier 29-case run as that proof.

## Bounded documented limitations

Eight current Vite8/legacy configurations passed; these are standalone evidence,
not an expanded permanent test matrix:

| Case | Observed contract |
| --- | --- |
| Ignored chosen directory | In-root native control works; unchanged ignored setting blocks both external creations; active metadata stays missing while a fresh backend sees the effective new types. |
| Disabled watcher | `watch: null` stays null, watcher registrations remain empty, no positive native control is claimed, and new external types require a fresh restart. |
| Owned scope | Chosen existing descendants deliver text edits without component HMR; unrelated sibling descendants are not watched and emit no observed event. A parent bookkeeping entry is retained and is not counted as recursive scope. |
| Depth limit | `depth: 0` stays unchanged; a root-level native control works and the deeper chosen descendant stays unwatched. |
| Near-consecutive creations | Back-to-back `.d.ts` and `.ts` writes deliver both native adds, exact Component+Second update union, no unrelated/error/reload, and full fresh semantic parity. |
| Offline deletion/restart | Metadata is first persisted with both types present; after close both files are deleted. Restarted metadata correctly has missing props, and recreation produces the exact affected union and full fresh parity. |
| Missing directory | Configuration rejects with ENOENT naming the path, before configureServer is called; watcher resource observations are empty before and after. Build configuration skips the guard. |
| Regular-file path | Configuration rejects with the explicit directory guard message before configureServer; watcher resources stay empty. Build configuration skips the guard. |

`constraints-results.json` preserves the first three successes and an invalid
optional depth-control setup. That first fixture placed its in-root control in
`root/src`, outside `depth: 0`; the positive control therefore could not register.
This is not a successful row or a product failure. Root authorized moving only
that row's control to Vite root. Watcher settings were unchanged. The remaining
five checks then passed in `constraints-remaining-results.json`; previously
passed rows were not rerun. `constraints-summary.json` records all eight results
and proves the hashes of both retained executed script versions.

All servers from these bounded rows were awaited on close; post-close watched
maps were empty and native event counts remained unchanged. Registration races,
creation/removal/recreation of the watched directory itself and symlink retargets
are outside this proof. No all-platform or all-version inference is made here;
root owns the separate eight supported-boundary executions.

## Commands and exact outcomes

All commands ran from the isolated worktree with PowerShell login disabled.
`NODE` below is `C:/nvm4w/nodejs/node.exe`; `MAIN` is
`D:/OSS/vite-plugin-react-docgen-typescript`.

- `git diff --stat 4e78cf3bebcae3896b53ef4ae154d6cdca95b274..HEAD -- README.md packages/vite-plugin-react-docgen-typescript/src .changeset`: empty at entry.
- From the package directory, `NODE MAIN/node_modules/unbuild/dist/cli.mjs`: initial sandbox attempt failed with esbuild `spawn EPERM`; the identical escalated local build passed. `initial-build.txt` and `initial-build-escalated.txt` retain both outputs. Five dist hashes matched the033 artifact exactly.
- `NODE MAIN/node_modules/vitest/vitest.mjs run packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts --testNamePattern "explicit startup external directory" --exclude "**/.yarn/**" --pool=threads --maxWorkers=2`: exit0, 4passed/8intentionallyskipped, `positive-first.txt`.
- `NODE --check plans/034-evidence/constraints.mjs`: exit0. The first execution is retained as `constraints-first.mjs`; both script versions also pass syntax checks.
- `NODE plans/034-evidence/constraints.mjs`: first invocation exit1 after three passed rows and the invalid depth-control setup; original exact script/results are retained.
- `NODE plans/034-evidence/constraints.mjs --remaining`: exit0, five remaining cases pass. No successful cases were replaced.
- `NODE MAIN/node_modules/vitest/vitest.mjs run packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --exclude "**/.yarn/**" --pool=threads --maxWorkers=2`: exit0, 29passed, `focused-tests.txt`.
- `NODE MAIN/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json`: exit0, `typecheck.txt`.
- `NODE MAIN/node_modules/typescript6/bin/tsc6 --ignoreConfig --noEmit --module ESNext --moduleResolution Bundler --target ES2020 --lib ES2023 --skipLibCheck --strict --esModuleInterop --types node packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts`: initial exit2 with two test-observer typing errors retained in `test-typecheck.txt`; corrected final exit0 in `test-typecheck-final.txt`.
- `NODE MAIN/node_modules/@biomejs/biome/bin/biome ci packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts`: final exit0, `biome-final.txt`.
- Extracted only the documented example into an owned disposable `.ts` file, then `NODE MAIN/node_modules/typescript6/bin/tsc6 --ignoreConfig --noEmit --module ESNext --moduleResolution Bundler --target ES2020 --skipLibCheck --strict --types node plans/034-evidence/documented-example.ts`: exit0. The file was removed after checking its exact owned path; `example-source.json` retains exact source/hash and `example-typecheck.txt` its output. No consumer repository or permanent example framework was added.
- `git diff --check`: final exit0, `whitespace-final.txt`; only an informational existing core.autocrlf notice is present.
- Final Python SHA-256 and whole-source-diff audit: exit0; unchanged15runtime/5dist, the then-current3file freeze, and both executed bounded-script hashes verified. The final scope is now2files after the verified documentation Changeset removal; README/test identities remain exact.

One preliminary output-redirection invocation never ran the build because its
evidence directory was created relative to the package working directory. The
empty accidental directories were removed after exact absolute-path validation;
`setup-note.txt` records the correction. First editing-time Biome also reported
an unsafe throw inside finally; moving the owned cleanup guard into a small
function resolved it before any tests. No test assertion was removed to pass.

## Handoff

Executor steps1–5 are complete. Root maintains the plan index/backlog and owns
supported boundaries, the independent final-byte run, review and integration.
There is no pending executor process. The original automatic initially missing
external-file discovery gap remains NEEDS_DESIGN for consumers who do not choose
this explicit existing-directory configuration. No persistence, TS7, runtime
default or performance policy was changed.
