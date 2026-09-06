# Simplification and correctness plans

Current state: the reviewed source stack, release coverage, corrected compatibility
verifier and watcher decision were integrated at **6eeed0e**; the Salt profile
evidence is now integrated at **2fd034a**. All ten matrix
equivalents pass. [Local integration](025-local-integration.md) records the checks
and preserved files. The disk-cache deprecation proposal and Salt DS profile are
complete. Plan 029's canonical-path reuse passed independent verification, paired
Salt measurements and external review. Its five-file change is integrated and
verified in the main workspace at signed source commit **41b536a**.
Nothing has been pushed or released. Plan 033 passes implementation, correctness,
exact-artifact compatibility and all 24 predeclared samples. Salt cold/edit medians
improve 53–55%. External review passed with no findings. Main source/build checks
pass; unsigned source commit **09039b9** is integrated with the user's explicit
authorization. Persistent signing configuration is unchanged. The related plans
and evidence are consolidated separately. See [033 verification](033-verification.md)
and the [goal completion audit](GOAL-COMPLETION.md).

Plans 017–022/024 and the 025/028 compatibility work are already integrated.
Their implementation/evidence commits are ancestors of the current checkout,
verified again on 2026-09-06. Plan 021's original correctness gaps were addressed
by Plan 022 within its recorded scope; the initially missing external-file case
remains the explicit Plan 023 design gap. Older isolated reports retain their
original outcomes, including the Plan 025 failure later resolved by Plan 028.
Use this index and the latest verification report for current status.

The objective is less repeated work and less independently maintained compiler
state, with fresh metadata. Adding caches, runtime modes, public options, or a
general benchmark framework is not the default solution.

## Recommended order

Current remaining work is tracked in [BACKLOG.md](BACKLOG.md). Plans 017–022/024
are integrated, together with the reviewed 023 decision and 025/028 release checks.
Plan026 is the completed deprecation proposal; implementation remains a later step.
Plan 027's Salt DS profile is complete; Plan 029's implementation, measurements and
external review pass. Main workspace verification passes; signed source commit 41b536a is integrated.
Plan 032's post-029 Salt profile is complete: backend dependency normalization
accounted for roughly 47–50% of weighted samples at that checkpoint. Plan 033
validated and removed this repeated work; its measured and reviewed change is
integrated at 09039b9. The profile itself made no production change.
Later runtime/default/TS7 support decisions remain proposals. The subsequent
user-requested current-nightly prototype timing check is complete in 030.
Storybook's experimental server comparison is complete in 031, with cold output
agreement and a reproduced shared-type freshness failure.

