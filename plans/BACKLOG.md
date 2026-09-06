# Remaining work

Updated 2026-09-06. Priorities reflect completed verification, known bugs and
measured results. New items are proposals; existing plans retain their recorded
status and scope.

Current runtime checkpoint: 09039b9f32bab728b2418b24e74636f93703b998 on
codex/simplify-changesets-publish. Plans 017–022/024, release coverage, the 028
verifier correction, 023 decision and 027 profile evidence are integrated locally.
No push/release occurred.
The selected items 1–4 are complete with their stated scope: item 2 is a
NEEDS_DESIGN decision with an open production gap; item 3 is a proposal, with no
shipped deprecation; item 4 is a CPU profile investigation, with no speedup claim.
The selected [Plan 029](029-reuse-canonical-dependency-paths.md) is implemented and
independently verified from 2fd034a. Salt measurements meet its declared benefit
rule and external review passed with no findings. The change is integrated and
verified in the main workspace at signed source commit 41b536a.
The follow-up [Plan 032](032-profile-optimized-salt.md) is complete. Four fresh CPU
profiles and eight full metadata checks identified the backend's final dependency
normalization as roughly 47–50% of sampled work at the post-029 checkpoint. The selected
[Plan 033](033-reuse-backend-canonical-dependencies.md) is complete and reuses that
canonical output. Correctness, exact-artifact compatibility and all 24
measurement samples pass; Salt cold/edit medians improve 53–55%. External review
is clean. Main source/build checks pass; unsigned source commit 09039b9 is integrated
with explicit user authorization and unchanged persistent signing configuration.
See [033 verification](033-verification.md).
Graph narrowing remains a separate design investigation.

The user subsequently selected [Plan 034](034-document-explicit-external-type-watches.md):
a tested consumer-local Vite configuration recipe for an explicit existing type
directory. It is reviewed and integrated at unsigned local source commit
653e203: 29 tests and eight native boundary executions/40 mutations pass, with
no external-review findings. See [034 verification](034-verification.md). This
adds no package option or automatic parent watches and does not close the general
Plan 023 discovery gap.

## Prioritized list

| # | Work | Status | Completion target |
| --- | --- | --- | --- |
| 1 | Integrate the reviewed fixes and prepare release coverage | DONE at6eeed0e; all10 matrix equivalents, independent boundary/native checks, build/typecheck | Locally integrated; no push/release requested |
| 2 | Handle external type files created after startup | DONE decision at02d8da2; NEEDS_DESIGN, production gap remains | Independent repeats confirm exact candidates unreliable and parent watches broaden unrelated scope |
| 3 | Plan filesystem-cache simplification/deprecation | DONE: Plan026 prepared; nothing deprecated or removed yet | Compatible docs/types notice first; removal only after a published notice window and a later breaking-release decision |
| 4 | Profile remaining startup/HMR cost on a representative consumer | DONE: Plan 027, pinned Salt DS core, 215 targets and 221 components | Six fresh oracles and four CPU profiles pass; repeated physical-path resolution is the first measured optimization candidate |
| 5 | Finish the deprecated WatchProgram/experimental-option cleanup | Later; release/deprecation decision required | Remove old flags/runtime only after the documented compatibility window, with migration guidance and lifecycle/parity coverage |
| 6 | Decide whether ProjectService should become the default | Later; separate product/compatibility decision | Compare supported workloads and release behavior, retain an explicit legacy fallback, and justify any default change |
| 7 | Revisit native TS7 support | Current-nightly prototype timing check complete; production support still gated | See 030: current nightly runs the old experimental backend on a synthetic fixture; stable API, real-consumer parity, HMR and packaging gates remain |
| 8 | Reuse already-canonical dependency paths internally | DONE at signed source commit 41b536a | Both Salt modes meet the benefit rule; 339 tests, ten compatibility rows, external review and main workspace verification pass |
| 9 | Profile the optimized Salt workload | DONE: Plan 032; four profiles and independent audit | Backend output pass removed in completed 033; smaller candidates deferred and watcher checks retained as detailed below |
| 10 | Reuse the backend's canonical dependency output | DONE: Plan 033 at unsigned source commit 09039b9 | Canonical/lifecycle proof, 343 tests, ten matrix rows and 24 samples pass; 53–55% Salt cold/edit benefit. External review clean; main source/build and committed bytes verified |
| 11 | Document explicit external type directory watching | DONE: Plan 034 at unsigned source commit 653e203 | Existing Vite configuration, 29 tests, eight native rows/40 mutations and clean external review; automatic discovery remains open |

## Scope and evidence

