# Plan 021: Persistent cache decision

**Verdict: CORRECTNESS_GAP.** New global declarations and module augmentations created while the server is stopped produce stale metadata on a persistent-cache restart in both stable modes. Independently, edits to a type-only declaration outside the Vite root are not delivered by the real Vite watcher in the tested topology, after either fresh or cache-only startup. No performance sampling is valid until these correctness gaps are addressed.

This completes the decision-only investigation through the predefined correctness-gap route. It does not recommend broader adoption, remove the supported feature, change its opt-in default, or announce deprecation.

## Evaluated inputs and controls

Evaluated source: **c5b97ae5e1ed33e350c8f4d3a8da77077aa2caf2**, the reviewed result of the prerequisite chain including plans 017–020. The worktree was created at that exact commit on codex/021-persistent-cache-decision, under .yarn/.codex-worktrees/plan021/vite-plugin-react-docgen-typescript. The required scoped drift command returned no changes. Evidence-only commits may advance this branch; the source under investigation remains the evaluated commit.

| Input | Observed value |
| --- | --- |
| Node | 24.10.0 |
| OS | Windows, release 10.0.26340, x64 |
| Runtime TypeScript | 6.0.3 |
| Typecheck alias typescript6 | 6.0.2 |
| Vite | 8.1.5 |
| react-docgen-typescript | 2.2.2 |
| React / @types/react | 18.3.1 / 18.2.25 |
| yarn.lock SHA-256 | 782c9e80e0789b79ecf721c60b38587fabf1d26eccb636e87471469fd530d9c4 |
| Built index.mjs SHA-256 | e3880cadf8d26a3b864bbc94526f7e8ff3db0e6ce1c0d8aae1342c5298a506da |

The [machine-readable summary](021-evidence/summary.json) also retains source and benchmark fingerprints. Dependencies were resolved from the ancestor installation; no install or dependency change was performed.

The isolated build passed. Typecheck passed for the executor and independently for the advisor. The advisor ran the prescribed full suite once: **309 tests across 11 files passed**, exit 0, 108.84 seconds. Its provenance is the advisor's task tool output, not a fabricated on-disk log. The real React fixture smoke passed separately in both modes, with zero compiler diagnostics and the installed @types/react/index.d.ts; the existing benchmark validator confirmed inherited disabled: boolean and the imported intent union. Commands and provenance are recorded in [controls.json](021-evidence/controls.json) and [fixture-results.json](021-evidence/fixture-results.json).

The suite left a status-only snapshot modification. Its normalized working blob and HEAD blob both equaled be29172562fb6497b81d0a554e96f3ae0b311aac, and its content diff was empty. Only that identical index artifact was refreshed. No production or snapshot content changes belong to this decision.

## Restart freshness evidence

[verify-restart-cases.mjs](021-evidence/verify-restart-cases.mjs) creates disposable fixtures. Every seed, cached restart and fresh cache-disabled oracle runs in a separate Node process at identical paths. Each seed closes before the mutation/restart. Comparison retains semantic metadata: display name, description, and sorted props with name, requiredness, type, description and default value. Temporary paths and declaration locations are excluded. Every mutation must change the oracle; an ineffective mutation is an investigation error, not a successful invalidation test.

| Restart case | Default (legacy) | ProjectService |
| --- | --- | --- |
| Unchanged | PASS; persistent hit observed | PASS; persistent hit observed |
| Imported type edit | PASS | PASS |
| Config edit (paths target) | PASS | PASS |
| Existing ambient declaration edit | PASS | PASS |
| New global declaration | **STALE_METADATA** | **STALE_METADATA** |
| New module augmentation | **STALE_METADATA** | **STALE_METADATA** |
| Previously unresolved import created | PASS | PASS |
| Dependency deleted | PASS | PASS |
| Dependency recreated | PASS | PASS |
| Same-size rewrite with exactly preserved mtime | PASS | PASS |

These are **20 checkpoints: 16 passing and 4 stale**. [restart-results.json](021-evidence/restart-results.json) retains per-process IDs, same-path checks, original/cached/oracle metadata, mutation observations and cache entry counts.

The two failure shapes are distinct:

1. The initial global interface has label: string. While stopped, a new included .d.ts declares the same interface with added: boolean. The cached restart still emits only label; the fresh oracle emits added and label.
2. The component imports Props from an existing module. While stopped, a new included .d.ts imports that module and augments its Props interface with added: boolean. The cached restart still emits only label; the fresh oracle emits both props.

