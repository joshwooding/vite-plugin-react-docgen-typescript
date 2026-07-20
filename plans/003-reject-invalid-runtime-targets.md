# Plan 003: Prevent invalid runtime targets for barrel re-exports

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan in
> `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ffd553b..HEAD -- packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts .changeset/safe-runtime-targets.md`
> If either existing source file changed, compare the "Current state" excerpts
> below with the live code. Any semantic mismatch is a STOP condition. The test
> files and changeset are expected not to exist.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ffd553b`, 2026-07-19

## Why this matters

[Open issue #79](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/issues/79)
shows that `export { default as X } from "./Component"` can make the plugin emit
`default.displayName` and `default.__docgenInfo`. That is a parse-time syntax
error, so the generated `try/catch` cannot protect the Storybook preview.
Cross-module re-exports introduce no local runtime binding; the plugin must skip
them, and generation must retain a final validation boundary so no reserved or
malformed root can ever be interpolated into executable code.

## Current state

- `packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts:5`
  accepts any dotted ASCII identifier-shaped path:

  ```ts
  const IDENTIFIER_PATH_PATTERN = /^[$A-Z_a-z][$\w]*(?:\.[$A-Z_a-z][$\w]*)*$/;
  ```

  It does not distinguish a legal identifier token from a reserved root such as
  `default`.
- `runtimeTarget.ts:76-83` resolves every same-source-file `ExportSpecifier` to
  `propertyName ?? name`. For `export { default as TimespanInput } from "..."`,
  this returns the bare string `default` even though the export declaration has
  a `moduleSpecifier` and creates no local binding.
- `runtimeTarget.ts:161-181` and `203-226` already distinguish local export lists
  by requiring `!statement.moduleSpecifier`; the fix should follow that existing
  semantic distinction.
- `packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts:24-42`
  duplicates target validation and includes a loose fallback:

  ```ts
  const IDENTIFIER_PATH_PATTERN = /^[$A-Z_a-z][$\w]*(?:\.[$A-Z_a-z][$\w]*)*$/;
  const LOOSE_EXPRESSION_PATTERN = /^[$A-Z_a-z0-9.-]+$/;
  ```

  Values accepted by the loose pattern can be syntactically invalid or refer to
  unintended subtraction expressions.
- `generate.ts:142-164` interpolates the accepted string directly before
  `.displayName` and `.__docgenInfo` assignments. Parse failures occur before
  its runtime catch block.
- Existing fixtures cover locally bound default exports, but no focused test
  covers cross-module export specifiers, reserved roots, or syntax validity of
  generated output.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Existing baseline | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts` | Exit 0; existing snapshots pass before and after the change |
| Focused tests | `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts` | All new target and syntax cases pass after implementation |
| Typecheck | `yarn typecheck` | Exit 0, no errors |
| Full tests | `yarn test --run` | All tests pass |
| Build | `yarn build` | Package builds successfully |
| Changed-file formatting/lint | `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts` | Exit 0 after formatting in-scope code/tests |
| Repository formatting/lint | `yarn biome:ci` | Exit 0 on Linux CI; see the Windows baseline note below |
| Whitespace check | `git diff --check` | Exit 0 |
| Scope check | `git status --short` | Only in-scope files and the plan-index status update appear |

No dependency or lockfile change is expected.

The current Windows checkout has a known line-ending-only Biome baseline: full
`yarn biome:ci` exits 1 with 16 pre-existing `format` diagnostics. Do not rewrite
unrelated files. The changed-file command must exit 0, `git diff --check` must
exit 0, and Linux CI must make the full command green. A Windows full run is
acceptable only when every remaining diagnostic is that same pre-existing
CRLF/`format` class and no new path appears.

## Scope

**In scope** (the only files you should modify):