**1 — Integration and release coverage.** Effort S–M; risk MED. Source work from
017, 018, 019, 020 and 022 is already implemented; 021 and 024 contain investigation
evidence. Do not reimplement it or describe 021's superseded stale behavior as the
current candidate. The historical 022/024 checkpoint passed 337 tests, 26 restart
checkpoints and four real watcher rows, plus build/typecheck and local reviews. See
[022 verification](022-verification.md) and [024 verification](024-verification.md).
All ten combinations in .github/runtime-compatibility-matrix.json now pass on
the exact packed artifact, covering TypeScript 4.3–6, Vite 3–8 and Linux/Windows.
Plan 028 corrects simulated-event isolation in the verifier; separate native
watcher probes retain real delivery coverage. The final Changeset and README
include Plan 022 and the unresolved Plan 023 limitation. See
[local integration](025-local-integration.md) for the final evidence.
Plan 029 passed 339 tests and its own exact-artifact compatibility checks; see
[029 verification](029-verification.md). The latest source checkpoint, Plan 033,
separately passed 343 tests and all ten exact-artifact compatibility rows; its
[verification report](033-verification.md) records the current artifact.

**2 — Missing external files.** Effort M; risk MED. A component can start with
an unresolved relative type import outside the Vite root. Creating that file later
can leave metadata stale with either cache setting. Edits to existing external
files are fixed; this is the remaining case. [Plan 023](023-decide-missing-external-type-watches.md)
contains the reproduction, failed attempted fix, exact base and bounded decision
steps. Its recorded drift check covered the evaluated stack. Registering every
missing candidate or recursively watching a parent is not an established fix.
The [completed decision](023-missing-external-type-watch-decision.md) gives two
explicit entry choices: a supported upstream multiple-basename/nonrecursive
watcher contract, or consumer-owned opt-in external directories. Choose the
contract before implementation. A follow-up must deliver multiple-missing-import
and alternate-extension coverage, native supported-version/OS delivery, unrelated
watch-scope accounting, delete/recreate and awaited shutdown. For opt-in
directories, specify missing-parent and ignored-directory behavior. Preserve the
known limitation and current restart guidance until a bounded solution passes;
repeating the failed exact-candidate prototype is not a new fix.

**3 — Disk persistence.** Effort S for a proposal, M for implementation; risk MED
because the option is public. [Plan 024](024-measure-corrected-persistent-cache.md)
found no tested workload meeting the retention rule on historical source
5f448ec, before the 029/033 runtime changes. Keep fileSystemCache's
existing default false. Plan an explicit deprecation/removal sequence rather than
silently ignoring the option. Keep in-memory caching and TypeScript program reuse.
A decision to remove the option has not yet been implemented or announced.
The requested [compatible proposal](026-deprecate-filesystem-cache.md) is prepared.
It retains working configurations during a documented release window and separates
later removal from the current task.
Before using present performance to decide retention/removal, freeze the final
post-033-decision artifact and perform the proposal's evidence-freshness gate
with the existing corrected off/populate/restart benchmark and correctness
controls. Keep the old report unchanged. A compatible notice may instead cite
024 explicitly as historical evidence for a maintenance-policy choice; it must
not present those ratios as current. Stage A's docs/JSDoc/patch Changeset and
packed-declaration checks are already specified. Stage B requires an actual
published compatible notice release, a separately chosen breaking release and
review of consumer reliance; neither deprecation nor removal has shipped here.

**4 — Historical performance attribution.** The completed pre-029
[Salt profile](027-salt-ds-profile.md) covers all 215 non-test core TSX targets
and 221 components on TS 6.0.3. Native realpath accounts for 75.14–75.97% of
weighted self samples across both stable modes' cold/shared phases. Source and
caller analysis show repeated normalization of already-canonical dependencies.
Both edits affect all 215 targets while changing only 7/33 metadata outputs;
Salt's shared module augmentation imports through the core barrel, so reducing
that breadth needs a separate correctness-sensitive design. The deeply nested
Windows/junction setup limits generalization. No statistical timing samples,
backend ranking or speedup claim follow from the four CPU profiles.

**8 — Canonical-path reuse.** Effort M; risk MED. Plan 029 removes
redundant internal normalization while keeping physical-path normalization at
Vite, compiler and disk boundaries. It adds no global path cache or new public
option. The isolated candidate passes 339 tests, all ten supported-version matrix
rows and affected native/restart checks. All 24 planned Salt/small-control
processes pass. Salt startup/edit medians improve by roughly 63–65%; the smaller
control improves startup by 4–7% and edits by 13–33%. These direct-plugin Windows
results preserve all metadata and affected targets; warm/close comparisons remain
inconclusive. External review passed with no findings. The main workspace contains
the reviewed change and its rebuilt distribution matches the tested artifact;
signed source commit 41b536a completes local integration. See [verification](029-verification.md)
for the exact artifacts, checks and review result.

**9–10 — Post-029 profiling candidates.** [Plan 032](032-profile-optimized-salt.md)
classifies the remaining work below. These percentages describe weighted native
samples in the fixed Windows/junction workload, not removable elapsed-time cost.

