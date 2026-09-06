# Plan 020 verification

Status: DONE, 2026-09-05. Clean isolated commit
`c5b97ae5e1ed33e350c8f4d3a8da77077aa2caf2` —
`Repair benchmark accounting and restart coverage`. Unsigned, not merged or pushed.

Base: `2f7d6a9aaaf600d1fa310ce47e6f372a6cc03a0a`.
Branch: `codex/020-repair-performance-benchmarks`.
Worktree: `D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan020/vite-plugin-react-docgen-typescript`.
Initial frozen benchmark SHA256:
`6d7f8c3cb311ecad4926eae8469801ce69266f7b727b0be49f91e0ca1c8310bf`.

Observed environment: Windows, Node v24.10.0, plugin 0.8.0, TypeScript 6.0.3,
react-docgen-typescript 2.2.2, React 18.3.1, @types/react 18.2.25 and Vite 8.1.5.

## Scope and initial verification

Eight files: the benchmark script, its new focused test, five compact React
fixture files, and the stale `benchmark:playground` package-script correction.
No production plugin, dependency, lockfile, public option or existing fixture
semantics changed. Runtime timings are direct-plugin measurements, not browser
HMR or whole application startup.

The executor first demonstrated eight failures against the old harness behavior,
then passed all 19 focused tests. The advisor read the complete diff and tests,
independently passed the full suite (308 tests, 11 files, 108.17s), typecheck,
scoped Biome, build and whitespace checks. Build reported the existing stale
Browserslist dataset notice; no dependency update was attempted.

Concrete local binary commands, run in the implementation worktree:

```sh
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/vitest/vitest.mjs run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/@biomejs/biome/bin/biome ci scripts/benchmark-playground.mjs scripts/__tests__/benchmark-playground.test.ts benchmarks/fixtures/react-typing package.json
git diff --check
```

Build command, from the worktree's package directory:
`node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs`.
Biome checks seven files; the existing configuration excludes `package.json`.

## CLI smoke evidence

Both executor and advisor independently ran each command below with one
iteration. Every process exited 0 and every HMR status was `updated`.
Advisor output paths are relative to the worktree:

```sh
node scripts/benchmark-playground.mjs --scenario large-project --iterations 1 --modes default,projectService --cache off --output .yarn/simplification-evidence/reviewer-large-project-off.json
node scripts/benchmark-playground.mjs --scenario large-project --iterations 1 --modes default,projectService --cache populate --output .yarn/simplification-evidence/reviewer-large-project-populate.json
node scripts/benchmark-playground.mjs --scenario large-project --iterations 1 --modes default,projectService --cache restart --output .yarn/simplification-evidence/reviewer-large-project-restart.json
node scripts/benchmark-playground.mjs --scenario react-typing --iterations 1 --modes default,projectService --cache off --output .yarn/simplification-evidence/reviewer-react-typing-off.json
node scripts/benchmark-playground.mjs --scenario react-typing --iterations 1 --modes default,projectService --cache populate --output .yarn/simplification-evidence/reviewer-react-typing-populate.json
node scripts/benchmark-playground.mjs --scenario react-typing --iterations 1 --modes default,projectService --cache restart --output .yarn/simplification-evidence/reviewer-react-typing-restart.json
node scripts/benchmark-playground.mjs --scenario playground --iterations 1 --modes watch --output .yarn/simplification-evidence/reviewer-playground-watch.json
```

| Scenario | Modes | Affected components per mode | Initial/final cache entries: off, populate, restart |
| --- | --- | --- | --- |
| large-project | default, projectService | 9 | 0/0, 0/16, 16/16 |
| react-typing | default, projectService | 2 | 0/0, 0/3, 3/3 |
| playground | watch | 3 | 0/0 (off) |

The advisor audited all seven JSON reports (13 mode/state cases): schema 2,
matching frozen benchmark hash, correct process-first labels, distinct seed
and measurement process IDs, zero React compiler diagnostics from separate
validation processes, populated restart caches, and no disabled-cache writes.
All React batches validated inherited boolean `disabled` from installed React
declarations and the imported `primary | quiet` union for every component.

