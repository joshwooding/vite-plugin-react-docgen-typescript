# Plan 025: reviewed stack release coverage and compatibility

Status: **STOPPED — integration gate failed**. Nine of ten local matrix equivalents passed; the supported Windows lower-bound row hangs in deprecated WatchProgram mode after recreating a missing dependency in a referenced project. No production code was changed, and nothing was integrated, pushed, or published by this executor.

## Artifact and scope

- Base: `d6553de853530680b0d959120e3b0f9eeeaf8d33`, branch `codex/025-reviewed-stack-release-coverage`.
- Source last changed at `5f448ec8d596854eace55f59faa669193d187310`. All 47 source files are byte-identical to the initial Plan 025 capture, as are all five built distribution files.
- Packed archive SHA256: `fc258456dbee71ae641d605216025b6af399261c1a3b2528e2b63c90ec724b21`.
- Built `dist/index.mjs` SHA256: `8446e4c027f8f3506117209a857d6d55f30687db40a627351f4ab4f7f9390f5f`.
- Unchanged runtime verifier SHA256: `40451bfd7f18dccfc8e510d370033c79f0ecaafdcabbdbbe5b500dae679d4d94`.
- Full per-file source/dist identities and lockfile/matrix hashes: [artifact.json](025-evidence/artifact.json).

The only release-facing edits are a patch Changeset covering current-program cache validation and existing external type watches, plus the README's precise initially missing external-file limitation. Production code, the benchmark, the runtime verifier, CI, existing Changesets, package manifests and lockfile remain unchanged.

## Build and packaging

Using the existing ancestor dependencies, package `unbuild` succeeded and TypeScript 6.0.2 alias typechecking passed. Yarn 4.13.0 packed the built package once into ignored `.yarn/simplification-evidence/025/reviewed-stack.tgz`; every matrix row read that identical archive, including through WSL's `/mnt/d` mount. Each successful install was independently checked against all five expected distribution file hashes before verifier cleanup.

Commands, from the isolated worktree unless noted:

```powershell
# From packages/vite-plugin-react-docgen-typescript:
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/unbuild/dist/cli.mjs
# From the worktree root:
node D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript6/bin/tsc6 --noEmit -p packages/vite-plugin-react-docgen-typescript/tsconfig.json
node D:/OSS/vite-plugin-react-docgen-typescript/.yarn/releases/yarn-4.13.0.cjs workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out ABSOLUTE_TGZ
node plans/025-evidence/record-artifact.mjs ABSOLUTE_TGZ
```

The existing 337-test source suite was not repeated for these documentation/evidence changes. Scoped evidence-script Biome checks and `git diff --check` passed. The build reported an existing outdated Browserslist database notice; no dependencies were changed.

## Matrix results

Rows and modes are taken exactly from `.github/runtime-compatibility-matrix.json`. The Linux environment was Ubuntu 22.04.3 under WSL2, not a run of GitHub `ubuntu-latest`. Windows was the local Windows installation, not GitHub `windows-latest`. Node 24 means actual version 24.10.0. Node 20 means exact version 20.19.5. Portable official runtime archive checksums and URLs are recorded in [runtime-downloads.json](025-evidence/runtime-downloads.json). The user's active runtime was not switched.

| Row | Local OS | Node | TypeScript | Vite | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | WSL Linux | 20.19.5 | 4.3.5 | 3.2.11 | PASS |
| 2 | WSL Linux | 20.19.5 | 4.9.5 | 4.5.14 | PASS |
| 3 | WSL Linux | 20.19.5 | 5.0.4 | 5.4.21 | PASS |
| 4 | WSL Linux | 20.19.5 | 5.4.5 | 6.1.0 | PASS |
| 5 | WSL Linux | 20.19.5 | 5.9.3 | 7.2.4 | PASS |
| 6 | WSL Linux | 24.10.0 | 6.0.3 | 8.1.5 | PASS |
| 7 | WSL Linux | 20.19.5 | 4.3.5 | 8.1.5 | PASS |
| 8 | WSL Linux | 20.19.5 | 6.0.3 | 3.2.11 | PASS |
| 9 | Windows | 20.19.5 | 4.3.5 | 3.2.11 | FAIL: watch-mode recreation/teardown timeout |
| 10 | Windows | 24.10.0 | 6.0.3 | 8.1.5 | PASS |

