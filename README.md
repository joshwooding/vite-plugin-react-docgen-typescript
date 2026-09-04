# @joshwooding/vite-plugin-react-docgen-typescript

[![npm](https://img.shields.io/npm/v/@joshwooding/vite-plugin-react-docgen-typescript.svg)](https://www.npmjs.com/package/@joshwooding/vite-plugin-react-docgen-typescript)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

> A vite plugin to inject react typescript docgen information

&nbsp;

### Usage

```ts
import reactDocgenTypescript from "@joshwooding/vite-plugin-react-docgen-typescript";

export default {
  plugins: [reactDocgenTypescript()],
};
```

### Options

Legacy and ProjectService modes support all parser options from
[react-docgen-typescript](https://github.com/styleguidist/react-docgen-typescript#parseroptions).
Native mode supports the common metadata and filtering options listed below;
its `componentNameResolver` receives a name-compatible symbol facade because
TypeScript 7 uses different compiler objects.

| Option                         | Type           | Description                                                                                                                                         | Default         |
|--------------------------------| -------------- |-----------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|
| tsconfigPath                   | string         | Specify the location of the `tsconfig.json` to use.                                                                                                 | `null`          |
| compilerOptions                | object         | Specify compiler options. Cannot be used with `tsconfigPath`                                                                                        | `null`          |
| setDisplayName                 | boolean        | Set the components' display name. If you want to set display names yourself or are using another plugin to do this, you should disable this option. | `true`          |
| typePropName                   | string         | Specify the name of the property for docgen info prop type.                                                                                         | `type`          |
| exclude                        | string[]       | String globs to ignore and not generate docgen information for. (Great for ignoring large icon libraries)                                           | `["**/*.stories.tsx"]` |
| include                        | string[]       | String globs that select files for docgen information.                                                                                              | `["**/*.tsx"]` |
| fileSystemCache                | boolean/object | Enables a persistent file-system cache. Configure with `{ enabled?: boolean; directory?: string }`.                                                 | `false`         |
| docgenMode                     | `"legacy"`, `"project-service"`, or `"native"` | Selects the TypeScript project runtime. Native mode is experimental and requires TypeScript 7.1.                                    | `"legacy"`      |
| EXPERIMENTAL_useWatchProgram   | boolean        | **Deprecated.** Enables the legacy WatchProgram runtime. Migrate to `docgenMode: "project-service"`.                                 | `false`         |
| EXPERIMENTAL_useProjectService | boolean        | **Deprecated.** Enables ProjectService. Migrate to `docgenMode: "project-service"`.                                                  | `false`         |

When `fileSystemCache` is enabled without a custom directory, cache entries are stored in `node_modules/.cache/vite-plugin-react-docgen-typescript`.

### Runtime selection and migration

Omitting `docgenMode` still uses the existing `"legacy"` builder. This release
does not switch the default. The recommended stable opt-in is:

```ts
reactDocgenTypescript({
  docgenMode: "project-service",
});
```

ProjectService keeps the existing `react-docgen-typescript` parser while
providing fresh imported-type HMR without a separate TypeScript filesystem
watcher lifecycle. To migrate from either experimental option, replace:

```ts
// Before: either deprecated spelling
reactDocgenTypescript({ EXPERIMENTAL_useWatchProgram: true });
reactDocgenTypescript({ EXPERIMENTAL_useProjectService: true });

// After
reactDocgenTypescript({ docgenMode: "project-service" });
```

Both deprecated options remain functional for this release and warn once per
plugin instance. When both old flags are set, ProjectService retains its
existing precedence. Do not combine `docgenMode` with either experimental
option; that is a configuration error naming the conflicting options.

Use the stable legacy spelling as an explicit rollback:

```ts
reactDocgenTypescript({
  docgenMode: "legacy",
});
```

TypeScript 7.1 prereleases can use the experimental native backend:

```ts
reactDocgenTypescript({
  docgenMode: "native",
});
```

Native mode uses TypeScript's `typescript/unstable/sync` API directly and does
not load `react-docgen-typescript`. It currently targets function components,
including `forwardRef` and default exports. Because the upstream API is
unstable, pin the TypeScript prerelease in CI and expect compatibility changes
before TypeScript 7.1 is stable.

### File selection

`include` and `exclude` accept arrays of string globs only; runtime `RegExp`
values and mixed arrays are rejected during configuration. Relative patterns
resolve from Vite's configured root rather than `process.cwd()`.

An explicit `include: []` disables docgen processing. An explicit `exclude: []`
removes the default `**/*.stories.tsx` exclusion. The default `**/*.tsx`
selection applies to TSX members of the configured root and its recursively
referenced TypeScript projects. Parent-directory patterns such as
`../ui/**/*.tsx` can narrow selection to a referenced package.

When a tsconfig is configured, its root files and project references remain the
membership boundary: patterns do not pull arbitrary files into the TypeScript
project. Nonmatching TypeScript roots and declaration files remain available
for type analysis without becoming docgen transform targets.

### Runtime compatibility

This plugin supports Node.js 20 and Node.js 22 or newer. Node.js 21 is not
supported. Its published Vite peer range remains Vite 3 through Vite 8; the
plugin's Node.js requirement is authoritative even when an older Vite release
historically supported an earlier Node.js version.

### TypeScript compatibility

Legacy and ProjectService modes support TypeScript `>=4.3 <7`. TypeScript 7 no
longer exports the legacy compiler API from the package root, so those modes
produce an early compatibility error when TypeScript 7 is installed.

Experimental native mode supports current TypeScript 7.1 prereleases through
`typescript/unstable/sync`. TypeScript 7.0 is not supported because it lacks the
program and temporary-file APIs required by this backend.

If a project needs the TypeScript 7 CLI alongside docgen, expose Microsoft's
TypeScript 6 compatibility package under the name `typescript` and install
TypeScript 7 under another alias:

```json
{
  "devDependencies": {
    "typescript": "npm:@typescript/typescript6@6.0.x",
    "typescript7": "npm:typescript@7.0.2"
  }
}
```

This keeps docgen on the TypeScript 6 compiler API; it does not make the plugin
use TypeScript 7. Yarn 4.13 applies an incompatible built-in patch to that
reverse alias, so Yarn users should install `typescript@6.0.x` under its normal
name instead and keep TypeScript 7 on the separate alias.

### Performance benchmarking

Repository contributors can compare the legacy and ProjectService backends on
a generated monorepo containing 188 components across seven TypeScript
projects:

```sh
yarn benchmark:backends:ci
```

The harness runs every backend in a fresh process, counterbalances execution
order, and measures cold extraction plus shared-type edits that invalidate
every component. Reports retain raw samples, p50/p95 latency, normalized output
parity, forced-GC heap, and aggregate process memory. CI runs the benchmark on
Linux and Windows and uploads the JSON report without enforcing a timing
threshold.

The same harness can compare two separately built revisions without loading
both plugins into one process:

```sh
node scripts/benchmark-backends.mjs \
  --plugin-entry ../trunk/packages/vite-plugin-react-docgen-typescript/dist/index.mjs \
  --label trunk \
  --compare-plugin-entry ../candidate/packages/vite-plugin-react-docgen-typescript/dist/index.mjs \
  --compare-label candidate \
  --modes projectService \
  --iterations 6 \
  --edits 50 \
  --require-parity
```

Use modes supported by both revisions for direct comparisons. Optional internal
phase timings are recorded when a plugin build exposes benchmark telemetry;
end-to-end latency, output parity, and process memory remain available for older
builds that do not.

TypeScript 7 contributors can additionally compare TypeScript 6 ProjectService
with the native backend on the representative design-system fixture:

```sh
yarn benchmark:native:ci
```

The benchmark counterbalances mode order, retains every measured run, and
reports cold transforms, memory-cache hits, backend re-analysis, and HMR
separately. Native timing also separates TypeScript server processing from API
transport overhead. CI runs the same comparison on Linux and Windows and
uploads the raw JSON result as a workflow artifact; timings are diagnostic and
do not currently enforce a release threshold.

To diagnose native API request amplification without affecting the normal CI
timings, add `--native-request-profile` when running
`scripts/benchmark-backends.mjs`. The resulting JSON separates physical
transport calls from logical requests carried inside TypeScript batch calls.
