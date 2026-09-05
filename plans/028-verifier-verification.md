# Plan 028: consistent isolation for simulated compatibility events

Status: **REVIEWED AND VERIFIED; root approved the scoped commit.** All ten
local compatibility matrix equivalents pass with the corrected verifier and the
identical Plan 025 package archive. No plugin implementation changed.

## Correction and preserved scope

Base: `ef1b87f16ecd0ac5aba763bf4b49b1e527c4f73c`, branch
`codex/028-isolate-runtime-verifier-events`. The script change has eight added
lines and one removed line: use `server.watch: { ignored: () => true }`, explain
why, and log/rethrow the original topology error before the existing `finally`
closes the server. Every fixture, runtime mode, deadline, semantic assertion,
hot-channel delivery/selectivity check and teardown condition is unchanged.

The verifier explicitly emits `add`/`change`/`unlink`. Vite 3.2.11 spreads
`server.watch: null` into options and still creates Chokidar, allowing real events
to mix with the script's emissions. The public ignored predicate suppresses
native path observation consistently while preserving real Vite listeners and
the explicit emissions. The original-error log prevents a later close timeout
from hiding the first failure in diagnostics; close errors still fail the run.

Installed Vite 3.2.11, 4.5.14, 5.4.21, 6.1.0, 7.2.4 and 8.1.5 all declare an
`ignored` matcher that accepts a boolean-returning function. Their option
resolution preserves that function in the ignored matcher array.
[watcher-support.json](028-evidence/watcher-support.json) records the exact
declaration lines, source excerpts and full-file SHA256 values, captured with
[record-watcher-support.mjs](028-evidence/record-watcher-support.mjs). This uses
public watcher configuration; the verifier does not depend on private watcher
methods or new plugin behavior.

## Artifact identity

- Package source last changed at `5f448ec8d596854eace55f59faa669193d187310`.
- Archive SHA256: `fc258456dbee71ae641d605216025b6af399261c1a3b2528e2b63c90ec724b21`.
- Corrected verifier SHA256: `8241f94751ae0b833d59c26e3a2c33c0b12e63dfe2f5708b68239db4aef155f1`.
- Unchanged built `dist/index.mjs`: `8446e4c027f8f3506117209a857d6d55f30687db40a627351f4ab4f7f9390f5f`.

[artifact.json](028-evidence/artifact.json) records all 47 unchanged source-file
hashes, all five distribution hashes, the matrix and lockfile. No package was
rebuilt or repacked. Each row's read-only install observer checks the exact
installed distribution against the Plan 025 artifact before the verifier deletes
its temporary consumer. The observer returns subprocess results unchanged.
`react-docgen-typescript` resolves to 2.4.0 through the package's published
`^2.2.2` range; this is distinct from the local 2.2.2 source-suite installation.

## Matrix results

These are local equivalents of the exact ten unchanged CI matrix entries and
modes. They ran on Windows 11 Pro x64 and Ubuntu 22.04.3 x64 under WSL2, not
GitHub-hosted runners. The exact actual host and runtime details are in each row.
Official portable Node runtimes from Plan 025 were reused; no global runtime or
Git configuration was changed.

| Row | Local host | Node | TypeScript | Vite | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | WSL Linux | 20.19.5 | 4.3.5 | 3.2.11 | PASS |
| 2 | WSL Linux | 20.19.5 | 4.9.5 | 4.5.14 | PASS |
| 3 | WSL Linux | 20.19.5 | 5.0.4 | 5.4.21 | PASS |
| 4 | WSL Linux | 20.19.5 | 5.4.5 | 6.1.0 | PASS |
| 5 | WSL Linux | 20.19.5 | 5.9.3 | 7.2.4 | PASS |
| 6 | WSL Linux | 24.10.0 | 6.0.3 | 8.1.5 | PASS |
| 7 | WSL Linux | 20.19.5 | 4.3.5 | 8.1.5 | PASS |
| 8 | WSL Linux | 20.19.5 | 6.0.3 | 3.2.11 | PASS |
| 9 | Windows | 20.19.5 | 4.3.5 | 3.2.11 | PASS |
| 10 | Windows | 24.10.0 | 6.0.3 | 8.1.5 | PASS |

Executor order was 9, 10, then 1–8, one row at a time. Root independently ran
Windows lower and Linux upper in the other permitted slot. No executor matrix
attempt failed or was repeated. All 72 mode/topology combinations pass, covering
144 imported-type edits and 216 create/delete/recreate delivery checks. Each
row ends with zero filesystem watcher handles. Every installed TS/Vite version
and distribution file hash matches the requested identity; stderr is empty.
[Raw rows](028-evidence/rows), [aggregate counts](028-evidence/summary.json), and
root's separate [Windows](028-evidence/reviewer/windows-lower.txt) and
[Linux](028-evidence/reviewer/linux-upper.txt) outputs are retained.

Node syntax checking, scoped Biome checks and `git diff --check` pass. The full
337-test production suite was not repeated for this test-only correction. An
initial Biome command used an unexpanded PowerShell glob and processed no files;
the final invocation names each file explicitly. A final read-only identity
capture encountered sandbox `spawnSync git EPERM` and passed when rerun with
scoped escalation. Root's first Windows launch failed before execution because
the output directory did not exist; its one actual verification passed after
creating the directory. These setup issues are not package failures.

## Limits and earlier evidence

Plan 025's original nine passes and Windows lower failure remain preserved and
unchanged. The isolated verifier now completes the previously failed integration
gate. It verifies real Vite listener/hot-channel behavior with **simulated watcher
events**, not native OS event delivery.

Native-only Windows lower-bound proof remains separate in
[Plan 025](025-integration-verification.md): executor and root each passed an
existing external dependency's edit/delete/recreate/edit sequence, fresh union
metadata, selective updates and zero handles. Those probes wait for watcher
registration plus 150 ms; they do not prove every possible WatchProgram event
ordering safe. Plan 022's native watcher tests are additional existing-file
coverage. Initially missing external files remain Plan 023's separate design
issue. No parent-watching change or production lifecycle claim is introduced.

## Reproduction

Use the same archive and an exact platform/runtime from the matrix:

```text
NODE_EXECUTABLE plans/028-evidence/run-row.mjs ZERO_BASED_MATRIX_ROW ABSOLUTE_TGZ
```

The row runner refuses to overwrite existing attempts. Preserve the complete old
row record and its installed/stdout/stderr companions in a separate audit
directory before an intentional rerun. On Linux, prepend the chosen portable
Node `bin` directory to a native Linux PATH so npm uses that same Node runtime.
Run at most two verification jobs concurrently and keep performance timing
separate. `record-artifact.mjs ABSOLUTE_TGZ` checks unchanged source and archive
identity before refreshing the local capture. New checkouts may normalize line
endings; byte-hash differences require an explicit identity explanation, never
silently editing old results.
