# Plan 028: Isolate simulated events in the packed compatibility verifier

Status: DONE — reviewed commit ebe83858394f6036612500d7d7da33e4c2e0228e,
integrated locally at6eeed0e. All ten matrix equivalents pass, including root's
independent Windows lower and Linux upper repeats. Priority P1; effort S; risk LOW.
Planned at d6553de853530680b0d959120e3b0f9eeeaf8d33 plus the approved Plan025
documentation/evidence commit. User selected integration item1; this repairs its
failed verification infrastructure, without changing plugin behavior.

## Proven problem and boundary

The unchanged scripts/verify-runtime-compatibility.mjs requests server.watch:null
then explicitly emits add/change/unlink. Installed Vite3.2.11 spreads the null
value into options and still starts Chokidar. Plan022's external dependency
registration exposes native events alongside the simulated ones. On Windows
Node20.19.5/TS4.3.5/Vite3.2.11 the watch/project-reference recreation hangs; close
then masks the original transform timeout. Root independently reproduced it.
The old a360aca artifact passes the same harness. A diagnostic changing only
watch:null to watch:{ignored:()=>true} passes all unchanged watch assertions.

Native-only existing external referenced dependency probes on the reviewed
artifact also pass edit/delete/recreate/edit, expected selective hot delivery,
fresh union metadata and zero watcher handles, in executor and root repeats.
They use150ms registration grace and do not prove every possible watcher race.
Plan025 preserves original9PASS/1FAIL matrix, diagnostics and both native runs.
Plan023's initially missing external-file gap remains a separate NEEDS_DESIGN
decision; no automatic parent watching is justified.

## Ownership

Create same-basename isolated worktree
D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan028/vite-plugin-react-docgen-typescript
on codex/028-isolate-runtime-verifier-events, from the exact approved Plan025
commit supplied by root. Verify clean base and unchanged package source/dist.
Scope: scripts/verify-runtime-compatibility.mjs, plans/028-evidence/**,
plans/028-verifier-verification.md. Root owns main plans/index and integration.
Do not edit runtime, tests, package declarations, dependencies, lockfile, CI matrix,
benchmark, old evidence, existing release notes, or README. No push/publish.
No commit until root approves. One-command signing override permitted after approval.

## Implementation

1. Replace watch:null with the public ignored predicate supported across Vite3–8,
with a concise comment that the verifier emits events and must suppress native
duplicates on versions that do not honor null. Keep every fixture, mode, deadline,
metadata/delivery/selectivity/teardown assertion unchanged.
2. Preserve an original topology error in diagnostics before close runs, using a
small catch/log/rethrow at the existing try/finally boundary. Do not build a generic
retry/error framework or weaken cleanup. The diagnostic three-line patch is an
acceptable starting point. No public package behavior or Changeset is needed.
3. Read installed Vite declarations/source for ignored in3–8 and record exact
support evidence. This is a harness repair, not a new plugin watcher contract.
Freeze this small diff. Stop and return to root if production changes appear
necessary; do not fix hypothetical event races as part of verifier isolation.

## Validation

Use the identical already-built packed archive from025:
D:/OSS/vite-plugin-react-docgen-typescript/.yarn/.codex-worktrees/plan025/vite-plugin-react-docgen-typescript/.yarn/simplification-evidence/025/reviewed-stack.tgz
SHA256 fc258456dbee71ae641d605216025b6af399261c1a3b2528e2b63c90ec724b21.
Archive dist is current reviewedsource5f448ec. New verifier hash is separate;
do not imply the package changed. Preserve original failed025 evidence.
Reuse025's portable official Node distributions and evidence observer approach.
Windows Node20 executable is under025/.yarn/simplification-evidence/025/runtime-windows/node-v20.19.5-win-x64/node.exe.
Windows current Node24.10.0 is C:/nvm4w/nodejs/node.exe.
Linux portable runtimes are /var/tmp/vite-rdt-plan025/node-v20.19.5-linux-x64/bin
and /var/tmp/vite-rdt-plan025/node-v24.10.0-linux-x64/bin in WSL Ubuntu22.04.3.
Do not switch nvm, change Git config, or install globally.

Run all ten unchanged .github/runtime-compatibility-matrix.json rows/modes using
the updated verifier, same archive, exact TS/Vite/Node versions and installed dist
identity checks. At most two jobs; coordinate with root to finish before Salt's
official timing gate. Record actual Linux/Windows host identity, not GitHub CI.
Node --check, scoped Biome and git diff --check must pass. No full337 source-suite
repeat for this test-only change; source did not change and native proof is already
independently repeated. Read the full newdiff and outputs, not just exit status.
Root independently runs Windows lower and Linux upper using the final verifier
and validates all row records/hashes. Do not overwrite original failed attempts.
Archive failed setup attempts separately if any; never silently skip supportedrows.

## Done

Exact ten matrix equivalents pass with the updated verifier; original assertions
remain intact; real native watcher evidence remains separate; docs/evidence
accurately explain old harness contamination and limits. Package source and all
five dist hashes remain unchanged. Freeze for independent review, commit only
approved isolated scope, then root handles authorized local integration.
This is a small test-isolation/comment/diagnostic correction; independent source
review and full matrix are its review gate. Escalate scope before introducing
nontrivial code that would need a separate automated source review.
