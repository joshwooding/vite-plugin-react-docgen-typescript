# Plan 033 implementation verification

Status: READY FOR ROOT GATES — implementation steps 1–4 passed, including the full suite. Root-owned compatibility, performance, external review and local integration remain pending. No commit or external upload has been performed by the executor.

Base: `eb7a7650a3541d08630ed60d4e684f495123d343` on isolated branch `codex/033-reuse-backend-canonical-dependencies`. Node `24.10.0`, compiler `6.0.3`, Vitest `4.1.0`; all tools and dependencies came from the existing main installation. No dependency installation or upgrade occurred.

## Change and proof

The backend collector already receives a normalized entry and accepts only canonical project-membership strings for direct edges and ambient roots. It returns a fresh sorted array from its own Set. The patch removes the final whole-array normalization in successful analysis, error analysis and persistent-cache validation. Raw compiler inputs, unresolved candidates and lifecycle boundaries retain their normalization. No cache, graph, options, watcher, serialization or dependency change was made.

See [provenance audit](033-evidence/provenance-audit.md). Before changing production code, four new cases passed against the unchanged base. Both stable modes use real filesystem aliases for component requests and file/config updates; a transitive diamond and ambient file assert exact physical dependencies and exclude unrelated component edges. Edit, delete, recreate and config-path/ambient reset phases compare full metadata and dependency outputs against a fresh backend. Error-before-success, reset, recovery, validation, stale revisions and fresh array ownership are covered.

## Checks

Commands use PowerShell with login disabled from this worktree root unless stated otherwise. `MAIN` below is `D:/OSS/vite-plugin-react-docgen-typescript`.

| Check | Result | Evidence |
| --- | --- | --- |
| Exact planned base and source drift | Base matches; no source drift before changes | provenance-audit.md |
| New cases on unchanged baseline | 4 passed / 1 file; 7.54 s | baseline-canonical-tests.txt |
| Focused candidate suites | 78 passed / 3 files; 43.77 s | focused-tests.txt |
| TS6 typecheck | Exit 0 | typecheck.txt (empty successful output) |
| Biome CI on both changed TypeScript files | Exit 0; 2 files checked | lint.txt |
| Build | Exit 0; all 5 distribution files produced | build.txt |
| Yarn pack | Exit 0; 7 archive entries | pack.txt |
| Archive vs build | All 5 distribution SHA256 values match | artifact.json |
| Full suite | 343 passed / 14 files; 139.83 s | full-tests.txt |
| `git diff --check` | Exit 0 | diff-check.txt |

Exact commands:

```text
git diff --stat eb7a7650a3541d08630ed60d4e684f495123d343..HEAD -- packages/vite-plugin-react-docgen-typescript/src
node MAIN/node_modules/vitest/vitest.mjs run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendCanonicalDependencies.test.ts --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
node MAIN/node_modules/vitest/vitest.mjs run packages/vite-plugin-react-docgen-typescript/src/__tests__/backendCanonicalDependencies.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendParity.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/persistentCacheFreshness.test.ts --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
node MAIN/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json
node MAIN/node_modules/@biomejs/biome/bin/biome ci packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/backendCanonicalDependencies.test.ts
node MAIN/node_modules/unbuild/dist/cli.mjs
node MAIN/.yarn/releases/yarn-4.13.0.cjs workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan033/vite-plugin-react-docgen-typescript/.yarn/simplification-evidence/033/candidate.tgz
node MAIN/node_modules/vitest/vitest.mjs run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
git diff --check
```

Build ran from `packages/vite-plugin-react-docgen-typescript`; other commands ran from the worktree root. Initial Biome CI detected the Windows checkout's CRLF format; formatting the sole changed production file to repository LF style resolved it. Its initial log remains in `lint-initial-crlf.txt`. The first build could not spawn the existing esbuild child in the sandbox (`EPERM`); retry with scoped process authorization passed. That attempt remains in `build-initial-sandbox.txt`. The build's existing outdated Browserslist-data warning remains; dependencies were not changed to remove it.

The first successful typecheck produced no output, so PowerShell's `Tee-Object` created no file. It was rerun successfully with explicit output-file and exit-code capture (`typecheck.json`). The full suite rewrote one snapshot's line endings only: its LF contents matched the HEAD blob exactly, and the original Windows CRLF checkout form was restored after that equality check. No snapshot expectation changed; see `snapshot-line-ending-restoration.json`.

## Frozen candidate

Artifact: `.yarn/simplification-evidence/033/candidate.tgz`, 24,549 bytes.

- Archive SHA256: `a7aa4620b18c2eebfffbeab4cb623d94f91b4f0371b684b37eacd52ee901dfbe`
- Built/packed `dist/index.mjs` SHA256: `0039755d18125248d78268a266405aded347fa1dfbd8034f2e08e9b5363bb1cb`
- All three changed source/test/Changeset hashes: [source-freeze.json](033-evidence/source-freeze.json)
- All five distribution hashes and archive/build equality: [artifact.json](033-evidence/artifact.json)

The source remains uncommitted. This evidence establishes the executor's implementation checks only; it does not establish a speedup, compatibility matrix completion, external review or integration. Root owns those remaining Plan 033 gates on this exact frozen candidate.
