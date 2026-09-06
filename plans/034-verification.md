# Plan 034 verification: explicit external type directory watches

Status: COMPLETE - verified, reviewed and integrated at unsigned local source
commit `653e203e3df0e8d923caa085d50ea150113e4f4b`.
Verified 2026-09-06 against base `4e78cf3bebcae3896b53ef4ae154d6cdca95b274`.
Candidate: `.yarn/.codex-worktrees/plan034/vite-plugin-react-docgen-typescript`.
Review copy: `.yarn/.codex-worktrees/review034/vite-plugin-react-docgen-typescript`.

## Result

The README now documents a consumer-local Vite plugin that watches an explicitly
chosen existing external type directory. It validates the directory in `config()`
before Vite allocates its watcher, then registers it in `configureServer()` before
initial transforms. Production builds skip the serve-only plugin. No new package
option, watcher subsystem, default, dependency or runtime code is introduced.

This is an opt-in workaround. Automatic discovery of initially missing external
files remains the open Plan 023 gap for consumers without this configuration.
The example preserves Vite's ignored/depth/symlink settings and `watch: null`,
does not expand `server.fs.allow`, and leaves shutdown to Vite. Registration races,
missing or recreated directories and symlink retargets are outside its guarantee.

The reviewable change is two files: 55 README additions and 388 additions/3
replacements in the existing external watcher test. Four behavioral cases are
added; the existing eight external watcher and seventeen HMR cases remain.
See the [exact diff](034-evidence/reviewable-change.diff) and
[source freeze](034-evidence/source-freeze.json).

All 15 runtime/public-type files retain their committed contents. All five built
distribution files match the reviewed Plan 033 artifact exactly. The root audit
also preserves the pre-existing main CRLF versus isolated LF checkout difference
in `src/utils/cache.ts`; neither copy was edited. No package payload changes.
The repository README is absent from the current packed archive and is not
generated into the package by unbuild, so this change needs no Changeset or
package release. The superseded three-file manifest is retained.

## Verification

| Check | Result |
| --- | --- |
| Root independent focused run on final frozen files | 29/29 tests, 2 files, exit 0, 50.66 seconds |
| New permanent behavioral coverage | Both stable modes, cache off and true absent-seeded persistent hits; two initially missing imports; create, edit, delete and recreate |
| Native supported-boundary proof | 8/8 executions, 40/40 mutations, Windows and Ubuntu WSL2, both stable modes |
| Lower boundary | Node 20.19.5, Vite 3.2.11, TypeScript 4.3.5 |
| Upper boundary | Node 24.10.0, Vite 8.1.5, TypeScript 6.0.3 |
| Current-environment constraints | 8/8: ignored, disabled, scope, depth, consecutive creates, offline deletion/restart, missing directory, regular file |
| Package and standalone test types | TS6 checks passed; standalone test check includes the final observer typing fixes |
| Documented example | Extracted exact example passes standalone TS6 typecheck |
| Scoped Biome and whitespace | Passed |
| Runtime/build identity | 15 runtime/public-type files unchanged; five distribution hashes exact |

The root focused command ran from the candidate worktree:

```powershell
& 'C:/nvm4w/nodejs/node.exe' 'D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs' run packages/vite-plugin-react-docgen-typescript/src/__tests__/externalTypeWatch.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/viteHmr.contract.test.ts --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
```

Its [final log](034-evidence/root-focused-tests.txt) covers the exact two frozen
files, including the executor's final observer typing fixes. It is distinct from
the executor's earlier 29-case run. Package/test/example typecheck, lint and
current-environment commands and outcomes are preserved in the
[executor report](034-evidence/executor-verification.md) and
[check manifest](034-evidence/executor-checks.json).

Each native boundary execution starts with two missing external imports and an
unrelated component. Registration precedes transforms; a real in-root control
confirms delivery. Every mutation requires a native add/change/unlink event,
complete semantic metadata equality with an independent fresh-process oracle,
effective expected prop values and exactly the affected component HMR path set.
All unaffected metadata stays unchanged. Full reloads and error payloads fail.
Text-file noise checks confirm the declared directory scope; this makes no
general selectivity claim for new TypeScript project-membership files.

