# Completed performance work and plans

Objective: finish the performance improvements and plans. Started 2026-09-06 at
`eb7a765`; completed source integration is `09039b9f32bab728b2418b24e74636f93703b998`.
This separate evidence commit consolidates the related plans, measurements and
reviews. Nothing has been pushed or released.

The user explicitly requested unsigned local commits after the configured signer
timed out. This overrides the earlier signing requirement only. The source commit
uses `git -c commit.gpgsign=false commit`; persistent signing configuration remains
enabled. The evidence commit uses the same per-command override.

| Requirement | Evidence and completed result |
| --- | --- |
| Finish the measured backend optimization | Plan 033 is integrated at `09039b9`. All three committed source hashes match the reviewed freeze; all five rebuilt distribution files match the measured archive. 343 tests, independent 78 focused tests, ten exact-artifact rows, 26 restarts, four native watcher rows, the lower-bound native probe and four main integration cases pass. External review exited 0 with no findings. |
| Verify the performance benefit | All 24 predeclared processes passed. Independent audit checked 96 full metadata summaries and 48 exact affected lists. Both Salt modes meet the benefit rule, with 53–55% lower cold/edit medians. All successful samples and their logs are retained. |
| Classify every Plan 032 candidate | Backend output normalization is implemented in 033. Negligible membership work and the unquantified relative-candidate subset are deferred. Watcher checks are retained for correctness; dependency narrowing requires separate semantic design. |
| Reconcile earlier selected items 1–4 | Complete at the selected scope. Thirteen prior implementation/evidence commits are verified ancestors of the final source. Plan 023 is a NEEDS_DESIGN decision with a remaining production gap; 026 is a completed deprecation proposal; 027 is the completed consumer profile. These are not represented as shipped fixes or removals. |
| Finish plans for unresolved work | BACKLOG.md and 026 record explicit entry gates and deliverables for missing external files, persistence, runtime removal/default changes, TS7, Storybook freshness and dependency narrowing. No unselected migration is implied. |
| Preserve evidence and reconcile status | The containing evidence commit preserves the related 017–033 plans and useful records. Structured evidence retains its original bytes. The four large 032 raw profiles and ignored original artifacts/logs remain locally available and hash-verified. Both consumers are restored; no task benchmark/review processes remain. |
| Audit the final scope | The final audit verifies source/build/archive identity, 23 frozen measurement inputs, review identity, all prior integration ancestors, 24 successful logs and retained 030–032 experiment evidence. The separate evidence commit contains plans/evidence only; its committed bytes and clean final working tree are checked after creation. |

See [final audit](033-evidence/final-audit.json),
[source commit verification](033-evidence/source-commit.json),
[Plan 033 verification](033-verification.md), and [remaining proposals](BACKLOG.md).
The local post-commit receipt is
`.yarn/simplification-evidence/033/final-commit-verification.json`; keeping this
receipt outside its own evidence commit avoids a self-referential commit hash.

Performance scope remains the pinned, deeply nested Windows/junction Salt consumer,
with direct-plugin timing and disk cache off. The shallow control does not show an
overall gain. Legacy Salt warm time increased 3.662 ms; warm/close limits are fully
reported in 033. Historical Plan 024 persistence measurements do not establish the
current optimized artifact's persistence value. Future release, breaking option
removal, TS7 adoption and external publication remain separate decisions.
