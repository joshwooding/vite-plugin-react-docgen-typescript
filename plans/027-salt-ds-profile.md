# Salt DS core consumer profile

Status: CPU profile investigation complete and independently reviewed. Repeated physical-path normalization is the clearest next optimization. All six fresh semantic oracles and both full HMR profile sequences pass. No statistical timing capture was run.

The consumer is the public [Salt DS repository](https://github.com/jpmorganchase/salt-ds/tree/2e1da8e4fbc398b2a7dfffbd357feedf222f7e07), pinned at `2e1da8e4fbc398b2a7dfffbd357feedf222f7e07`. Its core package is 1.70.0. The root LICENSE and core package license are Apache-2.0; the root package.json separately declares MIT. No upstream component source, generated icon collection or node_modules is committed here.

## Workload and toolchain

All 215 non-test TSX files beneath `packages/core/src` are transform targets. Stories, tests and generated icon TSX files are excluded as targets. Real icon/style/window source and real React/FloatingUI dependencies remain available to the compiler. Corrected-config baseline extraction found 201 metadata-bearing files containing 221 components, with full semantic parity across both modes.

The plugin remains the reviewed `5f448ec` source on evidence-only base `d6553de`. It uses installed TypeScript 6.0.3, react-docgen-typescript 2.2.2 and Vite 8.1.5. Salt consumer dependencies use React 18.3.1 and @types/react 18.3.31, with exact direct pins selected from Salt's committed lockfile. The small isolated npm install has lifecycle scripts disabled. Its package manifest and complete lockfile are in `027-evidence/consumer-package*.json`. The consumer's Vite 8.2.0 supplies type declarations; it is not the running plugin's Vite runtime. Salt's native TypeScript CLI is not used. This is not a TS7 benchmark.

The parser uses the plugin's default prop filtering and `shouldExtractLiteralValuesFromEnum: true`. Persistence is disabled in both stable modes. No claim about persistent-cache performance on Salt follows from this profile.

## Findings

Four separate phase profiles were collected in two untimed processes: cold and shared-type HMR for legacy/default, then cold and shared-type HMR for ProjectService. They consistently identify synchronous physical-path work as the dominant sampled activity.

| Mode | Phase | Native realpath self samples | Nearest resolvePhysicalPath caller | Nearest watchFiles caller |
| --- | --- | ---: | ---: | ---: |
| Default | Cold | 75.46% | 81.27% | 10.01% |
| Default | Shared-type HMR | 75.40% | 81.35% | 9.89% |
| ProjectService | Cold | 75.14% | 80.82% | 9.85% |
| ProjectService | Shared-type HMR | 75.97% | 82.15% | 9.95% |

These are time-delta-weighted V8 samples. The realpath self samples are included in the resolvePhysicalPath caller attribution; the columns are not additive. The nearest watchFiles samples are mostly existence checks. Native existsSync accounts for 9.10–9.23% across the four phase profiles. Direct TypeScript compiler frames account for 1.52–2.69%, and parser frames for 0.69–0.84%; these self-frame shares are not comprehensive causal allocations of all compiler/parser work.

The caller-aware summary retains native frames with blank source URLs and traces them to their nearest plugin/parser ancestor. The main realpath call chains run through `watchFiles`, `analyze`, `trackModuleDependencies`, and `collectUnresolvedRelativeDependencies`. Watch registration, reverse-dependency tracking and unresolved-import checking normalize arrays already canonicalized by analyze. Each profile re-transforms all 215 targets for both edits, while the fresh oracles show that the documentation edit changes 7 outputs and the shared type edit changes 33.

The report does not rank backends, estimate a speedup, or present medians/MAD. One instrumented sequence per backend supports bottleneck diagnosis; paired unprofiled before/after measurements should accompany the candidate fix.

## Proposed follow-ups

1. **Reuse canonical paths at the existing internal boundaries.** The backend normalizes each successful AnalyzeResult dependency list at `legacyBackend.ts:1503` (and the error result at 1538), while project snapshots copy canonical sets at 1041. `plugin.ts:93`, 203 and 221 normalize those paths again in unresolved-import checking, reverse-dependency tracking and watch registration. The native stacks corroborate this repeated work. Make that existing contract explicit, keep deduplication/ordering where required, and reuse canonical arrays internally. Preserve normalization for raw IDs, aliases, genuinely new/missing paths and decoded persisted inputs. A process-wide realpath cache is unnecessary and would add symlink/invalidation risks. The next experiment is Plan 029: verify canonical-boundary/alias/missing-path regressions and full Salt metadata, then run paired unprofiled measurements and recount the relevant native calls. No savings are claimed before that experiment.

2. **Investigate the breadth of ambient dependencies only as a later correctness-sensitive design.** Salt's `packages/core/src/registerClassNameInjection.ts:1` imports seven prop types through the core barrel and declares an augmentation of `@salt-ds/styles` at line 16; `packages/core/src/index.ts:56` exports that augmentation. The plugin's `isSharedAmbientSourceFile` (`legacyBackend.ts:463`) recognizes string-literal module augmentations, and `collectTrackedFileDependencies` seeds each closure with shared ambient inputs (`legacyBackend.ts:734`) before following imports/exports. This explains a path from every component through the augmentation and the barrel to the rest of core. The observed 215 affected targets are conservative dependency coverage, not proof of a bug. Any narrowing experiment must retain effective augmentations, unrelated ambient/global edits and cycles and compare all metadata against fresh oracles. Dropping ambient inputs to improve this profile would weaken correctness.

The remaining watchFiles existence-check cost is a useful later re-profile target after canonical-path reuse. This investigation does not propose a new watch cache or change deletion/recreation behavior.

## Compiler configuration and setup gate

Both modes select the same `packages/core/tsconfig.json`. Its original base options, include (`src/**/*`) and exclude (`**/__tests__/*`) remain intact. A temporary `compilerOptions.paths` maps the four real core/icons/styles/window workspace package names to their pinned source indexes. This substitutes source resolution for absent built `dist-types` declarations, not invented declarations. Original core config bytes are preserved under the ignored `original-configs` directory. Exact selected-config hashes are recorded in every workload identity.

The consumer has real workspace junctions as well as isolated external dependencies. No component or type source is changed for setup. Single-target parser-provider diagnostics confirm identical selected config, 401 roots, 1,190 actual Program files, and real workspace resolution in both modes. A separate TS6 compiler preflight reports zero errors and 1,180 Program files.

An earlier setup incorrectly validated only a broader root overlay. ProjectService selected Salt's nearest core config and could not resolve icons/styles/window; 8 core outputs omitted inherited icon color/size props. The full metadata parity gate caught this before timings. Normal workspace links alone still lacked the advertised built declarations. Historical summaries and raw metadata are preserved under `027-evidence/audit/missing-workspace-links` and the ignored raw audit directory. Untimed `diagnose-project.mjs` reports show the actual selected Programs before and after correction. Neither component source nor prop expectations was weakened to pass the gate.

## Effective edits and timing definition

The component edit appends a documentation marker to existing `ButtonProps.disabled`. The shared edit adds `profilePending` to the existing `ValidationStatuses` interface; `ValidationStatus = keyof ValidationStatuses` feeds actual Banner.status, Dialog.status and StatusIndicator.status props, among others. Fresh separate-process oracles cover baseline, documentation edit, and documentation-plus-shared edit for both modes. All output metadata is compared, including changes outside the named sentinels. Both executed profile sequences restore the edits under nested finally blocks.

The driver directly invokes plugin hooks. Cold measures plugin construction/configuration plus 215 first transforms; initial plugin import and source preloading are excluded. Warm measures the same 215 transforms in the same instance. Each HMR cycle measures the hook, affected-module accounting and transforms for affected targets; the entire accumulated semantic output must equal its fresh oracle. No manual browser transport or actual filesystem watcher-delivery latency is measured.

The raw driver records phase boundaries and incidental durations for reproducibility. `pluginSessionTotalMs` is the sum of cold, warm, component HMR, shared-type HMR and awaited close. `harnessElapsedMs` separately includes verification and edit/setup intervals. Oracle checks, installation, clone, source identity hashing and restoration are outside individual phase intervals. Cold asserts that TypeScript/parser modules were not loaded beforehand. Warm output fully matches its fresh oracle; this profile does not instrument extraction counts or use its single-run durations for a performance comparison.

The original proposal called for five independent processes per mode, alternating order, with one extension to ten if cold/HMR/session MAD exceeded 20%. After the first reviewed profile located the native filesystem bottleneck, root narrowed this item to the user's consumer-profiling question. ProjectService then corroborated the ownership finding. The statistical matrix was skipped before any official sample started; no successful statistical samples were discarded or replaced. Prepared but unexecuted matrix/statistics scripts are archived only under the ignored `audit/unrun-timing-design` directory and are not shipped as maintained tooling. This scope decision avoids spending a backend-comparison benchmark on a question already answered by profiles and preserves paired timing for an actual candidate fix.

Separate V8 inspector sessions cover cold and shared-type HMR within each untimed mode process. Four complete profiles remain under the ignored raw directory with SHA-256 hashes and phase boundaries in `027-evidence/profiles`. `profile-summary.json` contains self-frame ownership, nearest-caller attribution and native filesystem call chains. Each profile process restored both source edits and passed source/config/build identity checks through awaited close. The original compiler config is preserved; its documented temporary source-path adaptation remains available for reproduction.

## Reproduction

Run from this isolated worktree, using a disposable consumer clone under `.yarn/simplification-evidence/027/salt-ds`. Clone the public repository and check out the exact pinned SHA. On Windows, the long nested path requires a one-command `git -c core.longpaths=true` override. Do not run Salt's root install/build/release scripts.

1. Build the unchanged plugin with the repository's installed unbuild CLI from its package directory.
2. Run `node plans/027-evidence/setup.mjs`; copy the retained consumer lockfile to the ignored dependency directory as `package-lock.json`, then `npm ci --prefix .yarn/simplification-evidence/027/consumer-dependencies --ignore-scripts --no-audit --no-fund --workspaces=false`. Run setup again to create junctions and the temporary core config.
3. Run `preflight.mjs`, then `diagnose-project.mjs <mode> selected-core-config` for both modes. These diagnostics deliberately preload TypeScript and are untimed.
4. Run `oracle.mjs <mode> <baseline|component|shared>` sequentially for all six combinations, then `verify-oracles.mjs`. Preserve failed outputs before changing setup. No concurrent operation may mutate this clone.
5. After review and an idle-machine gate, run `driver.mjs <mode> profile-both both` sequentially for each mode, then `profile-summary.mjs`. Each untimed process separately starts/stops the profiler around cold and shared-type HMR, producing distinct phase files. Profiles live under the owned ignored raw directory, with compact reports in evidence. Preserve existing successful reports/profiles before deliberately reproducing them; the current collected evidence should not be overwritten casually.

## Verification

Full core TypeScript preflight: zero errors. Six independent baseline/effective-edit oracles: complete backend parity. Two full profile sequences: baseline, same-instance warm reuse, component HMR and shared-type HMR all match their fresh semantic oracles. The actual shared verification helpers reject stale metadata and mismatched source identity. Both HMR edits are restored after each process, and the four-package Salt source hash remains `03a0ac52590092e999c3ba04e70b572d9402dd7150de244830f6b55ee92d0b69`.

Plugin source/build/lockfiles are unchanged. Evidence scripts pass Node syntax checks; CPU summaries are deterministically recomputed from all four hash-verified raw profiles. Unused timing scripts remain only in a contained ignored audit directory. No production suite rerun was required for this evidence-only investigation; the integrated runtime/build was independently confirmed to match the measured implementation. No runtime change, release, push or upload is part of this profile.

Independent root review verified all four raw profile hashes and weighted native/nearest-caller shares, the complete edited metadata hashes and 215 affected targets, current Salt source/config restoration, cold compiler guards and built-output hashes. Integrated source content matches the measured worktree modulo LF/CRLF differences; the Git runtime diff is empty and built output is identical.

This profile covers one pinned design system's core source on this Windows host with a documented source-resolution adaptation. The deeply nested worktree and junction setup may amplify physical-filesystem costs. A shallow-path reproduction and another-host profile are needed before generalizing the magnitude of this bottleneck. It does not measure Salt's whole Storybook startup, browser latency, generated-icon transforms, production bundling, another consumer, or TS7.