The nine complete rows cover 64 mode/topology combinations, 128 imported-type edits and 192 create/delete/recreate deliveries. All complete rows require fresh semantic metadata, exact affected-module delivery, no unrelated delivery for the asserted phases, and zero residual filesystem watcher handles. Requested and actual installed TypeScript/Vite versions match. npm resolved `react-docgen-typescript` 2.4.0 through the published `^2.2.2` dependency range; local source testing used installed 2.2.2. Both identities are explicit, not conflated.

Root independently reran the unchanged Linux upper row and confirmed all five modes, both topologies and zero watcher handles; its [raw result](025-evidence/diagnostics/reviewer-linux-upper.txt) is retained. A final aggregate check also verified the installed TypeScript/Vite versions and all five distribution hashes for **all ten** installations, including the failing Windows row.

The runtime verifier requests disabled OS watching with `server.watch: null` and explicitly emits Vite watcher events. Current Vite honors the null setting, but installed Vite 3.2.11 still unconditionally creates a Chokidar watcher after spreading that setting into its options. Older-version runs can therefore receive incidental native events as well as the explicit emissions. The verifier exercises real Vite listener and hot-channel delivery, but **does not prove OS filesystem event delivery**. Plan 022's four separate real watcher rows supply the existing-file OS-event evidence. The initially missing external-file limitation remains Plan 023's separate scope.

All raw records, commands, actual Node/OS identities, installed versions and stdout/stderr are in [025-evidence/rows](025-evidence/rows). `run-row.mjs` checks OS/runtime, archive and verifier hashes, installed distribution hashes, exact requested modes, both topologies and cleanup. Its `observe-install.mjs` reads the npm installation before the unchanged verifier deletes its temporary consumer; it returns the original spawn result unchanged. It also preserves ignored Vite package sources for Plan 023's independent API inspection.

## Windows failure diagnosis

The unchanged verifier's row 9 first reported `experimental-watch/project-reference server close exceeded 10 seconds`. Root's independent complete lower-row rerun reproduced the same failure; its [original log](025-evidence/diagnostics/reviewer-windows-lower.txt) is retained. A diagnostic copy added only a catch that logs and rethrows the original topology error before its existing finally block. It reproduced with `--modes experimental-watch` and the same Node 20.19.5, TypeScript 4.3.5, Vite 3.2.11 and packed artifact:

```text
ORIGINAL_TOPOLOGY_ERROR experimental-watch/project-reference:
  recreated missing-dependency transform exceeded 10 seconds
experimental-watch/project-reference server close exceeded 10 seconds
```

The diagnostic script's SHA256 was `c3cfda8d429ef2603b3115d6316b94a2a49a48cce7f8bcb0bc21ce7282f88fef`. Its three-line logging-only [patch](025-evidence/diagnostics/log-original-error.patch) and [stderr](025-evidence/diagnostics/diagnostic-windows-lower-stderr.txt) are retained. No assertion, timeout, mode, fixture or cleanup condition was relaxed. The diagnostic is evidence of failure, not a passing compatibility row.

Source inspection suggests two connected issues to investigate: the recreated transform can wait for a pending TypeScript WatchProgram update; plugin teardown waits for hook work before backend disposal, while backend disposal is what settles pending watch updates. This is a diagnosis hypothesis, not a source fix or proven attribution to a particular stack commit. The supported-row failure blocks claiming the ten-row integration gate complete.

Root requested a baseline comparison. An isolated detached checkout of `a360aca38a57b33bc1b08913eeff37216991cfa4` was built and packed using the same ancestor dependencies. The baseline verifier is byte-identical to the reviewed verifier. Baseline archive SHA256 was `be1e6da0cc821140551c05b66f36445ea7b58b47a3c57f73b3f499a84181f9e8`; complete source/dist identity is retained in [baseline-artifact.json](025-evidence/diagnostics/baseline-artifact.json). The same logging-only diagnostic with `--modes experimental-watch` passed both topologies, all metadata/delivery assertions, and zero watcher handles on that baseline. Its [stdout](025-evidence/diagnostics/diagnostic-baseline-stdout.txt) is retained. This supports an interaction introduced by the stack under this harness, but does not yet separate a runtime regression from the old-Vite native/explicit-event mixture.