Executor negative subprocess probes each exited 1 with their expected errors:
unresolved React imports, a local JSX shim, an old baseline schema, stale
metadata and teardown rejection. Compact results are in the worktree's
`.yarn/simplification-evidence/negative-checks.json`.

These one-iteration runs prove harness behavior only. No runtime speedup,
population overhead or cache-retention recommendation is established here.
Plan 021 remains a separate investigation.

## Review correction and final verification

The initial structured review found no actionable issues (confidence 0.91),
recorded in `020-autoreview.json`. The advisor independently reproduced a
directory-alias failure: the plugin's physical returned path did not match a
lexical workspace path, so the harness incorrectly rejected fresh HMR metadata.

One scoped revision canonicalizes existing module paths and retains lexical
fallback for virtual or missing IDs. Its new directory-link regression failed
before the fix and passed afterward. The advisor's separate temporary-junction
probe also changed from a stale-metadata failure to `PASS`, with one correctly
selected component. No production runtime code changed.

Final benchmark SHA256:
`98dcc2e368f784dd67572bd80223913534deb864fa541e287390e635b0c1a0c7`.
The executor passed all 20 focused tests, typecheck, lint and whitespace. The
advisor independently passed the final full suite (309 tests, 11 files, 99.90s),
typecheck, scoped lint and whitespace. The package build is unchanged by the
benchmark-only correction and its earlier independent build passed.

The final smoke commands repeat the seven commands above with output names
prefixed `reviewer-final-` instead of `reviewer-`, preserving earlier evidence.
All seven processes exited 0. The advisor's final report audit passed all
13 cases against the final benchmark hash, with the same affected counts and
cache states shown above.

The user explicitly approved Plan 020's review and scoped follow-up reviews
after automatic approval review identified the earlier authorization as
Plan 018 only. Final review uses the same structured helper and Codex engine,
with `--mode local --json-output .../plans/020-autoreview-round2.json` and
scope context describing the independently reproduced path correction.
Both actual review invocations used
`python C:/Users/Joshu/.agents/skills/autoreview/scripts/autoreview --mode local --engine codex`
with the respective JSON output paths and scoped `--prompt` text. The default
engine configuration was gpt-5.6-sol with high reasoning.

The follow-up helper exited 1 with one finding: allegedly late WatchProgram
invalidations during the first transform. The advisor rejected it after
checking the actual unchanged runtime, rather than adding an unnecessary
invalidation-draining loop:

- `src/plugin.ts:497-513` awaits `update.ready` before completing the logical
  update and returning the accumulated affected files.
- `src/plugin.ts:911-937` awaits that update, then returns affected modules.
  The project-reset branch also performs its explicit invalidations before
  the hook returns. This is the only production `invalidateModule` call;
  `transform` does not flush queued module-graph invalidations.
- The existing `backendContract.test.ts:1497` test deliberately controls pending
  completions and asserts the returned affected modules with no explicit
  invalidations. It passed again independently: 1 passed, 31 skipped, 507ms.
- The exact claimed real scenario also passed: `node scripts/benchmark-playground.mjs
  --scenario react-typing --iterations 1 --modes watch --cache off --output
  .yarn/simplification-evidence/reviewer-final-react-typing-watch.json` exited 0,
  reported 2 affected components, 0 explicit invalidations and fresh metadata.

No accepted actionable review findings remain. The first automated review was
clean; the final automated finding is retained verbatim in its JSON report
alongside this evidence-backed rejection. No extra review was run merely to
obtain a clean label. The final verification comprises the 309-test full suite,
the 13-case matrix, the targeted WatchProgram case and the independent alias
reproduction.

The advisor independently verified the final commit contains exactly the eight
scoped files, the worktree is clean and the benchmark hash remains the final
hash above. The main checkout remains at `a360aca` with only the untracked
plan records. Snapshot content was unchanged throughout; its normalized blob
matched HEAD (`be29172562fb6497b81d0a554e96f3ae0b311aac`). No plan, raw smoke
report, review report, build output or snapshot change entered the source commit.
