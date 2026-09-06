# Plan 035 verification

Status: DONE. The bounded persistence recheck, independent evidence review and
local integration are complete. Result: **SIMPLIFY_OR_DEPRECATE** on the two
declared Windows fixtures. This commit changes plans and evidence only; the public
option remains supported and disabled by default. No push or release is included.

## Result and scope

The [measurement report](035-persistent-cache-measurement.md) records all 12 rows
as median/MAD, exact workload and toolchain identities, and the retention rule
frozen before sampling. There are 60 successful measured CLI processes: five
rounds, two fixtures, two stable modes, and off/populate/restart states. State
order rotates by round. No failure, replacement, variance extension or zero
denominator occurred. Another 40 seed/validation children are untimed.

| Fixture | Mode | Restart cold versus off | Restart HMR versus off |
| --- | --- | --- | --- |
| large-project, 16 component files | legacy | 423.2 ms / 36.2% slower | 361.1 ms / 64.9% slower |
| large-project, 16 component files | project service | 445.7 ms / 35.0% slower | 327.6 ms / 107.7% slower |
| react-typing, 3 component files | legacy | 79.7 ms / 6.4% faster | 106.1 ms / 19.5% slower |
| react-typing, 3 component files | project service | 79.5 ms / 6.1% faster | 96.8 ms / 62.2% slower |

No group meets both cold-saving thresholds, 20% and 100 ms. All eight populate
and restart HMR comparisons exceed both regression limits, 10% and 10 ms.
Only react-typing/project service has a positive median session saving, 5.735 ms.
Its projected 11-restart break-even is small relative to session variability and
does not establish a practical repeated-session benefit.

These are direct-plugin Windows measurements on the original scale1 fixtures,
not OS-cold startup or browser latency. They do not measure Salt persistence,
retained memory or storage footprint, and do not show that every consumer benefits
from removal. The optional storage diagnostic was omitted because it cannot change
the declared latency verdict. Historical Plan 024 data remains unchanged.

## Independent checks

Before capture, root and an independent read-only reviewer inspected the protocol
and ownership boundaries. Root read all six evidence scripts and verified actual
extraction observations, full metadata and affected identities from every corrected
control group. Off/populate first batches extracted positively; restart batches
performed zero extraction calls and matched separately seeded and fresh output.
First, warm and edited metadata match in full, including every prop's fields;
edited output agrees with a fresh cache-disabled oracle at identical paths.
Affected/transformed sets are nine files for large-project and two for react-typing
in both modes and every cache state. All closes were awaited and source restored.
See [protocol review](035-evidence/protocol-review.md) and
[pre-capture root readiness](035-evidence/root-readiness.json).

The corrected controls use the same OS-temp topology as the benchmark and comprise
26 successful children. The original 26 children used worktree-descendant paths
that could inherit repository types. Root rejected that topology before any timed
sample; original results, scripts and setup classification remain preserved.
The corrected controls reran all four groups before readiness. This is a control
setup correction, not a discarded timing or a product-code failure.

The executor's deterministic validator reloads every raw report and passes seven
negative controls. Root's separate [Python calculation](035-evidence/independent-statistics.py)
imports none of the Node statistics helpers. It verifies all 60 raw hashes,
identities, invocation order/lifetimes and equal-work counts, then independently
reproduces every median/MAD, variance decision, threshold, global HMR veto and
break-even projection. Its [result](035-evidence/independent-statistics.json) is PASS
with 12 rows, no noisy groups and the same final verdict.

Base is `ec7455ac7bf3986610b7f79291dd1acae644beba`; production Git content is unchanged
since `09039b9f32bab728b2418b24e74636f93703b998`. The build's five files exactly match
accepted033 archive SHA256
`a7aa4620b18c2eebfffbeab4cb623d94f91b4f0371b684b37eacd52ee901dfbe`.
Measured TypeScript is 6.0.3, distinct from typecheck alias 6.0.2; Node is 24.10.0.
All 86 frozen input files, 14 selected dependency files, Node bytes and six sampled
scripts remained unchanged. The six syntax checks and authored whitespace checks
pass. Existing restart/native proof applies to the exact same artifact: 26 restart
checkpoints, four033 watcher rows and eight034 boundary rows. Those suites and
completed TS7/Storybook experiments were not repeated. See
[runtime reuse proof](035-evidence/reused-runtime-proof.json),
[deterministic validation](035-evidence/verification.json) and
[executor final checks](035-evidence/executor-final-checks.json).

## Integration and next decision

Root audited the full report and copied the executor's 136-file delivery into the
main workspace with SHA256 collision checks. The executor inventory preserves its
original delivery; [copy verification](035-evidence/integration-copy.json) records
the exact files. Raw evidence and scripts remain byte-identical. Root retains an
equivalent `* -text` rule with a comment and updates only the report's status line
after copying. The root protocol, reuse and statistics evidence is included.
The [local integration audit](035-evidence/integration-verification.json) records
final identity, scope, documentation and evidence checks before the local commit.

The plan index/backlog and proposal026 now identify the current-artifact evidence
gate as complete. The next proposed step is its compatible README/JSDoc/patch
release notice; implementation is separate. Its packed-declaration check now
correctly distinguishes the repository README, which is absent from the current
package archive. Deprecation, runtime warnings, option removal and defaults were
not changed. A later removal still requires a published compatible notice and a
separate breaking-release decision.

Plan035 requires independent local evidence review, completed above, rather than
an external product-code review of unchanged runtime. No external upload occurred.
The user's existing unsigned local-commit authorization applies to this scoped
evidence change, using only `git -c commit.gpgsign=false commit`; persistent signing
configuration stays unchanged. The commit is local, with no push or publication.
