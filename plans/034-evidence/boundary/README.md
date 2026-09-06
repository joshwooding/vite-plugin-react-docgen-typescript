# Plan 034 native boundary proof

Result: **PASS**, 2026-09-06. Eight sequential cache-disabled native executions
pass all forty dependency mutation checkpoints. This establishes the documented
consumer-owned directory recipe on the tested boundary stacks; it does not fix
automatic missing-file discovery or establish native Vite 4–7 execution.

| Actual environment | Node | Vite | TypeScript | Legacy | Project service |
| --- | --- | --- | --- | --- | --- |
| Windows, kernel 10.0.26340 | 20.19.5 | 3.2.11 | 4.3.5 | PASS, 5/5 | PASS, 5/5 |
| Windows, kernel 10.0.26340 | 24.10.0 | 8.1.5 | 6.0.3 | PASS, 5/5 | PASS, 5/5 |
| Ubuntu under WSL2, kernel 6.18.40.1-microsoft-standard-WSL2 | 20.19.5 | 3.2.11 | 4.3.5 | PASS, 5/5 | PASS, 5/5 |
| Ubuntu under WSL2, kernel 6.18.40.1-microsoft-standard-WSL2 | 24.10.0 | 8.1.5 | 6.0.3 | PASS, 5/5 | PASS, 5/5 |

Both dependency families pin react-docgen-typescript 2.2.2 and glob 13.0.6.
Linux fixtures are below `/var/tmp/vite-rdt-plan034-boundary`, on the Linux
filesystem, and Windows fixtures are in the owned ignored Plan034 boundary
directory. Disposable environments and fixtures are preserved for inspection.
No runtime source, public API, dependency manifest, lockfile, tests or docs outside
this boundary evidence directory were changed by this subtask.

## Exact runtime and probe identity

The existing 033 archive was installed directly:

- Archive SHA-256: `a7aa4620b18c2eebfffbeab4cb623d94f91b4f0371b684b37eacd52ee901dfbe`.
- Final native probe SHA-256: `74b528a732cd25486080a95e18a7a3a9ad10d31dd3a1f3e3830aa3700bdb2823`.
- Launcher SHA-256: `8bfd4881a140c9afc8e36fbf5263e42bde32ebb86f2fda95bfeecc12739f59a0`.
- Setup script SHA-256: `9163c0c9f3fc7eda5b10369d10079195e9413b7c1b2bc9c4095fe0b3a8b035d1`.

Each native result contains the Node binary SHA-256, direct dependency
package.json hashes, disposable package-lock hash, all five installed distribution
hashes and the script hash. The five distribution files match
`plans/033-evidence/compatibility/artifact.json` before each run and remain
unchanged after it. The imported package entry is its asserted
`exports["."].import` value, `./dist/index.mjs`.

## What the rows prove

The consumer-local plugin uses `apply: "serve"`, validates the existing directory
with `statSync(...).isDirectory()` in `config()`, then calls only
`server.watcher.add(normalizePath(directory))` in `configureServer()`. Every row
records one validation and one registration, with zero preceding plugin
transforms. No watcher options or `server.fs.allow` are changed.

Each row loads two components whose relative external imports are initially
missing and an unrelated component. It proves native in-root delivery and the
explicit directory's registration before mutations. The five mutations are:

1. Create `first.d.ts`, affecting only First.
2. Create the different basename `second.ts`, affecting only Second.
3. Edit the first declaration, affecting only First.
4. Delete the first declaration, affecting only First.
5. Recreate it, affecting only First.

Each mutation receives a real add/change/unlink event and ordinary forwarded HMR
payloads. The delivered path set must equal the expected component path exactly;
the other missing-import component is excluded as well as Other. Full reloads and
error payloads fail the row. Payload observation continues through metadata
comparison and a bounded settling period; duplicate transport paths remain in
the raw results.

