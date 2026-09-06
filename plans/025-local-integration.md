# Verified local integration

Completed 2026-09-05 at **6eeed0e746242f813b7d5ee57083d67372116d20** on
codex/simplify-changesets-publish. The user selected backlog items 1–4, including
local integration. Nothing was pushed or released.

The current branch fast-forwarded from a360aca to the reviewed source stack,
Plan025's release coverage, Plan028's small verifier isolation correction and
Plan023's reviewed decision/evidence. The integration branch was assembled in
an isolated checkout; all 26 pre-existing untracked plan files were checked for
collisions and retained byte-for-byte during the fast-forward.

- Runtime source is unchanged from reviewed 5f448ec. Its prior verification is
  337 tests, 26 separate-process restart checkpoints and four native watcher rows.
- Final compatibility verification passes all ten configured matrix equivalents:
  72 mode/topology combinations, 144 type edits, 216 create/delete/recreate checks
  and zero remaining watcher handles. Root independently repeated Windows lower
  and Linux upper bounds, and the native Windows lower sequence.
- The original Plan025 Windows failure remains recorded. Vite3 did not honor
  watch:null, mixing native events with simulated events. Plan028 isolates those
  events using a supported ignored predicate and preserves original-error logs;
  no runtime behavior, assertion, supported version or deadline was removed.
- Build and typecheck pass in the integrated main checkout. All five rebuilt
  distribution files match the identical packed archive tested by the matrix.
- Changesets cover config restoration, compiler-consistent complete dependencies,
  current-program persisted-cache validation and existing external type watches.
  README explicitly retains the initially missing external-file limitation.

Evidence: [025](025-integration-verification.md),
[028](028-verifier-verification.md), and
[023](023-missing-external-type-watch-decision.md).
The Linux runs used local Ubuntu22.04.3 under WSL2; these are not GitHub CI runs.

The reviewed Salt profile evidence was subsequently integrated at
**2fd034af84b135122c0bd8e313480b95e48fae82**, by cherry-picking isolated
bf9b3ab onto the integration branch and fast-forwarding this checkout. All 28
then-existing untracked plan files were collision-checked and preserved
byte-for-byte during that second fast-forward. Its 38 incoming files contain
only the profile report, scripts and evidence under plans; runtime source and
the previously tested artifact are unchanged. Root independently verified all
four raw profile hashes and caller weights, HMR metadata, Salt source/config
restoration and the matching built plugin. Source text is identical modulo
checkout line endings; raw source tree hashes are not interchangeable across
those LF/CRLF checkouts. See [Salt profile](027-salt-ds-profile.md).
