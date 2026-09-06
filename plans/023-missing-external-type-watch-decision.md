# Plan 023: Missing external type watcher decision

Decision: **NEEDS_DESIGN**. The investigation is complete; the production gap is
still open. Keep Plan 022's existing-file watches. Do not add unresolved parents
to the shared Vite watcher by default.

Evaluated commit: `d6553de853530680b0d959120e3b0f9eeeaf8d33`.
Date: 2026-09-05. Runtime probes used Node 24.10.0, TypeScript 6.0.3,
react-docgen-typescript 2.2.2 and Vite 8.1.5 on Windows x64. Production source,
package manifests, lockfile, snapshots and benchmark code remain unchanged.

## Result

The missing-file gap is real with disk caching disabled and with a verified
persistent hit. Adding all exact unresolved candidates does not solve it.
Registering the existing parent directory does deliver the events, but it also
registers unrelated descendants. The shared public watcher API has no per-add
depth or filter argument to bound that registration to the relevant basenames.

| Policy in disposable probe | Valid rows per run | Creation checkpoints passing: initial / independent repeat | Later delete/recreate/edit checkpoints passing per run | Extra tracked scope |
| --- | ---: | ---: | ---: | --- |
| Unchanged production | 6 | 0/12 / 0/12 | Not reached | None |
| Add 36 exact unresolved candidates | 6 | 1/12 / 2/12 | Not reached | 0–1 directories / entries |
| Add the existing parent directory | 6 | 12/12 / 12/12 | 18/18 | 25–26 directories, 121–122 entries |

All six parent rows deliver normal updates to the expected component, match a
fresh cache-disabled oracle and avoid unrelated component delivery and full
reloads. They also receive changes to unrelated nested text files, although those
changes do not produce HMR payloads in this fixture. All eighteen observation
servers in each run close with zero tracked directories and no events after
close, for thirty-six closed servers across the two runs.

In the executor's initial run, the exact-candidate prototype's sole successful
creation is the first `.ts` candidate in the legacy/offline-deletion row. In the
advisor's independent repeat, that candidate succeeds in both modes. The second
import still fails in each of those rows, and all six exact-candidate rows fail
in both runs. The one-versus-two successful checkpoints demonstrate that isolated
success is nondeterministic here, not evidence of reliable multi-candidate support.

The advisor reran all three policies using the same standalone probe and unchanged
production source. Baseline failures, parent-prototype correctness, added watch
scope and zero-extraction absent-cache startup controls all reproduce. Original
reports retain their original filenames; the independent repeat is separately
preserved under [reviewer-rerun](023-evidence/reviewer-rerun/).

## What was exercised

Each policy has both stable modes (`legacy`, `project-service`) and three startup
states: cache off, a cache seeded while both declarations are absent, and a cache
seeded while declarations exist followed by deletion while the server is closed.
The last state creates `.ts` files in place of the former `.d.ts` files. Every row
has two components importing different unresolved basenames in the same parent,
plus an unrelated component that is loaded normally.

The absent-cache rows are real persistent hits: all three initial component
requests perform zero metadata extractions. Seeds use a separate real Vite
process, the same fixture paths, and awaited close. Oracles use separate fresh
cache-disabled processes after each mutation. A real in-root watched file change
is a required positive control before the prototype or external mutations run.
An invalid early probe that seeded through direct hooks rather than Vite is
retained only in ignored development evidence; it is not included in these rows.

The unchanged baseline never registers additional watches from the probe. The
two prototype policies use only the public `server.watcher.add` method in
disposable fixtures. They do not patch production, invoke watcher internals,
manually emit events, manually call HMR hooks, invalidate module graphs or change
global watcher options. Metadata is observed during ordinary `transformRequest`
calls, and normal outgoing HMR payloads are recorded while forwarding the original
send call.

The parent has 96 unrelated files in twelve nested package directories. Four rows
use a small shared directory. The two offline-deletion rows import files directly
from the disposable repository directory above the app. Both layouts recursively
register every unrelated descendant in the fixture. The figures are the public
`getWatched()` census, not a count of native OS handles, allocations or elapsed
time. They demonstrate added scope, not a measured slowdown. Real repositories
can contain substantially more descendants; this probe does not scan one.

Creation occurs after watcher registration and a short grace period. Recreation
also allows 150 ms registration time, consistent with existing tests. No claim is
made about immediate recreation during registration, missing ancestor directories,
index-file resolution, every extension or other operating systems.

## Primary watcher contract

Installed sources for Vite 3.2.11, 4.5.14, 5.4.21, 6.1.0, 7.2.4 and 8.1.5 were
inspected. The exact declarations, source excerpts, locations and SHA-256 hashes
are recorded in [watcher-source-contracts.json](023-evidence/watcher-source-contracts.json).
This is source coverage across the six supported major versions; the new runtime
prototypes ran on Vite 8.1.5 only.

