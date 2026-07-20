# Plan 001: Isolate and harden collaborator-triggered snapshot publishing

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ffd553b..HEAD -- package.json yarn.lock .github/workflows/snapshot.yml .github/scripts/validate_snapshot_artifact.py .github/scripts/test_validate_snapshot_artifact.py scripts/__tests__/snapshot-workflow.test.ts`
> If `.github/workflows/snapshot.yml` changed, compare the "Current state"
> excerpts below with the live workflow. Any semantic mismatch is a STOP
> condition. The validator and test files are expected not to exist yet. If
> Plan 002 already added its TypeScript aliases to `package.json`/`yarn.lock`,
> preserve them and regenerate the combined lockfile; that expected overlap is
> not semantic drift in this plan.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: HIGH
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `ffd553b`, 2026-07-19

## Why this matters

The snapshot workflow is a privileged `issue_comment` workflow that checks out
and executes pull-request code while an npm publishing credential is available
on the same runner. Its fork check reads a field that does not exist on an
`issue_comment` payload, so it does not establish the trust boundary it appears
to establish. A malicious or compromised branch could therefore turn a
maintainer's snapshot comment into a package-publishing credential compromise.

The safe outcome is a three-stage workflow: authorize an immutable same-repo
commit, build and pack it on a credential-free runner, then validate and publish
only the inert tarball on a fresh privileged runner. GitHub explicitly warns
that `issue_comment` workflows which fetch and execute untrusted pull-request
code with secrets are vulnerable to "pwn request" attacks.

## Current state

- `.github/workflows/snapshot.yml:4-18` runs on exact snapshot commands posted
  to a pull request discussion.
- `.github/workflows/snapshot.yml:9` grants `permissions: write-all` to the
  entire workflow.
- `.github/workflows/snapshot.yml:21-50` checks the commenter's repository
  permission, but authorization and publication are still one job on one
  runner.
- `.github/workflows/snapshot.yml:51-72` contains the broken fork check:

  ```yaml
  env:
    FORK: ${{ github.event.pull_request.head.repo.fork }}
  ```

  An `issue_comment` event exposes only an issue-side pull-request marker; full
  head-repository and head-SHA data must be fetched from the Pull Requests API.
- `.github/workflows/snapshot.yml:73-86` checks out the mutable pull-request ref,
  persists checkout credentials by default, enables dependency caching, and
  installs without `--immutable`.
- `.github/workflows/snapshot.yml:87-145` versions, builds, publishes, comments,
  and reacts in one `actions/github-script` step with both the npm token and a
  write-capable GitHub token in its environment.
- The repository currently has one publishable workspace package:
  `@joshwooding/vite-plugin-react-docgen-typescript`.
- Recent repository commits use short imperative/title-style subjects such as
  `Update CI Actions (#69)` and `Fix publishing (#68)`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Add/update test parser lock entry | `yarn install` | Exit 0; `yaml` is the only new dependency |
| Reproducible install | `yarn install --immutable` | Exit 0 after the intentional lock update |
| Baseline workflow regression | `yarn vitest run scripts/__tests__/snapshot-workflow.test.ts` | Before implementation, the new security assertions fail only on documented current behavior; after implementation, all pass |
| Hostile-artifact tests | `python .github/scripts/test_validate_snapshot_artifact.py` | All valid, malformed, traversal, link, size, count, digest, metadata, and package-identity cases pass |
| Full tests | `yarn test --run` | All tests pass |
| Typecheck | `yarn typecheck` | Exit 0, no errors |
| Changed-file formatting/lint | `yarn exec biome ci package.json scripts/__tests__/snapshot-workflow.test.ts` | Exit 0 after formatting the two Biome-supported in-scope files |
| Repository formatting/lint | `yarn biome:ci` | Exit 0 on Linux CI; see the Windows baseline note below |
| Workflow anti-pattern scan | `rg -n 'github\.event\.pull_request|permissions: write-all|uses: [^ ]+@v[0-9]' .github/workflows/snapshot.yml` | No output and expected `rg` exit 1 |
| Secret-scope scan | `rg -n 'NPM_TOKEN|NODE_AUTH_TOKEN' .github/workflows/snapshot.yml` | Credential references occur only on the single `npm publish` step |
| Whitespace check | `git diff --check` | Exit 0 |
| Scope check | `git status --short` | Only the six in-scope paths appear, plus `plans/README.md` if its status row is updated |

The current Windows checkout has a known line-ending-only Biome baseline: full
`yarn biome:ci` exits 1 with 16 `format` diagnostics on pre-existing CRLF files.
Do not use that as a reason to rewrite unrelated files. The changed-file Biome
command must exit 0, `git diff --check` must exit 0, and Linux CI must make the
full command green. On Windows, the full command is acceptable only if every
remaining diagnostic is the same pre-existing `format`/CRLF class and no new
path appears.

## Suggested executor toolkit

- Read GitHub's [secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use#mitigating-the-risks-of-untrusted-code-checkout) before editing the workflow. In particular, treat artifacts produced by pull-request code as untrusted data.
- Use GitHub's documented [`github.workflow_sha`
  context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context)
  to fetch validator code from the commit that supplied the trusted workflow,
  never from the authorized pull-request head.
