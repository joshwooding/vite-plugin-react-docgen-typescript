# Plan 025: Integrate the reviewed stack and verify release coverage

Status: DONE — integrated at6eeed0e746242f813b7d5ee57083d67372116d20 after Plan028
completed the10-row compatibility gate. See025-local-integration.md.
Priority P1; effort M; risk MED.
Planned at d6553de853530680b0d959120e3b0f9eeeaf8d33, 2026-09-05.
Depends on completed 017–022 and 024. User explicitly selected backlog items 1–4,
including local integration. Publishing, pushing and releases are not requested.

## Purpose and state
The main checkout D:/OSS/vite-plugin-react-docgen-typescript is on
codex/simplify-changesets-publish at a360aca38a57b33bc1b08913eeff37216991cfa4
with only untracked plans. The reviewed stack ends at d6553de; source last changed
at 5f448ec. It passes 337 tests, 26 restart probes, four actual watcher rows,
build/typecheck. Preserve all prior work and evidence. Plan 023 investigates the
known initially missing external-file watcher gap separately.

README already explains that persisted hits load TypeScript and validate current
membership before avoiding extraction. Existing Changesets warm-cache-config-edits.md
and complete-cyclic-dependencies.md describe earlier fixes, but a release note
must cover Plan 022's newly included declarations/augmentations and registration
of existing external type files. Do not promise creation events for absent files.

## Ownership and scope
Executor creates a new same-basename worktree at:
D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan025/vite-plugin-react-docgen-typescript
branch codex/025-reviewed-stack-release-coverage from exact d6553de.
Only new .changeset/current-cache-membership-and-type-watches.md and, if needed
for an accurate known-limitation statement, README.md may change. Evidence and
small local orchestration scripts may go under plans/025-evidence/** and
plans/025-integration-verification.md. Temporary downloads/build outputs belong
in ignored .yarn/simplification-evidence/025 or an explicitly owned temporary root.
Root owns main plans/index and local fast-forward integration after review.
Do not edit production, harness, CI, existing Changesets, dependencies or lockfiles.
Do not push/publish, change Git configuration, or delete old worktrees.
Freeze/report before committing; root approval required for isolated commit.
One-command git -c commit.gpgsign=false commit is permitted after approval.

## Commands and exact controls
PowerShell login false. Use installed ancestor dependencies without changing them.
Build from the package directory:
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs
Typecheck from worktree root:
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json
Pack with repository Yarn 4.13.0:
node D:/OSS/vite-plugin-react-docgen-typescript/.yarn/releases/yarn-4.13.0.cjs workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out ABSOLUTE_TGZ
Existing packed verifier:
node scripts/verify-runtime-compatibility.mjs --package ABSOLUTE_TGZ --typescript VERSION --vite VERSION --modes COMMA_SEPARATED_MODES
It creates a temp consumer outside cwd, installs with --ignore-scripts --no-audit
--no-fund, and runs metadata/HMR/selectivity/cleanup checks through a real Vite
server for same-project and project-reference layouts. Native watching is disabled
with server.watch:null; events are emitted into Vite's real listeners. This proves
listener/HMR/metadata behavior, not OS event delivery. Investigation found Vite3
does not honor watch:null and can mix native events with explicit emissions;
Plan028 will repair that harness assumption without relaxing its assertions.
Plan022 and025's separate native watcher probes establish the covered OS event cases.
Use EXACT .github/runtime-compatibility-matrix.json's ten rows/modes. Eight are
Linux, two Windows; Node 20.19.5 or 24, TS4.3.5/4.9.5/5.0.4/5.4.5/5.9.3/6.0.3,
Vite3.2.11/4.5.14/5.4.21/6.1.0/7.2.4/8.1.5. Read each row, do not guess modes.
Current Windows Node is C:/nvm4w/nodejs/node.exe v24.10.0. WSL Ubuntu exists;
wsl --list --quiet succeeds with escalation. Docker is not on PATH.
Use isolated portable official Node distributions if exact Node20 is absent.
Do not use nvm use or change the user's active runtime. Verify downloaded archives
against official SHA256 checksums and execute only from owned temporary locations.
Inspect WSL's existing runtime first. Record its actual OS; WSL Ubuntu is a local
Linux equivalent, not a claim that GitHub ubuntu-latest ran.
No GitHub push just to trigger CI. Record any unavailable environment honestly.

## Steps and gates
1. Verify base, branch and empty production diff. Add the scoped patch Changeset,
and optional precise existing-file versus missing-file limitation in README.
Report diff; this is release coverage, not a runtime feature or deprecation change.
2. Build, typecheck and pack. Capture source SHA, archive SHA256, dist identity
and verifier hash. Use one identical archive on all ten rows, with verified copies.
3. Run the ten existing rows using exact specified runtime families and modes,
saving JSON/stdout/stderr, actual Node/OS/version identities, command and outcomes.
At most two verifier rows concurrently; coordinate CPU-heavy checks with root
because item 4's timing cannot run concurrently. Package downloads/temporary
installs needed for these checks are in the user's authorized local task scope.
4. Validate actual outputs, not exit codes alone: requested modes, topology,
fresh metadata, Vite listener/hot-channel delivery, selective affected modules and teardown
must match the existing verifier's contract. Capture failures without masking them.
If a supported row fails, diagnose source/tooling before proposing any scoped fix;
do not weaken the verifier, skip a row silently, or expand peer ranges.
5. Freeze evidence/doc diff and report to root. Root independently reviews archive
identity, a representative Windows/Linux boundary check, output assertions and
scope. Existing source reviews remain applicable because runtime is unchanged;
do not re-send already reviewed whole stack solely for docs/evidence.
6. Commit after root approval. Root then checks clean main ancestry/untracked
collision safety and performs authorized fast-forward integration, preserving
untracked plans, then records the integrated SHA. Executor must not move main.

## Done and stop conditions
Release note accurately covers Plan022; production/harness/CI/dependencies remain
identical; build/typecheck/pack and ten matrix equivalents pass with exact artifact
provenance. Full337 suite need not rerun for docs-only changes unless a real source
change is separately approved. If environment blocks a row, finish available
checks and report exact blocker; never label unrun GitHub CI as passed.
STOP for out-of-scope source changes, stale metadata, unsupported environment
substitution, unsafe path cleanup or source/artifact drift. Read original source
when judging failures. No external review upload, messages or release actions
are part of this evidence/docs-only executor.