Across those sources:

- `FSWatcher.add(paths)` accepts paths only. `depth` and `ignored` are shared
  watcher configuration, not per-registration options.
- Vite sets `disableGlobbing: true`; relying on a filtered glob is not a default
  public solution and changing the user's watcher options is outside this scope.
- A missing exact path falls back to its parent with one target filename. The
  directory reader filters entries to that filename while its readdir throttle
  is keyed by directory. Multiple target readers sharing a directory therefore
  compete. The runtime exact-candidate results demonstrate missed events.
- An ordinary parent registration has no target filename. Its directory reader
  discovers descendants using the shared depth setting. That is why an explicit
  parent registration succeeds and also broadens the watch scope.

Reading those implementations explains the observations; it does not authorize
using their private methods. Changing global depth/ignored options, unwatching
unrelated descendants of a shared watcher, relying on platform-specific raw
events, or creating another watcher subsystem would each introduce a different
design and ownership contract. None was implemented.

## Recommended follow-up

There is no supported bounded production fix established by this investigation.
The smallest useful next step is to choose one of these contracts explicitly:

1. Obtain an upstream exact-path watcher fix, or a public API that registers
   multiple basenames/nonrecursive directories without changing shared options.
   Reproduce the multi-candidate case independently of this plugin first; require
   supported-version and operating-system evidence before relying on a fix.
2. Design explicitly configured external directories whose recursive watch scope
   the consumer owns. That is an opt-in product/configuration decision, including
   missing-parent behavior, ignored directories and lifecycle ownership. Do not
   infer directory ownership from an arbitrary unresolved import.

Neither option is automatically shipped by Plan 023. A caller can choose to watch
a known small external directory in its own Vite configuration, but this does not
justify making arbitrary repository-parent watching the plugin default.

Keep these three cases distinct:

- **An existing external file is edited:** Plan 022 covers it; the existing
  focused regression suite still passes.
- **One already-watched external file is deleted and recreated:** Plan 022 covers
  the tested registration-grace case; that is not multiple missing-path support.
- **Several unresolved external candidates are created after startup:** the
  production gap remains, independent of persistence. The broad prototype is
  evidence of a tradeoff, not a committed fix.

## Validation and reproduction

- Unchanged package build: passed.
- Typecheck using TypeScript 6.0.2 alias: passed.
- Existing external watcher and strict Vite HMR tests: **25 passed in two files**,
  53.20 s. The unchanged source already has the prior 337-test evidence; a full
  duplicate suite was not run during the parallel integration checks.
- Advisor independently reran the existing tests in separate commands: external
  watcher **8/8** in 22.19 s and strict Vite HMR **17/17** in 48.44 s, for **25/25**
  total. This was not one combined test invocation. The advisor also repeated
  typechecking and syntax-checked all three standalone evidence scripts.
- Baseline standalone probe: expected exit 1, six valid failing rows.
- Exact-candidate standalone probe: expected exit 1, six valid failing rows.
- Parent standalone probe: exit 0, six passing rows / thirty checkpoints.
- Advisor independently repeated all eighteen rows: baseline 0/12 creation
  checkpoints, exact candidates 2/12 (six failing rows), parent 30/30 checkpoints.
  The initial exact-candidate count was 1/12; both observations are retained.
- Source/build identities remain identical across both runs' six probe reports.
- `git diff --check`: passed. No production changes.

From this worktree, after building the package, run sequentially:

```powershell
node plans/023-evidence/missing-external.mjs baseline
node plans/023-evidence/missing-external.mjs exact-candidates
node plans/023-evidence/missing-external.mjs parent
```

The first two commands deliberately return nonzero for missing events, stale
metadata or missing HMR delivery. Do not invert their exit status into a claim
that production is correct. Any failed positive control or lifecycle check is
reported as an error. Disposable fixtures and child manifests live in ignored
`.yarn/simplification-evidence/023`; cleanup checks containment before removing
only the individual fixture. Raw reports are written beside the probe source.

To inspect another installed watcher version, pass its Vite package directory to
`node plans/023-evidence/inspect-watcher-source.mjs`. Multiple package directories
can be supplied together. This reads source only. Versions 3–7 in this record
came from Plan 025's captured installed packages; version 8 used the existing
ancestor installation. No dependency installation was added for this plan.

Evidence: [baseline](023-evidence/baseline-results.json),
[exact candidates](023-evidence/exact-candidates-results.json),
[parent prototype](023-evidence/parent-results.json), and
[standalone probe](023-evidence/missing-external.mjs). Independent repeat:
[baseline](023-evidence/reviewer-rerun/baseline-results.json),
[exact candidates](023-evidence/reviewer-rerun/exact-candidates-results.json),
[parent prototype](023-evidence/reviewer-rerun/parent-results.json).