- Keep the validator aligned with Changesets' documented
  [`snapshot.prereleaseTemplate`
  behavior](https://github.com/changesets/changesets/blob/main/docs/config-file-options.md#snapshot-optional).
  This repository has no custom snapshot configuration, so `--snapshot snapshot`
  uses the default `{tag}-{datetime}` suffix.
- Use the official action repositories to independently confirm every tag-to-SHA mapping before committing. Never replace a full SHA with a mutable major tag.

## Scope

**In scope** (the only files you should modify):

- `.github/workflows/snapshot.yml`
- `.github/scripts/validate_snapshot_artifact.py` — create
- `.github/scripts/test_validate_snapshot_artifact.py` — create
- `scripts/__tests__/snapshot-workflow.test.ts` — create
- `package.json`
- `yarn.lock`

**Out of scope**:

- `.github/workflows/ci.yml` and `.github/workflows/release.yml`; their action
  pinning and release gating are separate follow-ups.
- Supporting snapshot publication from fork pull requests.
- Changing `/release-pr` or `/snapshot-release` command names.
- Changing ordinary releases, Changesets release semantics, package contents,
  or npm dist-tag naming.
- Rotating credentials or changing npm/repository settings. Record that as an
  operator follow-up if historical exposure cannot be ruled out.

## Git workflow

- Branch: `codex/001-harden-snapshot-publishing`
- Make one logical commit with a title-style subject, for example
  `Harden snapshot publishing`.
- Do not push, trigger a real snapshot, or open a pull request unless the
  operator explicitly instructs it.

## Steps

### Step 1: Add executable security regression tests first

Add `yaml` as a root development dependency (`yarn add -D yaml@^2.8.1`) so the
workflow test can inspect parsed job objects instead of guessing YAML structure
from global regular-expression matches. Create
`scripts/__tests__/snapshot-workflow.test.ts`, parse
`.github/workflows/snapshot.yml`, and add named tests for these final invariants:

1. There are exactly three jobs, `authorize`, `build`, and `publish`; the latter
   two depend on successful authorization, and each has its own
   `runs-on: ubuntu-latest` runner.
2. The authorization script calls `github.rest.pulls.get`, rejects a head
   repository whose `full_name` is not `context.repo.owner/context.repo.repo`,
   rejects a closed or deleted-head pull request, and emits a lowercase
   40-character head SHA.
3. The build job's checkout uses `needs.authorize.outputs.head_sha`, sets
   `persist-credentials: false`, and is followed by an exact `git rev-parse
   HEAD` comparison. The publish job's only checkout uses
   `${{ github.workflow_sha }}`, a separate `_trusted` path, sparse checkout for
   `.github/scripts/validate_snapshot_artifact.py`; that checkout's ref and path
   never use the PR head SHA. Other publish steps may consume the authorized
   SHA only as inert data for the fixed artifact name, validator input, and PR
   revalidation.
4. Top-level permissions are `{}`. Parsed per-job permission objects equal the
   documented allowlists exactly. Recursive inspection of the parsed `build`
   object finds no `secrets.`, write permission, or OIDC permission. Recursive
   inspection of `publish` finds no `id-token` permission.
5. The build upload step names exactly the fixed `package.tgz` and
   `metadata.json` paths and the SHA-derived artifact name. The publish download
   uses that same name and goes to the fixed
   `${{ runner.temp }}/snapshot-artifact` directory, invokes only the trusted validator
   path, and publishes the fixed tarball path with `--ignore-scripts`, `--registry
   https://registry.npmjs.org/`, and the `snapshot` tag.
6. Recursively walking the parsed step objects finds `secrets.NPM_TOKEN` and
   `NODE_AUTH_TOKEN` only in the environment of the single `npm publish` step.
   The earlier registry-existence check explicitly uses
   `NPM_CONFIG_USERCONFIG=/dev/null` and contains no credential reference.
7. Every `uses:` value matches `owner/repository@<40 lowercase hex>` and its
   source line retains a reviewed release comment. The allowlist contains only
   the six exact SHAs named in this plan.
8. Setup inputs pin Node 24 and Python 3.13, trusted sparse checkout disables
   cone mode, and setup-node's npm registry is the fixed public registry.
9. The test also parses `.changeset/config.json` and asserts that `snapshot` is
   absent and that the deprecated
   `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.useCalculatedVersionForSnapshots`
   fallback is absent or exactly `false`. That makes a future custom prerelease
   template or calculated-version setting fail before the validator's exact
   version allowlist can drift from the packaging command.

Also create `.github/scripts/validate_snapshot_artifact.py` and its standard-
library `unittest` suite at
`.github/scripts/test_validate_snapshot_artifact.py`. The validator is trusted
code, not code sourced from the downloaded artifact. Give it a CLI accepting
fixed tarball/metadata paths, the authorized SHA, and an optional GitHub-output
path. It must return nonzero without emitting outputs on any failed invariant.
Use Python's streaming `tarfile` mode; never extract members.

Do not rely on `TarInfo.size` alone. Use `zlib.decompressobj(16 +
zlib.MAX_WBITS)` for one gzip member, put a byte-counting decompression reader in
front of `tarfile`, and limit each decompressor read so no call can materialize
more than the remaining 64 MiB budget. Require one complete gzip member;
`unused_data`, a second concatenated gzip member, truncated checksum/footer, or
any compressed bytes after that member fail closed. Add a header-aware guard
for PAX/global-PAX and GNU long-name/link extension sizes before their bodies
reach `tarfile`. After the first valid tar EOF marker, drain within the same
expanded-byte budget and permit only zero padding; reject a second archive or
any non-zero trailing byte. These checks cover data `tarfile` may consume before
yielding a normal `TarInfo`.

Define these constants in one place and test every boundary:

- compressed tarball: at most 25 MiB;
- metadata JSON: at most 8 KiB;
- entire decompressed tar byte stream, including headers, padding, extension
  records, and trailing bytes: at most 64 MiB;
- physical tar member/extension headers: at most 5,000, counting every regular,
  directory, PAX/global-PAX, and GNU long-name/link header but not the two zero
  end-of-archive blocks;
- any regular member: at most 10 MiB;
- cumulative declared regular-file bytes: at most 50 MiB;
- any PAX/global-PAX or GNU long-name/link extension body: at most 64 KiB;
- `package/package.json`: exactly once and at most 256 KiB;
- member path: at most 512 UTF-8 bytes.

Positive fixtures must include a minimal Yarn-style `package/` tarball and
valid metadata. Negative fixtures must cover malformed gzip/tar/JSON, duplicate
or missing `package.json`, absolute/backslash/`..` paths, symlink and hardlink,
device/FIFO/GNU-sparse/unknown member types, sparse PAX metadata, `.npmrc` at any
depth/case, each size/count boundary (including physical extension headers),
oversized PAX/global-PAX and GNU long-name/link records, concatenated gzip
members, a second tar archive or non-zero data after tar EOF, extra downloaded
files or directories, symlinked artifact inputs, digest/SHA/version mismatch,
wrong/private package, any `publishConfig` object, and proxy/TLS-shaped
`publishConfig` fields specifically.
Invalid-version fixtures must include a nonzero base version, a bare
`snapshot` prerelease, another tag, a malformed or non-14-digit timestamp,
extra prerelease identifiers, and build metadata.
Construct fixtures in the test with `tempfile` and `tarfile`; do not commit
binary archives.

**Verify before changing the workflow**:

1. `python .github/scripts/test_validate_snapshot_artifact.py` → all validator
   tests pass.
2. `yarn vitest run scripts/__tests__/snapshot-workflow.test.ts` → tests fail
   against `ffd553b` only on the documented missing workflow controls. If the
   root Vitest command cannot discover the file, STOP rather than adding a new
   test runner.

### Step 2: Authorize the commenter and freeze canonical pull-request data

Rewrite the workflow with `permissions: {}` at the top level. Keep the existing
event and exact command predicate. Set concurrency to the pull-request number,
for example `snapshot-${{ github.event.issue.number }}`, so unrelated pull
requests do not block one another and one pull request cannot publish two
snapshots concurrently.

Create an `authorize` job which performs no checkout and grants only:

```yaml
permissions:
  issues: write
  pull-requests: read
```

In a pinned `actions/github-script` step:

- Fetch the actor's collaborator permission. Preserve the current authorization
  policy: only `write` and `admin` are accepted.
- Fetch the pull request with `github.rest.pulls.get`, using
  `github.event.issue.number`.
- Require the PR to be open, its head repository to exist, and
  `pull.data.head.repo.full_name` to exactly equal the base repository's full
  name. This intentionally rejects every fork, including deleted fork heads.
- Validate `pull.data.head.sha` against `/^[0-9a-f]{40}$/` and expose that exact
  SHA and the PR number as job outputs. Never export a branch name or mutable
  `refs/pull/.../head` ref.
- Add the `eyes` reaction only after every check passes. On rejection, post a
  concise explanation and fail before any checkout.

Pin the action to:

```yaml
uses: actions/github-script@ed597411d8f924073f98dfc5c65a23a2325f34cd # v8.0.0
```

**Verify**:

- `yarn vitest run scripts/__tests__/snapshot-workflow.test.ts` → the
  authorization tests pass.
- `rg -n 'github\.event\.pull_request|FORK:|refs/pull/' .github/workflows/snapshot.yml`
  → no output and expected `rg` exit 1.

### Step 3: Build and pack the frozen commit without credentials

Create a `build` job on its own GitHub-hosted runner with `needs: authorize` and
only `contents: read`. Set a finite `timeout-minutes` value. Use these immutable
action references, after re-verifying them against the official repositories:

```yaml
uses: actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3
uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0
uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
```

Set `actions/setup-node` to `node-version: "24"`. Configure upload with the
literal artifact name
`snapshot-package-${{ needs.authorize.outputs.head_sha }}`,
`if-no-files-found: error`, `retention-days: 1`, `compression-level: 0`, and
these exact action input paths (GitHub expressions, not shell variables):

```yaml
path: |
  ${{ runner.temp }}/snapshot/package.tgz
  ${{ runner.temp }}/snapshot/metadata.json
```

Checkout `needs.authorize.outputs.head_sha` with `fetch-depth: 1` and
`persist-credentials: false`. In the immediately following step, pass the
authorized SHA through an environment variable and compare it to
`git rev-parse HEAD`; exit nonzero on any mismatch.

Do not configure a package-manager cache in this workflow. Run, in order:

1. `yarn install --immutable`
2. `yarn biome:ci`
3. `yarn typecheck`
4. `yarn test --run`
5. `yarn changeset version --snapshot snapshot`
6. `yarn build`
7. `yarn workspace @joshwooding/vite-plugin-react-docgen-typescript pack --out "$RUNNER_TEMP/snapshot/package.tgz"`

All of those commands execute pull-request-controlled code, so this job must
have no repository write permission, npm credential, OIDC permission, or
persisted checkout credential. Do not let later privileged jobs reuse this
runner.

Reject a tarball larger than 25 MiB before upload. Write
`$RUNNER_TEMP/snapshot/metadata.json` containing the authorized SHA, fixed
package name, generated version, fixed filename `package.tgz`, and SHA-256
digest; reject metadata larger than 8 KiB. Upload exactly those two literal
paths as one short-retention artifact. Do not upload the working tree, `.npmrc`,
Yarn cache, logs, directories, globs, or arbitrary build output. Treat both
files as untrusted in the next job despite these build-side checks.

**Verify**:

`yarn vitest run scripts/__tests__/snapshot-workflow.test.ts -t "build job"`
→ the parsed `build` object proves immutable checkout, runner separation,
literal artifact paths, exact `contents: read` permission, and absence of
secret/OIDC/write references. The snapshot build must not run validator code or
the Python validator suite from the PR checkout. The ordinary Vitest suite may
exercise the workflow-structure test on this unprivileged runner, but the
publish job relies only on validator code from the trusted workflow revision.

### Step 4: Validate the artifact as hostile data on a fresh publish runner

Create a `publish` job with `needs: [authorize, build]` on a fresh runner. It
must never check out pull-request code and must not execute any file from the
tarball. Grant only the permissions needed to fetch trusted validator code,
re-read the PR, and report the result:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: read
```

First check out only `.github/scripts/validate_snapshot_artifact.py` from
`${{ github.workflow_sha }}` into `_trusted` with sparse checkout,
`sparse-checkout-cone-mode: false`, `fetch-depth: 1`, and
`persist-credentials: false`. GitHub defines
`github.workflow_sha` as the commit containing the workflow used for the run;
this keeps the validator on the trusted workflow revision rather than the PR
head. Verify `git -C _trusted rev-parse HEAD` equals `github.workflow_sha`.

Set up Node and Python and download the artifact with these
pinned actions, after independent verification:

```yaml
uses: actions/checkout@9f698171ed81b15d1823a05fc7211befd50c8ae0 # v6.0.3
uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6.5.0
uses: actions/setup-python@a309ff8b426b58ec0e2a45f0f869d46889d02405 # v6.2.0
uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
```

Set setup-node inputs to `node-version: "24"` and
`registry-url: "https://registry.npmjs.org/"`; the generated user config must
reference `NODE_AUTH_TOKEN`, whose value exists only on the final publish step.
Set setup-python to an explicit `python-version: "3.13"`. Download the literal
artifact name `snapshot-package-${{ needs.authorize.outputs.head_sha }}` to the
action input path `${{ runner.temp }}/snapshot-artifact`. Do not use
`$RUNNER_TEMP` in any `with.path` value because action inputs do not expand
shell variables.

Before the npm credential is exposed, invoke the trusted Python validator with
literal paths `${{ runner.temp }}/snapshot-artifact/package.tgz` and
`${{ runner.temp }}/snapshot-artifact/metadata.json` plus the authorized SHA.
Apply the exact caps from Step 1 and validate all of these conditions:

- The download directory contains exactly two direct entries with the fixed
  basenames `package.tgz` and `metadata.json`. Both must be non-symlink regular
  files under `lstat`; reject subdirectories and every extra entry.
- The tarball digest matches the metadata and the metadata SHA matches the
  authorized commit.
- Every effective archive entry is relative under `package/`; reject empty,
  absolute, backslash, dot-segment, parent-segment, overlong, and `.npmrc`
  paths. Allow only regular files and directories as yielded members; reject
  every other type, including links, devices/FIFOs, GNU sparse entries, sparse
  PAX metadata, and unknown typeflags. Count all physical member and extension
  headers toward the 5,000 cap. Reject malformed headers and all resource
  limits before consuming member data beyond the cap.
- Streaming the single `package/package.json` member without extracting or
  executing anything yields exactly the package name
  `@joshwooding/vite-plugin-react-docgen-typescript`.
- The version matches the complete SemVer 2.0 grammar and the stricter full
  pattern `^0\.0\.0-snapshot-\d{14}$`, with no build metadata, and matches
  metadata. The fixed shape reflects the repository's current lack of custom
  Changesets snapshot settings: `useCalculatedVersion` defaults to false and
  `--snapshot snapshot` uses the `{tag}-{datetime}` suffix. If
  `.changeset/config.json` later adds or changes snapshot configuration, fail
  the workflow regression test and update this validator and its tests; do not
  loosen the rule at runtime.
- `private` is not true and `publishConfig` is entirely absent. Do not permit
  even a fixed-registry object: npm flattens other `publishConfig` fields into
  publish options, so proxy, CA, or TLS keys could redirect or weaken the
  token-bearing request.

The validator may append only the already validated package name and version to
`GITHUB_OUTPUT`; it must never emit shell syntax. In a following credential-free
step, query the fixed public registry for that exact fixed package and validated
version with `NPM_CONFIG_USERCONFIG=/dev/null` so setup-node's later
`NODE_AUTH_TOKEN` placeholder is not consulted. Continue only on the registry's
documented not-found result; fail on an existing version, timeout,
authentication error, or ambiguous response.

Re-fetch the pull request immediately before publication. Require it still to
be open, same-repository, and at the exact authorized head SHA. If it advanced,
fail and tell the commenter to issue a new snapshot command.

Pass only the fixed tarball path to the publish step; never interpolate an
unvalidated package name, version, filename, or command into a shell. Scope the
existing npm credential to this single step:

```yaml
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
run: npm publish "${{ runner.temp }}/snapshot-artifact/package.tgz" --ignore-scripts --access public --tag snapshot --registry https://registry.npmjs.org/
```

The `--ignore-scripts` flag is mandatory. The privileged job must not run Yarn,
Changesets, a build, package lifecycle hooks, or pull-request-provided scripts.
Do not grant `id-token: write` or set npm provenance in this plan: on an
`issue_comment` run it would attest the trusted workflow revision, not bind the
package bytes to the authorized PR head. Source-bound snapshot attestations are
a separate design.

**Verify**:

1. `python .github/scripts/test_validate_snapshot_artifact.py` → every hostile
   fixture fails closed and the valid fixture emits only canonical values.
2. `yarn vitest run scripts/__tests__/snapshot-workflow.test.ts -t "publish job"`
   → the parsed job proves trusted-workflow checkout, fixed paths, caps,
   registry/PR revalidation, no OIDC permission, and secret scoping.

### Step 5: Report only validated publication data and pin every action

After `npm publish` succeeds, use the validated package name and version to post
the install command and add the `rocket` reaction in a pinned
`actions/github-script` step. Do not parse arbitrary npm output and do not give
the reporting step the npm credential.

Run the static test's action-reference extraction over the final workflow. The
only allowed action SHAs are the six verified SHAs listed in this plan; if the
implementation needs another action, independently resolve and review its full
release SHA, add it to the test allowlist with its release comment, and explain
why it is necessary in the commit.

**Verify**:

1. `yarn vitest run scripts/__tests__/snapshot-workflow.test.ts` → all tests pass.
2. `rg -n 'github\.event\.pull_request|permissions: write-all|uses: [^ ]+@v[0-9]' .github/workflows/snapshot.yml` → no output and expected `rg` exit 1.
3. `rg -n 'NPM_TOKEN|NODE_AUTH_TOKEN' .github/workflows/snapshot.yml` → only the
   one publish step is reported.

### Step 6: Run repository-wide verification

Run, in order:

1. `yarn install --immutable`
2. `python .github/scripts/test_validate_snapshot_artifact.py`
3. `yarn vitest run scripts/__tests__/snapshot-workflow.test.ts`
4. `yarn typecheck`
5. `yarn test --run`
6. `yarn exec biome ci package.json scripts/__tests__/snapshot-workflow.test.ts`
7. `yarn biome:ci` on Linux CI; apply the documented Windows baseline rule locally
8. `git diff --check`
9. `git status --short`

Expected: all platform-independent commands and the changed-file Biome command
exit 0; Linux CI is fully green; the only new dependency is root-dev `yaml`;
and only the six in-scope files plus the plan-index status update are modified.
Do not perform a real npm publish as a local or pull-request verification step.

## Test plan

- The parsed-workflow tests must cover same-repository authorization,
  fork/deleted-head rejection, both immutable checkouts, empty top-level
  permissions, exact per-job permissions, separate runners, trusted validator
  origin, fixed artifact paths, `--ignore-scripts`, secret scoping, and
  immutable action pins. Global text scans cannot substitute for per-job
  assertions.
- The Python suite must execute the same validator used by the publish runner
  and cover every resource and archive invariant from Step 1. A static test
  that merely searches for validator-related words is insufficient. Include
  negative version cases for a nonzero base version, a bare `snapshot`
  prerelease, another tag, a malformed or non-14-digit timestamp, extra
  prerelease identifiers, and build metadata. Include hostile package manifests
  with `publishConfig.registry`, proxy, CA, and TLS fields and prove every
  `publishConfig` object is rejected before the publish step can receive a
  credential.
- Model the test style on
  `packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`:
  use Vitest's `describe`, `it`, and `expect`, and resolve paths from the test
  file rather than relying on the caller's current directory.
- After merge, a maintainer may do a controlled same-repository snapshot and a
  fork rejection check. Those are operator checks, not automated test steps and
  not prerequisites for committing the code change.

## Done criteria

- [ ] Fork, deleted-head, closed, and non-PR comments cannot reach checkout.
- [ ] The build checks out and verifies one immutable API-returned same-repo SHA.
- [ ] Pull-request code runs only on a job with read-only repository permission,
      no npm credential, no OIDC permission, and no persisted Git credential.
- [ ] The publish job runs on a fresh runner, performs no pull-request checkout,
      and executes no pull-request-controlled code or lifecycle script; its
      only sparse checkout is pinned to `github.workflow_sha`.
- [ ] Only one allowlisted snapshot tarball can be published, and its digest,
      compressed/expanded size, entry/extension limits, cumulative bytes,
      single gzip/tar termination, name, version, registry, archive paths/types,
      and current PR SHA are validated by tested trusted code.
- [ ] The npm credential occurs only on the `npm publish --ignore-scripts` step.
- [ ] The privileged job has no OIDC permission and makes no unsupported claim
      that npm provenance represents the PR source commit.
- [ ] All action references use reviewed 40-character SHAs with release comments.
- [ ] Python validator tests, parsed workflow tests, full tests, typecheck,
      changed-file Biome, Linux CI, and `git diff --check` pass.
- [ ] `yaml` is the only dependency addition; no published-package manifest,
      ordinary CI, or ordinary-release file changed.
- [ ] `plans/README.md` marks Plan 001 `DONE`.

## STOP conditions

Stop and report if:

- The live workflow differs materially from the current-state excerpts.
- Any accepted path requires executing fork code or pull-request code on the
  privileged publish runner.
- The exact official action tag-to-SHA mapping cannot be independently verified.
- Repository policy denies a listed least-privilege permission; do not restore
  `write-all` as a workaround.
- Installation, versioning, building, packing, or validation requires the npm
  credential.
- More than the one allowlisted workspace package is publishable.
- The validator cannot parse the actual Yarn tarball using only inert streaming
  reads, or any required archive check lacks a hostile-fixture test and a fixed
  resource bound. Do not ship a hand-waved inline tar parser.
- The publish job cannot obtain the validator from `github.workflow_sha`
  without also checking out or executing pull-request code.
- The pull-request head changes during the run; abort and require a new command.
- A verification fails twice after one focused correction.

## Maintenance notes

- Job separation is the primary security boundary. Step-level environment
  scoping on one runner is insufficient because untrusted build code can leave a
  background process behind to observe later steps.
- Reviewers should trace every denial path and prove it terminates before
  checkout, and trace every privileged path and prove it never executes the PR
  working tree or artifact scripts.
- Re-verify action release comments when updating their SHAs; never move back to
  major-version tags.
- Repository owners should review historical runs and rotate the npm publishing
  credential if prior exposure cannot be ruled out. Credential rotation is an
  operator action, not part of this code plan.
