# Plan 034: Document and verify explicit external type directory watches

Status: DONE - reviewed and integrated at unsigned local source commit
`653e203e3df0e8d923caa085d50ea150113e4f4b`. See [verification](034-verification.md).
Priority P2; effort M; risk LOW for production because runtime
source is unchanged. Category correctness/docs. Planned at
`4e78cf3bebcae3896b53ef4ae154d6cdca95b274`, 2026-09-06. Depends on completed 023
investigation and integrated 033. The user selected continuing the missing-file
HMR work; choose the smallest existing-API opt-in and retain the automatic-discovery
limitation. This is not an automatic missing-file watcher fix.

## Decision and why

A type-only relative import can initially point to an absent file outside Vite's
root. The plugin indexes its unresolved candidate paths, but only registers
existing paths with the shared watcher. Creating the file then produces no native
event and can leave metadata stale, with persistence on or off.

Plan 023 demonstrated unreliable exact missing-path registrations: 1/12 and 2/12
successful creations in independent runs. Explicit parent watching passed 30/30
creation/lifecycle checkpoints per run, but recursively added unrelated directories.
Do not infer permission to watch arbitrary parents from an unresolved import.

Use a consumer-local Vite plugin in the documented configuration to add one
explicit, small existing type directory during configureServer. This uses the
watcher Vite already owns and gives the consumer ownership of recursive scope.
No new react-docgen plugin option, watcher subsystem, cache, default, or dependency
is needed. A new package option would duplicate the existing Vite configuration
capability without solving missing-parent/readiness/filter limitations.

Existing evidence registered the directory AFTER initial transforms. Startup
registration therefore needs fresh proof. Its payload check also excluded only
Other.tsx; the new proof must exclude every unaffected component, including the
second component with a different missing import.

## Current source and conventions

Root: `D:/OSS/vite-plugin-react-docgen-typescript` (MAIN below).

- `packages/vite-plugin-react-docgen-typescript/src/plugin.ts:186-209` combines
  resolved and unresolved dependencies in the reverse index.
- At `plugin.ts:213-224`, watchFiles retains this boundary:

```ts
for (const fileName of [...new Set(files)].sort()) {
  if (!existsSync(fileName)) continue;
  const viteFileName = normalizePath(fileName);
  if (devServer) devServer.watcher.add(viteFileName);
  else context.addWatchFile?.(viteFileName);
}
```

- `plugin.ts:794-820` owns the existing external unlink re-registration and
  teardown guards. Legacy add delivery and modern Vite environment handling are
  already implemented. Leave these paths unchanged.
- `README.md:41` states the initially missing external-file limitation and restart
  guidance. Keep that true, then add the explicit-directory workaround.
- `src/__tests__/externalTypeWatch.test.ts` has eight real Vite rows (both stable
  modes, persistence and referenced projects). Follow its mkdtemp fixture,
  effective in-root control, transformRequest, real native events, Parser spy and
  awaited finally cleanup. Keep all existing assertions and cases.
- `plans/023-evidence/missing-external.mjs` and `common.mjs` contain reusable
  evidence patterns for separate cache seeds/fresh semantic oracles and forwarded
  HMR payload observation. Never execute them with their old output locations or
  mutate these historical files. Copy/adapt only into new 034 evidence.
- `src/__tests__/support/importedTypeHmrContract.ts` demonstrates strict payload
  checks. Read relevant helpers before copying code. No broad test refactor.

## Proposed documentation contract

Show a short complete vite.config.ts example using the existing imports and API:

```ts
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath } from "vite";
import reactDocgenTypescript from "@joshwooding/vite-plugin-react-docgen-typescript";

const externalTypesDirectory = fileURLToPath(
  new URL("../shared-types/", import.meta.url),
);

export default defineConfig({
  plugins: [
    reactDocgenTypescript(),
    {
      name: "watch-external-types",
      apply: "serve",
      config() {
        if (!statSync(externalTypesDirectory).isDirectory()) {
          throw new Error("externalTypesDirectory must be an existing directory");
        }
      },
      configureServer(server) {
        server.watcher.add(normalizePath(externalTypesDirectory));
      },
    },
  ],
});
```

Explain the example path is relative to the configuration file, not process.cwd.
The chosen directory must exist before server startup. statSync reports the path
when absent; the explicit guard rejects a regular file. Keep it a small directory
whose recursively watched contents the consumer owns; existing symlink following
and watcher settings still apply. Do not recommend the repository/filesystem root.
For a missing directory, create it before startup or create it and restart; this
recipe makes no first-creation or directory-removal/recreation guarantee. The
missing-directory and regular-file cases must fail configuration clearly; this
guard runs only in serve configuration, not a production build. Run validation
in config(), before Vite creates its watcher; configureServer only registers the
directory. Installed Vite8 allocates the watcher before configureServer and does
not close it when that hook rejects, so testing a throwing configureServer with
test-only cleanup would hide a leak for programmatic consumers.