All eight boundary processes exited zero after awaited shutdown. Watched maps
were empty and subsequent writes produced zero events or HMR payloads. These are
public watcher-scope observations, not OS handle counts or timing measurements.
Linux fixtures were on the Linux filesystem under `/var/tmp`, not a Windows mount.
Cache variants and edge configurations were tested on current Windows/Vite8;
the eight boundary executions were cache-disabled. Native Vite4-7 and macOS were
not tested. See the [boundary report](034-evidence/boundary/README.md).

The root independently read the diff/test logic and audited all eight result files:
40 semantic comparisons, expected delivery sets, native events, scoped noise,
shutdown, process exits, final probe identity and exact archive/distribution
hashes. Run `python plans/034-evidence/root-audit.py` from MAIN to inspect the
retained proof. [Root audit](034-evidence/root-audit.json) records PASS.
Executor evidence was copied byte-for-byte with a
[copy manifest](034-evidence/executor-copy-manifest.json).

## Retained setup corrections and limits

Initial sandboxed build/setup child-process failures were resolved with scoped
escalation. The Linux cache lacked the pinned RDT tarball; installing that exact
version succeeded without changing repository dependencies. Initial boundary
entry resolution used CommonJS against an ESM import-only package and failed
before starting servers. Only the probe entry resolution was corrected; its
original eight setup failures and script remain preserved.

The first depth-zero control was incorrectly nested below the permitted depth.
That row is retained as INVALID_CONTROL_SETUP; moving only the control to the
Vite root allowed the remaining cases to pass with unchanged watcher settings.
Previously successful cases were not replaced. The initial standalone test
typecheck caught two observation-signature issues; both are corrected and covered
by the final root run. An initial root audit assumed identical checkout line
endings; checking the committed blobs confirmed the sole cache.ts difference is
pre-existing CRLF/LF conversion, now explicitly recorded.

No full suite, benchmark, performance/default/TS7 work or old failed missing-path
experiment was repeated. The previous performance goal remains completed.

## Review and local integration

The isolated review copy contains only the two frozen README/test changes.
Local bundle validation passed through the actual autoreview helper's patch,
path, supplemental-file and secret checks, with no truncation and no external
invocation. Its [manifest](034-evidence/review-bundle-validation.json) records the
exact source hashes, prepared command and complete prompt hash. The helper ignores
global Git settings, so its raw README patch also shows the existing CRLF/LF
checkout difference; the linked human diff shows the 55 logical added lines.
The upload consists of the diff, relevant unchanged source context and summarized
test evidence.
The user approved this Plan 034 upload and scoped follow-ups. The prepared
command ran once with Codex `gpt-5.6-sol`, high reasoning, without fallback. The
helper exited 0; its [structured result](034-evidence/autoreview.json) has no
findings and concludes `patch is correct` with 0.98 confidence. No fixes or
additional reviews were needed. Reviewer repository shell reads were denied by
the intended empty-workspace isolation; the complete validated bundle and full
scoped source context remained available. See the exact command and provenance
in [review result](034-evidence/review-result.json).

The exact two reviewed working files were copied into MAIN. Their hashes and
the resulting Git diff match the approved freeze and reviewed human diff; all
15 production file hashes remain unchanged. Whitespace checks pass. The final
29-case run and boundary evidence apply to these identical files, so tests,
builds and benchmarks were not repeated. See
[integration verification](034-evidence/integration-verification.json).

The previously authorized per-command signing override created local source
commit `653e203e3df0e8d923caa085d50ea150113e4f4b` on
`codex/simplify-changesets-publish`, with planned base `4e78cf3` as its parent:

```powershell
git -c commit.gpgsign=false commit -m "Document explicit external type directory watching"
```

Its two committed blobs match the reviewed Git content. The commit is unsigned;
persistent `commit.gpgsign=true`, the configured GPG program and `core.autocrlf`
are unchanged. The existing README CRLF checkout is normalized by Git to LF
without changing its content. See [commit proof](034-evidence/source-commit.json).
The plan index and preserved evidence are consolidated separately. No push or
publication occurred, and the general Plan 023 discovery gap remains open.
