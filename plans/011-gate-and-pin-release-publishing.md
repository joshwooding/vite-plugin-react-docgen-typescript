# Plan 011: Gate and pin production publishing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, stop and report; do not improvise. A dispatching
> reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 418ecde..HEAD -- .github/workflows/ci.yml .github/workflows/release.yml`
> Expected before this plan: no output. If either workflow changed, compare the
> current files with the excerpts below and stop on a semantic mismatch.

## Status

- **Status**: DONE
- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: Plan 010
- **Category**: security / dx
- **Planned at**: commit `418ecde`, 2026-07-27

## Why this matters

The production release workflow starts independently on every push to `main`,
while the correctness and packed-compatibility gates run in another workflow.
A version commit can therefore reach the publish action before the same commit's
tests and compatibility matrix finish. The release workflow also uses mutable
action tags and a non-immutable install despite holding write and npm
provenance permissions. Publishing must depend on successful verification of
the exact SHA and every third-party action must be commit-pinned.

## Current state

- `.github/workflows/ci.yml` owns the lint/typecheck/test/benchmark job and the
  eight-row packed compatibility matrix.
- `.github/workflows/release.yml:3-32` independently checks out `main`, runs
  `yarn install`, builds, and invokes `changesets/action@v1`.
- `.github/workflows/snapshot.yml` is the repository exemplar for exact action
  SHAs, explicit permissions, immutable installs, SHA checks, and hostile
  artifact boundaries. Match that style.

Current release shape:

```yaml
on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write
  id-token: write
```

```yaml
- uses: actions/checkout@v6
- uses: actions/setup-node@v6
- run: yarn install
- uses: changesets/action@v1
```

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `yarn install --immutable` | exit 0 |
| Parse workflow | `yarn node -e "const fs=require('node:fs'); const YAML=require('yaml'); for (const f of ['.github/workflows/ci.yml']) YAML.parse(fs.readFileSync(f,'utf8')); console.log('workflow yaml ok')"` | prints `workflow yaml ok` |
| No mutable actions | `rg -n 'uses:\s+[^#\s]+@v[0-9]' .github/workflows/ci.yml` | no output, exit 1 |
| Typecheck | `yarn typecheck` | exit 0 |
| Tests | `yarn test --run` | all pass |
| Build | `yarn build` | exit 0 |
| Whitespace | `git diff --check` | exit 0 |

## Scope

**In scope**:

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml` — delete after its behavior is safely
  incorporated into the verified workflow

**Out of scope**:

- snapshot-publishing behavior and `.github/workflows/snapshot.yml`;
- package source, tests, manifests, lockfile, peer ranges, or changesets;
- changing Changesets versioning/publish semantics;
- publishing, pushing, or opening a pull request;
- weakening or skipping any current CI gate.

## Git workflow

- Branch: `codex/011-gate-and-pin-release-publishing`
- Base: `codex/010-confirm-and-stabilize-project-service` at `418ecde`.
- Use one reviewable unsigned commit:
  `Gate production publishing on verification`.
- Stage only the two workflow paths. Do not push.

## Steps

### Step 1: Resolve and verify immutable action revisions

Resolve the current commit behind each action version used by CI and release:
`actions/checkout`, `actions/setup-node`, and `changesets/action`. Follow
annotated tags to their commit object when necessary. Record the human-readable
version as an inline comment, matching `.github/workflows/snapshot.yml`.

Use GitHub's API or `gh api`; do not copy a SHA from an untrusted issue,
comment, or search snippet.

**Verify**: every `uses:` entry that remains in `ci.yml` is a 40-character
lowercase commit SHA with a version comment.

### Step 2: Make release a verified same-SHA job

Move the release job into `.github/workflows/ci.yml`. It must:

1. run only for a push to `refs/heads/main`;
2. `needs` both the ordinary lint/test job and every packed compatibility row;
3. check out `${{ github.sha }}` with credentials disabled where compatible;
4. verify `git rev-parse HEAD` equals `${{ github.sha }}`;
5. install with `yarn install --immutable`;
6. build before invoking Changesets;
7. retain the existing npm provenance behavior; and
8. receive only the permissions required by Changesets and trusted publishing.

Keep read-only permissions on all verification jobs. Do not grant workflow-wide
write permissions merely to support the release job.

Delete `.github/workflows/release.yml` only after the equivalent release
behavior exists behind these dependencies. There must be exactly one
production publishing path on a push to `main`.

**Verify**: YAML parses, the release job names both verification jobs in
`needs`, and a text search finds only one `changesets/action` invocation.

### Step 3: Prove event and permission behavior statically

Check all four cases:

- pull request: verification runs, release is skipped;
- non-main push: release is skipped;
- main push with a failed verification dependency: release cannot start;
- successful main push: release sees the exact tested `${{ github.sha }}`.

Use explicit job `if` syntax; do not rely on branch-name parsing in shell.

**Verify**:

```sh
rg -n 'pull_request|github\.event_name|refs/heads/main|needs:|permissions:|git rev-parse HEAD|yarn install --immutable|NPM_CONFIG_PROVENANCE' .github/workflows/ci.yml
```

The output must show each invariant once in the appropriate workflow/job.

### Step 4: Run repository verification

Run workflow parsing, the mutable-action search, typecheck, full tests, build,
and `git diff --check`.

**Verify**: every command in the command table has the expected result and
`git status --short` lists only the two in-scope workflow paths.

## Test plan

- YAML parse is the syntax gate.
- Static invariant searches prove immutable action references, event gating,
  job dependencies, exact-SHA checkout verification, and immutable install.
- Existing full tests/build prove the workflow refactor did not require source
  or package changes.
- GitHub Actions remains the final behavioral oracle after push; do not claim
  a remote run occurred locally.

## Done criteria

- [ ] Production publishing exists in exactly one workflow/job.
- [ ] It can run only after ordinary verification and every compatibility row
      succeed for the same SHA.
- [ ] All third-party actions in the combined CI/release workflow are pinned to
      verified 40-character commits.
- [ ] Verification jobs have read-only permissions; release permissions are
      job-scoped.
- [ ] Dependency installation is immutable.
- [ ] YAML, typecheck, full tests, build, and whitespace checks pass.
- [ ] No package/source/lockfile/snapshot workflow changed.

## STOP conditions

Stop and report if:

- branch protection or Changesets behavior requires a separate workflow that
  cannot consume a commit-exact successful result;
- the Changesets action cannot work with job-scoped permissions;
- resolving an action version does not yield a verifiable upstream commit;
- a current verification job must be skipped or weakened to avoid a dependency
  cycle; or
- any source, manifest, lockfile, or snapshot workflow change appears required.

## Maintenance notes

- When action versions are upgraded, resolve and review the new commit before
  changing the pinned SHA and keep the version comment synchronized.
- Plan 014 may restructure the packed matrix to build once. It must preserve
  the release dependency on all matrix consumers, not merely on the producer.
- Review the job-level permission boundary and exact-SHA assertion more closely
  than cosmetic workflow ordering.