The directory and intended files must not be excluded by the user's watcher
settings. `server.watch: null` disables this workaround; existing depth/ignored
settings are preserved, not bypassed. Do not imply node_modules watching works.
If an ignore rule or disabled watcher is intentional, retain restart guidance.
Do not expand server.fs.allow: that controls serving files, not watcher ownership.
No custom unwatch/close handler: Vite owns the shared watcher and its shutdown.
No synchronous-ready promise is implied by add; writes during registration are
outside the verified steady-state contract. State limitations in concise prose,
not a large new public API or a defensive helper framework.

## Scope and Git ownership

Executor-only changes in an isolated same-basename worktree:
`MAIN/.yarn/.codex-worktrees/plan034/vite-plugin-react-docgen-typescript`
on `codex/034-document-explicit-external-type-watches`, exact planned base.
Check for existing paths/branches first; never reset/delete old worktrees.

Only modify:
- `README.md` (canonical repository documentation).
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts`.
- New `plans/034-evidence/**` and `plans/034-verification.md` in the worktree.

Packaging check: the existing 033 archive contains no README, and unbuild does not
generate a package README. This is repository documentation plus tests; omit a
Changeset because no package payload changes. Do not broaden into packaging/CI
changes to ship a duplicate README. The initial proposed Changeset was removed
before review; the final review scope is two files.

Root owns this plan, main `plans/README.md`, `plans/BACKLOG.md`, independent review
and closeout. Do not alter production runtime source, public types, defaults,
package/lockfiles, CI, existing fixtures/oracles/reports or source snapshots.
Do not broaden default watching, change global watcher settings, use private APIs,
manually emit HMR events/invalidate graphs, poll unresolved paths or add caches.
No installs unless a concrete existing-tool gap is reported first; use ancestor
node_modules. Do not commit, push, publish, create issues or invoke external
review. Unsigned local commits were authorized by the user; root owns any later
integration after scoped review. Preserve current main and old worktrees.

## Execution and verification

1. Verify base and source drift. Record hashes of runtime source and current dist
   against plans/033-evidence/source-freeze.json and compatibility/artifact.json.
   The source-freeze contains only three prior changed files; also require an
   empty diff of ALL runtime/public-type sources against the planned base,
   excluding the one explicitly allowed test file. This proves whole runtime
   equivalence. A new archive containing updated README bytes may have a different
   archive hash; the five distribution hashes must still match.
   Build the unchanged package in the worktree using ancestor unbuild. The five
   distribution files must match the 033 artifact exactly. No benchmark rerun.
2. Add focused real-server cases to the existing external watcher test file.
   Register the exact documentation recipe through configureServer before initial
   component transforms. Cover both modes and cache off / true absent-seeded hit
   (four positive rows total; existing eight rows retained). Keep two distinct
   missing basenames in one owned directory, two independently affected components
   and one unrelated component. Cover .d.ts creation and an alternate .ts candidate;
   include a pre-existing nested directory with index.ts in at least one row if it
   remains a small extension of the fixture. Do not claim new-directory support.
3. For each row, load all components, prove initial missing metadata, and for cache
   rows seed while absent, await close, restart same paths and assert zero initial
   parser extractions. Require real in-root control and external add delivery.
   At each effective creation/edit/delete/recreate, compare full normalized metadata
   with a fresh cache-disabled backend/process at the same paths, and assert exact
   affected HMR component paths (duplicates from normal transport may be recorded,
   but no other component path, full reload or error is permitted for the indexed
   dependency mutations in this fixture). Compare type,
   required flag, description, defaults and unchanged components, not only counts.
   Require the oracle proves each intended edit is effective. Observe payloads
   through native delivery, completed metadata comparison and a bounded settling
   period before asserting exact sets or resetting for the next mutation. Record
   duplicate transport paths. Use bounded polling
   for events and metadata, with observation snapshots reset per mutation. Never
   repair output by calling graph/HMR internals. Await server close and verify no
   post-close watcher activity. Guard cleanup to owned fixture absolute paths.
4. Cover the documented scope constraints in bounded evidence, not a combinatorial
   permanent suite: ignored chosen directory, watcher disabled, absent directory
   and regular-file path as documented configuration failures, and unrelated sibling outside the chosen
   directory. Also exercise one near-consecutive creation pair with the exact
   affected union, and one offline-deletion/restart case if not already covered
   by the main lifecycle sequence. These belong in bounded evidence, not an
   expanding permanent matrix. Use text noise for unrelated delivery controls:
   creating a new TypeScript file can intentionally broaden project membership
   and invalidate all components; do not promise otherwise. Use positive in-root controls where watching is enabled. Record
   getWatched() scope; no unrelated sibling descendants may be introduced by the
   recipe. Missing/file configuration failures must occur in config() BEFORE
   configureServer is called or watcher allocation; assert no leaked handles.
   Missing paths must report the filesystem error with their path; regular files
   must report the explicit guard message. Guard test cleanup if an unexpected
   later error does allocate a server, without counting that as valid proof. Parent bookkeeping entries are not recursive scans and must be
   distinguished. Preserve ignored/depth settings, never override them to pass.
   A disabled watcher intentionally lacks a positive native control; assert
   unchanged settings/no registration, and report this as the expected limitation.
5. Add the README example only after the positive cases pass. Run focused new and
   existing external/HMR tests, TS6 typecheck, scoped Biome and whitespace. Build
   once if required for independent proof and check unchanged dist hashes. Tests
   are behavioral, so no new test of the example's literal text or duplicated
   implementation assertions. Syntax/typecheck the example in an owned disposable
   config without changing the consumer repo or adding a permanent framework.
6. Validate the configuration-time recipe with the existing packed 033 artifact
   against supported version boundaries before claiming portability: native
   Windows and Linux (WSL Linux-owned fixture), Vite3/TS4.3 and Vite8/TS6, both stable
   modes: four OS/stack environments times two modes, eight executions total.
   Cache variants and negative configurations remain current-environment evidence;
   do not multiply this boundary budget. Root may own these four environment rows if executor hands off after
   current-environment proof. Reuse installed compatibility environments; record
   exact node/package/artifact hashes. Exercise multiple missing basenames, exact
   affected delivery, create/edit/delete/recreate and close. Do not count the old
   simulated-event matrix or Vite8-only post-transform prototype as this proof.
   Passing the boundary rows does not claim native Vite4–7 execution; preserved
   installed Vite3–8 contracts provide API-shape evidence only.
   No full matrix rerun, full suite, performance samples or dependency upgrade is
   required for unchanged runtime and a scoped documentation/test change.
7. Root reads the full diff and actual tests, checks evidence and at least one
   independent current-environment run. Prepare a narrow review bundle only after
   passing local gates. Existing external-upload approval covered 033, not this
   new diff; any needed upload request must describe the concrete ready scope.
   No extra review after a clean exit. Integrate only the reviewed scope when
   authorized, and update status without claiming automatic discovery is fixed.

## Exact commands (PowerShell, login disabled)

Set MAIN to `D:/OSS/vite-plugin-react-docgen-typescript` in command paths below;
execute from the isolated worktree root unless stated otherwise. Node is
`C:/nvm4w/nodejs/node.exe`; Python is `C:/Python311/python.exe`.

- Drift: `git diff --stat 4e78cf3bebcae3896b53ef4ae154d6cdca95b274..HEAD -- README.md packages/vite-plugin-react-docgen-typescript/src .changeset`
  Expected: no drift before work.
- Focused: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs run packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --exclude '**/.yarn/**' --pool=threads --maxWorkers=2`
  Expected: existing 25 plus four new positive rows pass; all meaningful added
  cases pass. Name/count any extra cases; do not force a count by weakening tests.
- Types: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json`
  Expected: exit 0.
- Lint: `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/@biomejs/biome/bin/biome ci packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts`
  Expected: exit 0 without changing unrelated files.
- Build, from worktree packages/vite-plugin-react-docgen-typescript:
  `node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs`
  Expected: exit 0 and five dist hashes match recorded 033 artifact.
- Whitespace: `git diff --check`. Expected exit 0 on scoped documentation and test.
- Evidence scripts: `node --check plans/034-evidence/SCRIPT.mjs` (or Python compile
  syntax check for .py); each actual verification runner must have a concrete
  recorded invocation and exit nonzero on unexpected native/metadata/scope failure.

## Done and stop conditions

DONE means the existing-API recipe is documented with honest scope, its startup
registration/native metadata/selectivity/lifecycle proof passes, runtime hashes
are unchanged, all new focused checks pass, boundary evidence is reported exactly,
and required scoped review/integration is finished. The general initially missing
external-file discovery gap remains open for consumers without explicit directory
configuration; 023 keeps NEEDS_DESIGN for automatic behavior.

Stop on runtime/source/API changes, broad automatic parents, missing positive
controls, true cache-hit proof failure, inability to preserve unrelated delivery,
or a recipe that needs private/global watcher changes. Preserve failed evidence;
report unsupported environments rather than broadening configuration silently.
Do not repeat the old exact-candidate experiment, add a new watcher option, or
claim a docs workaround fully fixes automatic discovery. No changes to persistence
policy, TS7, backend defaults or the already completed performance goal.

## References checked 2026-09-06

- Vite configureServer: https://vite.dev/guide/api-plugin.html#configureserver
- Vite shared watcher settings and disabled/ignored behavior:
  https://vite.dev/config/server-options.html#server-watch
- Chokidar recursive scope and shared depth:
  https://github.com/paulmillr/chokidar#api
- Installed Vite3-8 declarations/source excerpts and hashes remain in
  plans/023-evidence/watcher-source-contracts.json. These establish API shape;
  fresh native recipe tests establish the narrower runtime claim.