| Plan | Result | Priority | Effort | Risk | Depends on | Status |
| --- | --- | --- | --- | --- | --- | --- |
| [017](017-handle-config-edits-before-backend-startup.md) | Config edits invalidate metadata after a persistent-only startup | P2 | S: hours | LOW | None | DONE — verified at 548a2b6 in isolated worktree; integrated at 6eeed0e |
| [018](018-simplify-and-correct-dependency-tracking.md) | Complete, compiler-consistent dependencies without partial closure caching | P2 | L: several days, three reviewable steps | MED | None | DONE — all checkpoints approved at 1565001 in isolated worktree; integrated at 6eeed0e |
| [019](019-copy-canonical-project-membership.md) | Project snapshots copy already-normalized sets without another cache | P2 | S: hours | LOW | None | DONE — verified at 2f7d6a9 in isolated worktree; integrated at 6eeed0e |
| [020](020-repair-performance-benchmark-accounting.md) | HMR accounting and restart measurements reflect actual work | P2 | M: roughly a day | LOW | None | DONE — verified at c5b97ae in isolated worktree; integrated at 6eeed0e |
| [021](021-decide-persistent-cache-scope.md) | Correctness-gated decision on persistent caching | P3 | M: roughly a day plus bounded sampling | LOW: decision only | 017, 018, 020 | DONE — verified CORRECTNESS_GAP at e698406 in isolated worktree; timings skipped; integrated at 6eeed0e |
| [022](022-fix-cache-freshness-and-type-watches.md) | Validate persistent project membership and observe external type edits | P2 | M | MED | 021 | DONE — verified at 5f448ec; 337 tests, 26 restart checks, four watcher rows; one pre-existing review case deferred to 023; integrated at 6eeed0e |
| [023](023-decide-missing-external-type-watches.md) | Decide bounded support for initially missing external type files | P2 | M | MED | 022 | DONE — decision/evidence at02d8da2; NEEDS_DESIGN, production gap remains open |
| [024](024-measure-corrected-persistent-cache.md) | Measure the retained value of corrected persistent caching | P3 | M | LOW: evidence only | 020, 022 | DONE — SIMPLIFY_OR_DEPRECATE at d6553de; 60 samples, no variance extension; evidence only, integrated at 6eeed0e; 023 remains separate |
| [025](025-integrate-reviewed-stack.md) | Integrate reviewed fixes and verify release coverage | P1 | M | MED | 017–022, 024 | DONE — integrated at6eeed0e; ten matrix equivalents pass; no publish/push |
| [026](026-deprecate-filesystem-cache.md) | Prepare a compatible disk-cache deprecation path | P3 | S proposal / M removal | MED | 022, 024 | DONE — proposal prepared; deprecation/removal not implemented or published |
| [027](027-profile-salt-ds-consumer.md) | Profile a pinned Salt DS core workload | P3 | M | LOW: evidence only | 022, 024 | DONE — 215 targets, six fresh oracles and four CPU profiles; no statistical timing or speedup claim |
| [028](028-isolate-runtime-verifier-events.md) | Isolate compatibility verifier events across Vite versions | P1 | S | LOW | 025 | DONE — ebe8385 integrated at6eeed0e; original assertions retained |
| [029](029-reuse-canonical-dependency-paths.md) | Reuse canonical internal dependency paths | P2 | M | MED | 027 | DONE — 339 tests, ten compatibility rows, 24 processes and external review pass; integrated locally at signed source commit 41b536a |
| [030](030-ts6-ts7-cli-timings.md) | Measure current TypeScript nightly on existing native prototype | P3 | S | LOW: evidence only | None | DONE — nightly 7.1.0-dev.20260905.1; eight paired-run processes, 188 synthetic components, parity and independent audit pass; no production migration |
| [031](031-storybook-experimental-docgen.md) | Test Storybook's experimental docgen server | P3 | S | LOW: evidence only | 030 | DONE — Storybook 10.6.0; cold metadata and ArgTypes agree; bulk extraction measured; shared-type freshness fails in live-server check |
| [032](032-profile-optimized-salt.md) | Profile the optimized Salt workload | P2 | S | LOW: evidence only | 029 | DONE — four CPU profiles, eight full metadata checks and independent audit pass; led to completed Plan 033 |
| [033](033-reuse-backend-canonical-dependencies.md) | Reuse canonical dependency output within the backend | P2 | M | MED | 029, 032 | DONE at unsigned source commit 09039b9 — 343 tests, ten matrix rows and 24 samples pass; 53–55% Salt cold/edit benefit; external review clean; main source/build verified |

The earlier implementation and integration sequence is complete and should not be repeated.
The user selected backlog items 1–4; all four are complete with the stated limits.
The remaining backlog is not a request
to execute the later runtime/default/TS7 proposals.
Status values are TODO, IN PROGRESS, DONE, BLOCKED (with reason), or REJECTED
(with rationale).

## Evidence and important correction to the initial review

The current source has repeated project-path resolution. However, a broader
snapshot-caching plus membership-index optimization was already tried in an
older worktree and deliberately not integrated. Its historical decision was
**INCONCLUSIVE**, not a demonstrated improvement:

- Decision commit: `5163c906efae73f782886e6ecaa7ce7953d9bdbc`.
- Read it with `git show 5163c906efae73f782886e6ecaa7ce7953d9bdbc:docs/project-state-optimization-experiment.md`.
- Candidate: `129d23ee45a85bf751c69820b6667f61d4336ad4`.
- Ten paired samples still had excessive variance. The reported ProjectService
  cold-batch deltas were +1.83% and -4.77%; several other timing rows regressed.
  These are historical report values, not measurements repeated in this review.