- `packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts`
- `packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts`
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts` — create
- `packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts` — create
- `.changeset/safe-runtime-targets.md` — create

**Out of scope**:

- Synthesizing imports or other local bindings for re-exported components.
- Changing `react-docgen-typescript`, public options, or package exports.
- Supporting arbitrary JavaScript expressions as metadata targets.
- Expanding the existing ASCII dotted-identifier grammar.
- Changing snapshots unless a new focused integration fixture is proven
  necessary by a STOP-condition review.

## Git workflow

- Branch: `codex/003-reject-invalid-runtime-targets`
- Make one logical commit with a title-style subject, for example
  `Reject invalid docgen runtime targets`.
- Do not push or open a pull request unless instructed.

## Steps

### Step 1: Add real-symbol and generator characterization tests

Create `src/__tests__/runtimeTarget.test.ts`. Build small in-memory TypeScript
source files and a real `Program`/`TypeChecker`; do not hand-construct a partial
symbol whose shape can drift from TypeScript. Locate each `ExportSpecifier` and
call `checker.getSymbolAtLocation(specifier.name)` exactly; assert that it
returns the alias symbol, then pass that symbol as `ComponentDoc.expression` to
`resolveComponentDocRuntimeTargets`.

Cover these named cases:

1. `export { default as TimespanInput } from "./TimespanInput"` resolves to a
   `null` target because the component declaration is in another source file
   and the barrel has no local binding.
2. `const Local = ...; export { Local as default }` resolves to `Local`.
3. `const Local = ...; export { Local as Public }` resolves to `Local`.
4. A normal named/function/class/default declaration retains its existing
   target behavior.

Create `src/__tests__/generate.test.ts` with minimal `ComponentDocWithTarget`
objects. Cover:

- Every disallowed root listed in Step 3 appends no generated block; use one
  parameterized table so a future edit cannot test only a representative
  subset.
- Malformed or loose-only values: `1Component`, `Component-name`,
  `Component()`, `Component["child"]`, and repeated/leading dots append no
  generated block.
- `Component`, `$Component`, `async`, `type`, `Components.Button`, and
  `Components.default` remain accepted.
- Every accepted result has zero TypeScript parse diagnostics. Parse in module
  context by appending `export {};`, use the installed TypeScript
  parser/transpiler in memory, and do not invoke an external compiler or write
  temporary files. Note that `this.x`, `true.x`, and `null.x` can be
  syntactically valid expressions; they are still rejected because their roots
  cannot name the local component binding this generator requires. The runtime
  `try`/`catch` is not a substitute for this semantic rule.

**Verify before implementation**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts`
→ the cross-module, reserved-root, and loose-pattern regressions fail for the
documented reason while valid local targets pass.
If the actual symbol path does not reproduce `default`, STOP and report the
observed compiler/docgen shape rather than forcing the expected fixture.

### Step 2: Reject cross-module export specifiers at resolution time

In `runtimeTarget.ts`, change `getDeclarationTarget` so an `ExportSpecifier` is
eligible only when all of the following are true:

- Its enclosing node is a real `ExportDeclaration`.
- That declaration belongs to the active `SourceFile`.
- The enclosing export declaration has no `moduleSpecifier`.