All four failed restarts take the persistent-hit branch, as observed through its config addWatchFile registration in the direct probe. The unchanged controls also observe that branch. This observation is specific to the evaluated implementation; it is not a newly added public diagnostic API.

The preserved-mtime case first assigns a whole-second timestamp before seeding, rewrites string to the equal-length number, restores that timestamp, and requires exact equality of both size and mtimeMs. The final results satisfy equality in both modes. This demonstrates content-hash invalidation for that edit, rather than relying on timestamp rounding.

## Real Vite watcher evidence

[verify-vite-watcher.mjs](021-evidence/verify-vite-watcher.mjs) starts real Vite servers with native watching enabled. The Vite root is a fixture's app directory; app/src/Component.tsx imports types from sibling shared/types.d.ts, which is included in TypeScript configuration and allowed for filesystem access. The server loads the component through transformRequest. The probe observes plugin transformations, watch registrations and Vite hot-update hooks but never calls a hot-update hook, emits a watcher event, adds the external file to the watcher, or invalidates a module itself.

An ordinary in-root JavaScript module is requested first. The probe waits until that file appears in getWatched, then edits it and requires a real change event. It next edits the external declaration from label: string to label: number, observes a bounded five-second window, and requests the unchanged component again. A separate cache-disabled process at the same paths confirms the new number metadata.

| Mode / startup | In-root change events | External events / hot hooks | Returned label type | Fresh oracle |
| --- | --- | --- | --- | --- |
| Default / fresh, cache off | 1 | 0 / 0 | string | number |
| Default / persistent-only | 1 | 0 / 0 | string | number |
| ProjectService / fresh, cache off | 1 | 0 / 0 | string | number |
| ProjectService / persistent-only | 1 | 0 / 0 | string | number |

Each positive control also reached Vite's hot-update hooks (two observations per control; environment attribution was not recorded). All four external files were absent from the initial watched-file inventory, and all four component responses remained unchanged with one plugin transform. [watcher-results.json](021-evidence/watcher-results.json) records these separately from metadata classification.

The persistent-only rows were seeded by another real-Vite process at the same paths; each seed produced one persisted entry and closed. On restart, config-watch registration identified the persistent-hit branch and the TypeScript CommonJS entry remained absent from require.cache after the initial transform. It was present after fresh transforms. Alongside the source's early-return branch, this establishes the cache-only startup used in these observations. It is a read-only runtime observation, not timing instrumentation.

This is a demonstrated Vite delivery gap in this Windows/Vite 8 topology, including with persistence disabled. It is separate from the offline-new-root cache gap. The five-second absence is bounded evidence, not a claim about every OS, host watcher, linked-package layout or browser transport. No browser-HMR timing was measured.

The first watcher attempt raced initial watcher registration for ProjectService, so its failed positive control was rejected as fixture setup evidence. After adding the registration wait, the complete four-row matrix was rerun and all positive controls passed. No production code was changed to make the watcher test pass.

## Timings and predefined decision rules

Both stable benchmark modes were in scope: default maps to docgenMode legacy; ProjectService maps to docgenMode project-service. The benchmark's existing mode flag has the same runtime mapping. The planned scenarios were large-project at scale 1, with its action-component marker edit, and react-typing at scale 1, with installed React declarations, the inherited disabled prop and imported intent union. The planned states were cache off, populate and independently seeded restart.

**Every one of the 12 scenario/mode/cache rows is SKIPPED_CORRECTNESS_GAP**, with zero samples and null metrics in the [summary](021-evidence/summary.json). No timing runner or hash/read-attribution diagnostic was created or invoked. Seed-entry counts in correctness reports are control observations, not measurements of benchmark storage cost.

The rules were fixed before investigation: any stale metadata means CORRECTNESS_GAP. Otherwise five independent-process samples per row would be required; MAD above 20% of median permits one extension to ten, after which persistent excess variance means INCONCLUSIVE. KEEP requires at least 20% and 100 ms median restart cold saving in a realistic workload, plus no same-workload material HMR regression (over 10% and over 10 ms). Otherwise the route is SIMPLIFY_OR_DEPRECATE for maintainers. A correctness gap takes precedence over those speed thresholds.

Cold batch would mean plugin setup plus the first transform batch, excluding Node launch and fixture preparation. Same-instance warm transforms, affected direct-plugin HMR, and session-through-close would remain distinct. Population overhead would be populate-session median minus off-session median. Fixed-workload break-even would be ceil(max(0, population overhead) / restart session saving) only for positive restart session saving.