Do not resurrect that candidate or promise elapsed-time gains from operation
counts. Plan 019 is deliberately different: fresh array copies, no snapshot
identity contract, no membership indexes, and no invalidation state.

Numbering starts at 017 to preserve the older 001-016 sequence available at
`c7c30afd2ffe929dfa51a4a1618234f93422c3c8:plans/README.md`. Those historical plans
are not restored or marked executable here.

The historical runtime decision also supported ProjectService and a WatchProgram
deprecation window. Retrieve it with
`git show c7c30afd2ffe929dfa51a4a1618234f93422c3c8:docs/typescript-runtime-mode-decision.md`.
The current README preserves legacy as default and ProjectService as a stable
opt-in. These plans honor that choice.

## Historical verification baseline

Observed during this review on Node v24.10.0 and Yarn 4.13.0:

- `yarn typecheck`: exit 0.
- `yarn test run --exclude '**/.yarn/**' --pool=threads --maxWorkers=2`:
  10 files, 257 tests passed. This command excludes nested local worktrees;
  the default fork pool encountered a local `spawn EPERM` restriction.
- `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts packages/vite-plugin-react-docgen-typescript/src/plugin.ts scripts/benchmark-playground.mjs`:
  exit 0, no changes.

These checks belong to the initial plan-writing review. Subsequent implementation,
builds, benchmarks and compatibility verification are recorded in each completed
plan above. Later proposals remain unimplemented unless their status explicitly
records integration.

## Keep, simplify, defer

Keep lazy initialization, TypeScript program reuse, simple in-memory transform
caching, the Vite/backend boundary, runtime-target validation, and HMR lifecycle
tests. They protect concrete behavior. Do not weaken supported TypeScript
`>=4.3 <7`, Node, or Vite ranges as a shortcut.

Simplify repeated canonicalization and partial dependency-closure bookkeeping.
Fix known cache correctness defects before considering faster cache proofs.
Plan 024 measured the corrected persistent-cache path: 60 process samples on
5f448ec support SIMPLIFY_OR_DEPRECATE. Larger-fixture restarts were 20.6–21.7%
slower; React-fixture restarts saved 10.4–11.7%, below the predefined threshold.
Restart HMR was 23.4–68.4% slower across the four comparisons. See
[024 verification](024-verification.md). Keep disk persistence disabled by default
and prepare a compatible simplification/deprecation proposal before removing it.
Do not add shared fingerprint caches or weaken freshness checks on this evidence.

Deferred rather than silently removed:

- WatchProgram removal and experimental-option removal: future breaking-release
  work after the documented deprecation window; no date or release is assumed.
- Making ProjectService the default: separate compatibility/product decision.
- Shared content-hash caching: not planned after Plan 024's negative retention
  result. Reopen only if a concrete consumer workload demonstrates enough benefit
  and profiling identifies repeated hashing as a material cost.
- TS7 native backend, schema redesign, worker protocols, package/release changes:
  outside this simplification effort.
- A separate public cache-key option for parser callbacks: investigate closure
  identity only if the cache-retention decision requires it; do not invent an API.

## Findings considered and rejected

- Another immutable project-state cache and three host membership indexes:
  already inconclusive in Plan 016; no repetition without new evidence.
- Removing the backend interface because it has one implementation: rejected;
  it isolates compiler work and makes lifecycle/caching tests possible.
- Dropping watcher cleanup, revision deduplication, or tests to reduce line
  count: rejected; these protect demonstrated HMR/lifecycle behavior.
- Replacing content hashes with mtime/size-only validation: rejected; this
  would weaken protection against offline same-size/preserved-mtime rewrites.
- Treating existing green tests or a single timing run as proof of correctness
  or performance: rejected; the review reproduced gaps outside current coverage.

The user subsequently authorized items 1–4, including local integration through
Plan025 after verification. Push, issue creation, release, automation changes,
dependency upgrades and deletion of existing worktrees/evidence remain outside scope.