| Candidate | Disposition and next gate |
| --- | --- |
| Final backend dependency normalization, 46.92–49.69% at post-029 baseline | DONE in Plan 033 at 09039b9; canonical success/error/cache-validation and alias/lifecycle proof, correctness, compatibility, measurement and review gates passed before integration |
| Immediate membership normalization under syncFiles, 0.21–0.28% | Defer as negligible in these profiles; no separate implementation or experiment justified now |
| Relative-candidate physical resolution, 2.56–2.78% | Defer: this includes necessary missing-path work, while the proposed existence-first shortcut affects only a subset; require isolated evidence of useful avoidable cost before reopening |
| watchFiles existence checks, 24.00–25.26% | Retain: missing-path registration, persistent entries and native external delete/recreate contracts still require protection; no retained already-watched cache is justified by these samples |
| Conservative 215-target dependency breadth | Design required: characterize augmentations/globals, merged declarations, re-exports, cycles and consecutive effective edits with complete fresh metadata oracles and a conservative fallback; 7/33 changed outputs do not prove the other dependencies irrelevant |

**5–6 — Runtime cleanup and defaults.** Effort M each; compatibility risk MED.
The candidate README already deprecates EXPERIMENTAL_useWatchProgram and
EXPERIMENTAL_useProjectService, while keeping them functional for this release.
docgenMode: "project-service" is a stable opt-in; legacy is still default.
Retiring old flags and changing the default are separate decisions. Neither
follows automatically from the disk-cache results.

For removal, first record the actual published notice version and chosen breaking
release boundary; local deprecation text alone does not establish an elapsed
compatibility window. Deliver an old-option/runtime inventory, migration and
JavaScript rejection behavior, while retaining stable-mode lifecycle/parity and
packed compatibility coverage. For a default change, first choose representative
supported workloads and predeclare acceptance criteria on one current artifact;
compare startup, edits and close, including referenced projects and regressions.
Deliver a reasoned decision, migration and explicit legacy rollback. Keep the
current defaults and flags until those separate decisions are made.

**7 — TS7.** Effort S for the API feasibility check, potentially L/HIGH risk for
a new backend. The candidate package declares TypeScript >=4.3 <7; README's
TypeScript compatibility section requires a stable programmatic project API or
documented batched high-level checker before reconsidering the native experiment.
The test at src/__tests__/typescriptCompatibility.test.ts:162 verifies controlled
rejection of the installed TS7 module. A TS7 CLI beside a TS6 docgen dependency
still runs docgen on TS6.

The subsequent user-requested [030 nightly check](030-ts6-ts7-cli-timings.md)
installed `typescript@next` separately as **7.1.0-dev.20260905.1**. The old native
prototype runs through its unstable API. Four paired runs on 188 synthetic
components across seven projects gave 43.87% lower cold total and 40.68% lower mean
shared-edit time versus TS6 project-service in that same prototype. All eight
final normalized outputs matched. These are actual native docgen results, not
CLI-only times, Salt DS results, or a Plan 029 comparison. The nightly's root
export still lacks the legacy compiler API. The current plugin was not migrated;
the separate production-support decision and real-consumer compatibility gates
remain open.

Reopen production work when the API entry gate is met or an explicit new
feasibility question is selected, not merely because another nightly exists.
Deliver a bounded API/ownership decision, then real-consumer parity on the current
plugin baseline, selective native HMR/deletion/recreation, shutdown, packed
compatibility and declared performance checks before a peer-range change.
The completed synthetic comparison does not need repetition to close this plan.

The user-requested [Storybook experimental docgen check](031-storybook-experimental-docgen.md)
is also complete. Storybook 10.6.0 uses TS6 in this test. Its 188-component bulk
extraction median was 2.59 s, compared with 2.18 s for the TS6 prototype and 1.26 s
for native TS7. Cold metadata and ArgTypes matched. The real feature server returned
stale imported shared-type metadata even after explicit re-extraction; that
reproduction needs investigation before treating this path as equivalent for live
updates. Neither real-consumer performance nor browser startup was measured.

The next deliverable, if selected, is a minimal reproduction from the existing
live-server fixture that identifies the invalidation owner/cause. Require an
effective imported shared-type edit, an independent fresh oracle and freshness
through the ordinary running service before timing edits or proposing adoption.
Preserve the cold results and failing reproduction; no repeated cold comparison,
upstream issue submission or production integration is implied by this plan.

## Keep off the active list

- Another persistent hash cache, snapshot identity cache, membership index, or
  worker protocol without measured benefit.
- mtime/size-only validation or restoring backend-free stale-hit shortcuts.
- Broad external directory watching without the Plan 023 scope/cost decision.
- Automatic backend-default changes, unsupported peer-range expansion, or removal
  of compatibility/lifecycle tests to make the code shorter.
- Repeating completed experiments without changed inputs or a new decision;
  the explicitly gated current-artifact persistence revalidation is separate
  from Plan 024's preserved historical result.

This is the current record for the completed selected work, including Plan 033, not a
new whole-repository audit. Plan025's release matrix, Plan023's watcher probes and
Plan027's consumer investigation are tracked separately. Deferred entry gates do
not authorize their implementation. No push or release has been requested.