There are no measured medians, MADs, population costs, restart savings, break-even restarts, benchmark cache bytes/file counts, or retained-memory values here. Null means unavailable. No performance conclusion is inferred from source operation counts, the green suite, the original persistence-disabled benchmark, or historical snapshot-cache experiments.

## Explanation and next bounded action

The source's persistent proof hashes previously recorded config and dependency files, while its unresolved-candidate checks cover known missing resolutions. A new ambient root can alter the program without changing any of those files or candidates. Successful proof validation therefore cannot establish that the current ambient/project membership matches the seeded program. The failed cases demonstrate this omission; it is not inferred solely from code inspection.

The next bounded action is a **correctness and simplification plan**, with two separately verified deliverables:

1. Establish live watch coverage for external type dependencies discovered by both fresh analysis and cached proofs. The smallest candidate is to register those dependencies with the Vite watch mechanism, preserve reverse dependency invalidation, and promote the real-edit positive-control/oracle cases into focused regression coverage. Creation/deletion and missing-directory watch semantics require explicit decisions. This fixes event delivery; it does not repair offline ambient membership.
2. Decide how persistent entries will prove project/ambient membership before accepting a hit. Compare the following choices against disabling persistence, before proposing adoption or new optimization.

| Candidate | Structural cost estimate, not a measurement | Effect on startup benefit / unresolved questions |
| --- | --- | --- |
| Validate a canonical membership inventory once per startup | Enumerate relevant project roots and ambient discovery locations; retain a seeded membership baseline and versioned proof/schema. Work grows with enumerated directory entries and member names. | Could retain backend-free parsing only if membership discovery faithfully matches compiler behavior. Config inheritance/references, include/exclude, typeRoots/package discovery, path identity and conditional resolution need defined coverage. Reusing TypeScript configuration APIs may itself load the compiler. |
| Validate membership once through the existing backend | Reuse its project-resolution machinery and current tracked/configured member sets, plus a persisted baseline/schema for comparison. Current initialization loads TypeScript/RDT and creates the selected program/service. | Removes the current backend-free startup benefit. Merely initializing the backend cannot compare current membership with a baseline absent from today's dependency-only proof. Which complete membership set is exposed at initialization versus after analysis remains an API question. |
| Disable persistence in affected usage while retaining supported opt-in configuration | Avoid filesystem proof, population and restart validation work; retain ordinary runtime analysis and memory caching. | Forfeits all potential persistent-hit savings. Correctness of the independent external watcher gap still needs its own fix. This record changes no option or default. |

The preferred starting proposal for that follow-up is to reuse existing backend membership discovery, persist a complete membership baseline, and conservatively reject old or unsupported proofs. Accept the loss of backend-free startup, then measure whether avoiding repeated extraction still provides worthwhile savings. Proving that the discovered membership set is complete is a prerequisite; if completeness cannot be established, disable or reject persistence for that case. Defer a separate membership-inventory implementation until evidence justifies it. This is a proposal for later work, not authorization to change runtime behavior.

Known file hashing currently occurs separately per component when proofs are created and validated. That source fact explains maintenance and I/O obligations, but no numeric cost or speed estimate was collected. Do not add a content-hash cache to rescue an unproven design. After a bounded correctness choice is implemented and verified, any renewed persistent-cache performance proposal must cite this record and rerun the complete freshness prerequisites before the unchanged sampling rules.

## Reproduction and completion

From the isolated worktree, after the documented build:

~~~text
node plans/021-evidence/verify-fixture.mjs
node plans/021-evidence/verify-restart-cases.mjs
node plans/021-evidence/verify-vite-watcher.mjs
node plans/021-evidence/summarize.mjs
git diff --check
~~~

The two correctness probes intentionally exit 1 after writing their complete reports when stale metadata is found. The summary exits 0 only when the required rows, semantic comparisons, positive controls, process/path separation, exactly preserved mtime, identities and reproducible gap route validate. It rejects missing/duplicate rows and verifies evaluated-source ancestry and unchanged source/build/lockfile content, so an evidence-only commit does not invalidate reproduction. Disposable fixtures are removed only after absolute containment checks; raw manifests and child outputs remain under ignored .yarn/simplification-evidence/021/.

Step 1 controls and prerequisite checks passed. Step 2 completed all required restart and real-Vite cases. Step 3 was skipped by the correctness rule. Step 4 produced the validated gap summary and complete skipped timing matrix. Step 5 produced this decision for independent advisor review; the advisor owns plan/index updates. No true STOP condition remains: valid freshness failures complete the specified investigation route.