A second ignored diagnostic, requested by root, isolated incidental native events by replacing only `watch: null` with `watch: { ignored: () => true }`, retaining the original-error log and every assertion. Vite 3 supports this Chokidar option, so explicit listener emissions remain active while native path watching is suppressed. The reviewed archive then **passed** both `experimental-watch` topologies, all metadata/delivery assertions and zero watcher handles. Its [patch](025-evidence/diagnostics/ignore-native-events.patch) and [stdout](025-evidence/diagnostics/diagnostic-ignore-native-stdout.txt) are retained. This is diagnostic evidence, not a replacement pass for required row 9. It points to the mixture of native and explicit events as necessary to the observed failure; distinguishing a duplicate-event verifier defect from a production race requires separately scoped work.

The second diagnostic script SHA256 was `e48e8fcebf26051d2f0d67d028a5bcba0856f48784f84ad0a1c782df9c489a06`.

Finally, root requested a bounded **native-only** Windows lower-bound probe using an external referenced dependency that exists at startup. [native-lower.mjs](025-evidence/native-lower.mjs) installs the exact reviewed artifact, verifies TypeScript 4.3.5, Vite 3.2.11, `react-docgen-typescript` 2.4.0 and every distribution hash, then runs deprecated WatchProgram on Node 20.19.5. It waits for actual watcher registration plus 150 ms, performs edit → delete → recreate → edit, observes native events and hot-channel delivery, and requests the transformed component normally. It makes no synthetic watcher emissions, manual module invalidations or direct HMR-hook calls.

That native-only probe **passed** all four phases with fresh union metadata, exactly one dependent hot update per phase, no unrelated updates/reloads/errors, and zero remaining watcher handles. Recreation produced native `change` followed by `add`; both were recorded and processing completed. [native-lower.json](025-evidence/diagnostics/native-lower.json) preserves the exact script hash, installed versions, events, payloads and semantic results. This strengthens the evidence that the deterministic explicit-emission verifier should suppress incidental native events on Vite 3. It does not prove every possible WatchProgram event ordering safe, and it does not exercise initially absent external files or recreation without the stated registration grace.

Root independently repeated the same native-only probe and confirmed PASS for all four phases, fresh metadata, expected native events, and zero watcher handles. That separate [reviewer result](025-evidence/diagnostics/reviewer-native/native-lower.json) is preserved alongside the executor's original result.

The native-only probe's scoped Biome check reported one unused `existsSync` import warning; it did not affect execution. Its tested bytes are preserved exactly to retain the recorded script identity.

Initial loader/PATH/WSL setup failures are retained separately under [setup-attempts](025-evidence/rows/setup-attempts/README.md); they are not package runtime failures. No retry replaced or erased the actual row 9 failure.

## Reproduction

After building/packing and recording artifact identity, invoke one row with its exact platform and Node runtime:

```text
NODE_EXECUTABLE plans/025-evidence/run-row.mjs ZERO_BASED_MATRIX_ROW ABSOLUTE_TGZ
```

The runner invokes the unchanged verifier with the matrix's exact TypeScript, Vite and modes and saves raw outputs. On Linux, prepend the selected portable Node `bin` directory to a native Linux PATH so the verifier's npm invocation uses the same runtime. Run at most two rows concurrently. Keep consumer performance timings separate from these checks.

Do not overwrite an earlier row's evidence when investigating a failure: preserve it in a distinct audit directory first.

Recommended next scope: make the existing explicit-emission verifier suppress native events consistently across supported Vite versions, and preserve an original topology error when teardown also fails. Keep all metadata, delivery, mode and cleanup assertions intact. Re-run the exact ten-row matrix on the same archive after reviewing that narrow verifier correction. The passing native-only probe does not justify changing production WatchProgram lifecycle ordering in this plan.