Initial metadata and every mutation are compared to fresh cache-disabled
extraction in a separate Node process at the same fixture paths: forty-eight
independent oracle processes total. Comparison retains component descriptions,
display names and complete prop semantic fields: name, description, required,
type and defaultValue. Expected type/required/description/default values are also
asserted independently for each creation/edit/recreation, and deletion must remove
the prop. Each intended change must be effective in the oracle, while both
unaffected components must remain identical.

All rows observe an owned nested text-file change with no HMR delivery and an
unrelated sibling text-file change with no watcher event or HMR delivery. The
public watcher census after registration contains five fixture-local directories
and ten entries, including ordinary parent bookkeeping; no unrelated sibling
descendants appear. These are tracked-scope counts, not native handle counts or
performance measurements. New TypeScript project-membership changes are outside
this text-noise selectivity claim.

All eight awaited closes report `closed: true`, zero tracked directories, zero
post-close watcher events and zero post-close payloads after writes. All eight
probe processes exit normally with code zero, without timeout or forced shutdown.
No private watcher API, manual HMR emission, graph invalidation or replacement
watcher is used. The oracle's direct plugin calls are independent reference
extraction, not a repair of the observed live server.

## Results and commands

The successful result set is
[rows-import-entry-corrected/summary-all.json](rows-import-entry-corrected/summary-all.json).
Each row has a semantic/native report and an `.execution.json` with the exact
Windows or Ubuntu command, stdout, stderr, exit code and launcher/probe hashes.
The row reports also preserve exact child-oracle commands and results.

From `D:/OSS/vite-plugin-react-docgen-typescript`, with no concurrent native tests:

```powershell
python plans/034-evidence/boundary/run-boundaries.py --run import-entry-corrected
```

The recorded command returned zero. The launcher refuses to overwrite results;
an explicitly requested later reproduction needs a new `--run` label. All eight
rows run sequentially. Syntax validation also passed:

```powershell
node --check plans/034-evidence/boundary/native-probe.mjs
node --check plans/034-evidence/boundary/setup.mjs
python -c 'import ast,pathlib; ast.parse(pathlib.Path("plans/034-evidence/boundary/run-boundaries.py").read_text())'
```

A read-only audit of the recorded JSON confirmed eight PASS rows, five PASS
checkpoints each, identical final probe hashes, exact metadata/oracle equality,
exact delivered/expected sets, and unchanged runtime hashes. Root owns the
independent scope/review and main-workspace checks.

## Preserved setup failures

- [initial-environment-discovery.json](initial-environment-discovery.json) records
  sandbox WSL access failure and the unusable default docker-desktop-data
  distribution. Selecting the already installed Ubuntu distribution succeeded.
- [win32-lower-setup-offline-sandbox-failure.json](win32-lower-setup-offline-sandbox-failure.json)
  records sandboxed child-process EPERM. The same setup succeeded with scoped
  escalation. Both Windows stacks restored from npm cache.
- Linux offline setup reports preserve ENOTCACHED for the exact
  react-docgen-typescript 2.2.2 tarball. Separate `setup-online.json` reports record
  successful pinned `--prefer-offline` installation. Every install uses
  `--ignore-scripts --no-audit --no-fund`; no repository dependency was upgraded.
- [rows-initial/summary-all.json](rows-initial/summary-all.json) preserves eight
  first-attempt setup failures: `require.resolve` cannot resolve this ESM-only
  package's import/types-only export map. No server or fixture was started. The
  failed probe source is preserved at
  [rows-initial/native-probe.mjs](rows-initial/native-probe.mjs), hash
  `c165c8f7c2b8f143dd7993ea7063d93c587374bd9f59eaffea5b87f80d70a63d`.
  Resolving the installed declared import entry corrected only the probe. No
  runtime, recipe, fixture, watcher setting or assertion was changed in response
  to a native result; all subsequent real rows passed.

Cache variants, disabled/ignored/missing/file configurations, depth constraints,
near-consecutive creation and offline-deletion startup are the executor's
current-environment evidence, not additional claims of these eight boundary rows.
This report makes no native Vite4–7, macOS, registration-race, missing-directory,
directory-recreation, index-resolution or performance claim.
