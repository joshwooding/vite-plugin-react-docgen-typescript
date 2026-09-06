# Plan 026 Stage A verification

Status: COMPLETE locally at unsigned source commit
`d4317090119d87c37f548c1c45eb668478ef5d52`, based on `f6cfcdb`.
The compatible notice is implemented and integrated. Nothing is published;
Stage B removal remains subject to its separate publication and release gates.

## Change

The three-file change marks `fileSystemCache` deprecated in the README and
JSDoc, including its `FileSystemCacheOptions` interface, and adds a patch Changeset.
Migration is to omit `fileSystemCache` or set it to `false`. Existing boolean and
object forms, including custom directories and `enabled: false`, still work.
In-memory transform caching and TypeScript program reuse continue.

The notice cites the bounded Plan 035 results without claiming a universal
speedup. Removal is intended for a later breaking release after at least one
published compatible release carrying the notice. No date/version is assigned.
There are no runtime warnings, new root type exports, default changes or removals.

## Verification

Work ran in `.yarn/.codex-worktrees/plan026-notice/vite-plugin-react-docgen-typescript`
on `codex/026-filesystem-cache-notice`. Existing dependencies were reused:
Node 24.10.0, measured/compiler-inspection TypeScript 6.0.3, typecheck alias 6.0.2,
Vitest 4.1.0 and Yarn 4.13.0. No install or benchmark was needed.

| Check | Result |
| --- | --- |
| Typecheck with typescript6/bin/tsc6, package tsconfig | PASS |
| Biome CI on options.ts after LF formatting correction | PASS |
| unbuild from package cwd, final source | PASS |
| Existing index.test.ts option tests with threads/maxWorkers=2 and explicit name filter | 3 PASS, 58 intentionally skipped |
| Yarn workspace pack to owned ignored candidate.tgz | PASS |
| Actual Changesets reader | Exactly one new patch notice for the intended package |
| Independent TypeScript scanner/AST inspection | Executable source and all declaration type tokens unchanged; both notices retained |
| Packed member comparison against accepted033 artifact | Only index.d.ts and index.d.mts differ; all JavaScript byte-identical |
| Scoped source, migration and release-contract review | PASS; no actionable findings |

The three selected existing tests are `stores cached transforms in the default
file-system cache directory`, `does not write a file-system cache when disabled`,
and `reuses the file-system cache across plugin instances`. They cover true,
disabled object and enabled custom-directory configurations. No new tests mirror
JSDoc. Unchanged runtime bytes and type shapes justify reusing existing broader
compatibility and freshness proof; the full suite/native matrix was not repeated.

The [artifact report](026-stage-a-evidence/packed-artifact.json) records archive
SHA256 `bafdf7336bbc99bac7f5f7234b9f15ac00136d65338fcf0ec34d3f11df7d35a6`
and every packed file hash. The package member set is unchanged. The repository
README is still absent from the archive; it was reviewed separately. Changesets
parses the patch notice, but versioning/changelog generation/publication was not
run. Both emitted declaration formats contain the migration text on the option
and interface. The property stays optional with its original boolean/object
union; its default is documented as false, while object.enabled still defaults
to true. See [declaration/release verification](026-stage-a-evidence/declaration-and-release-verification.json)
and its [local verifier](026-stage-a-evidence/verify-notice.mjs).

The first Biome run found only CRLF versus required LF on the edited source;
the correction and successful final run are retained. The initial verifier used
Windows paths in ESM imports, fixed to file URLs; its next sandbox run could not
spawn read-only `git show`. The identical corrected verifier passed with normal
subprocess access. Original attempts remain in the evidence. Vitest rewrote only
snapshot line endings; logical snapshot content was unchanged and its original
CRLF bytes were restored. No test or fixture change is included.

## Integration

The [local review](026-stage-a-evidence/local-review.json) records the exact
three reviewed file hashes and scope. This is documentation/JSDoc-only work;
Plan 026's autoreview condition for nontrivial source edits does not apply.
Local source and independent generated-artifact inspection are complete. No
external review service received this change.

The isolated unsigned commit contains only README.md, options.ts and
.changeset/deprecate-filesystem-cache.md. The clean main workspace fast-forwarded
to that exact commit. Its working files and built distribution match the verified
candidate; [integration proof](026-stage-a-evidence/source-integration.json)
records all hashes. Global signing configuration remains enabled and unchanged;
only the authorized per-command unsigned override was used. Evidence and plan
status are consolidated separately. Nothing was pushed or released.