Continue returning `propertyName ?? name` for local export lists. Do not reject
all export specifiers: that would regress `export { Local as default }` and
named local aliases.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts`
→ all cross-module and local-export cases pass.

### Step 3: Share one strict target-expression validator

In `runtimeTarget.ts`, replace the private regex-only predicate with an exported
internal helper named clearly, for example
`isSupportedRuntimeTargetExpression`. Keep the current dotted ASCII identifier
grammar, then reject the first/root segment when it is any member of this exact
module/strict-binding deny set:

```text
arguments, await, break, case, catch, class, const, continue, debugger,
default, delete, do, else, enum, eval, export, extends, false, finally, for,
function, if, implements, import, in, instanceof, interface, let, new, null,
package, private, protected, public, return, static, super, switch, this, throw,
true, try, typeof, var, void, while, with, yield
```

Keep this list beside the validator as a readonly set. `arguments` and `eval`
are included because generated modules are strict and those names cannot be the
local binding from which runtime targets are derived. Do not broaden the deny
set to contextual words such as `async`, `as`, `from`, `get`, `of`, `set`, or
`type`; they remain valid local identifiers.

Important semantic boundary:

- Reject a reserved root: `default`, `class`, `await`, and similar values cannot
  be emitted as the left-hand expression.
- Permit reserved property names after a valid root: `Namespace.default` is
  legal property access and must continue to work.

Use the shared helper everywhere `runtimeTarget.ts` accepts a target.

In `generate.ts`, import and reuse that same helper. Delete
`LOOSE_EXPRESSION_PATTERN` and its acceptance branch. If a target fails strict
validation, `createComponentCode` must return an empty string and leave the
source untouched. Do not add the TypeScript parser to the production generation
path; it is only a test oracle.

**Verify**:
`yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts`
→ all reserved, malformed, valid-path, cross-module, local-export, and
syntax-diagnostic cases pass.

### Step 4: Add a patch changeset

Create `.changeset/safe-runtime-targets.md` with exactly one patch entry for
`@joshwooding/vite-plugin-react-docgen-typescript`. State that barrel default
re-exports no longer generate invalid `default.*` assignments. Do not edit
`CHANGELOG.md` directly.

**Verify**:
`Get-Content -Raw .changeset/safe-runtime-targets.md` → frontmatter contains
only the plugin package at `patch`, followed by one user-facing sentence.

### Step 5: Run repository-wide verification

Run, in order:

1. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/index.test.ts`
2. `yarn vitest run packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts`
3. `yarn typecheck`
4. `yarn test --run`
5. `yarn build`
6. `yarn exec biome ci packages/vite-plugin-react-docgen-typescript/src/utils/runtimeTarget.ts packages/vite-plugin-react-docgen-typescript/src/utils/generate.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/runtimeTarget.test.ts packages/vite-plugin-react-docgen-typescript/src/__tests__/generate.test.ts`
7. `yarn biome:ci` on Linux CI; apply the documented Windows baseline rule locally
8. `git diff --check`
9. `git status --short`

Expected: all platform-independent commands and the changed-file Biome command
exit 0; Linux CI is green; existing snapshots are unchanged; and only the five
in-scope files plus the plan-index status update are modified.

## Test plan

- Use real TypeScript AST and checker symbols for resolver behavior.
- Use small direct generator inputs for final safety-boundary behavior.
- Assert both semantic behavior (no generated block for invalid targets) and
  syntactic behavior (zero parse diagnostics for every accepted target).
- Preserve explicit regression cases for local default/named aliases so a broad
  `ExportSpecifier` rejection cannot slip through review.
- Keep the existing snapshot suite unchanged as the broad integration guard.

## Done criteria

- [ ] Cross-module `export { default as X } from "..."` resolves to no runtime
      target and emits no `default.*` assignment.
- [ ] Local `export { Local as default }` and `export { Local as Public }`
      continue to target `Local`.
- [ ] Reserved or malformed roots never reach generated assignments.
- [ ] Valid paths, including `Namespace.default`, remain supported.
- [ ] Every accepted output in the new tests has zero syntax diagnostics.
- [ ] The loose-expression fallback is removed and target validation is shared.
- [ ] Existing snapshots remain unchanged.
- [ ] A patch changeset exists and no dependency/lockfile change occurs.
- [ ] Focused tests, full tests, typecheck, build, changed-file Biome, and Linux
      CI pass.
- [ ] `plans/README.md` marks Plan 003 `DONE`.

## STOP conditions

Stop and report if:

- Existing source differs materially from the current-state excerpts.
- The real TypeScript symbol fixture does not reproduce the reported target.
- A valid current target depends on the loose pattern or on a non-dotted
  expression grammar.
- Fixing the issue requires synthesizing a local import/binding or changing the
  upstream parser.
- Local export-specifier behavior cannot be preserved with a
  `moduleSpecifier` guard.
- A public API, dependency, existing snapshot, or out-of-scope file must change.
- A verification fails twice after one focused correction.

## Maintenance notes

- A re-exported name is not a local runtime binding. Future support for
  attaching metadata to re-exports must introduce a real imported binding.
- Keep generator validation even if resolver behavior changes; generated source
  is a trust boundary because syntax errors crash the entire module.
- Reserved-word validation applies only to the root segment. Property names such
  as `Namespace.default` are valid JavaScript.
- If a TypeScript or `react-docgen-typescript` update changes symbol shapes,
  retain the real `ExportSpecifier` regression rather than replacing it with a
  string-only test.
