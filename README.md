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

This plugins support all parser options from [react-docgen-typescript](https://github.com/styleguidist/react-docgen-typescript#parseroptions) and all of the following options:

| Option                         | Type           | Description                                                                                                                                         | Default         |
|--------------------------------| -------------- |-----------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|
| tsconfigPath                   | string         | Specify the location of the `tsconfig.json` to use.                                                                                                 | `null`          |
| compilerOptions                | object         | Specify compiler options. Cannot be used with `tsconfigPath`                                                                                        | `null`          |
| setDisplayName                 | boolean        | Set the components' display name. If you want to set display names yourself or are using another plugin to do this, you should disable this option. | `true`          |
| typePropName                   | string         | Specify the name of the property for docgen info prop type.                                                                                         | `type`          |
| exclude                        | string[]       | String globs to ignore and not generate docgen information for. (Great for ignoring large icon libraries)                                           | `["**/*.stories.tsx"]` |
| include                        | string[]       | String globs that select files for docgen information.                                                                                              | `["**/*.tsx"]` |
| fileSystemCache                | boolean/object | **Deprecated.** Persistent file-system cache. Remove this option or set it to `false`; existing boolean/object configurations still work.            | `false`         |
| docgenMode                     | `"legacy"` or `"project-service"` | Selects the TypeScript project runtime. ProjectService is the recommended stable opt-in.                                             | `"legacy"`      |
| EXPERIMENTAL_useWatchProgram   | boolean        | **Deprecated.** Enables the legacy WatchProgram runtime. Migrate to `docgenMode: "project-service"`.                                 | `false`         |
| EXPERIMENTAL_useProjectService | boolean        | **Deprecated.** Enables ProjectService. Migrate to `docgenMode: "project-service"`.                                                  | `false`         |

When `fileSystemCache` is enabled without a custom directory, cache entries are stored in `node_modules/.cache/vite-plugin-react-docgen-typescript`.

Persistent cache hits avoid repeat docgen extraction, but startup still loads TypeScript and validates the target program's current project membership and recorded dependency contents. Newly included declarations or module augmentations therefore invalidate stale metadata. Identical-source in-memory hits remain inexpensive.

During development, the plugin registers existing external type dependencies with Vite's watcher. External type files that are absent at startup may not trigger a refresh when first created; restart the server to pick them up. This limitation also applies when the persistent cache is disabled.

### Migrating from disk persistence

`fileSystemCache` is deprecated. Remove it from your configuration while keeping
your other options, or set it to `false`:

```ts
// Before
reactDocgenTypescript({ fileSystemCache: true });

// After
reactDocgenTypescript();
```

In-memory transform caching and TypeScript program reuse continue. Existing
boolean and object configurations, including custom cache directories, still
work during deprecation; the default remains `false`.

A 60-run performance recheck found
insufficient startup benefit and slower edit processing in the two tested Windows
fixtures across both stable modes. Those results support simplifying disk
persistence; they do not establish a speedup for every consumer.

Removal is intended for a later breaking release, after at least one published
compatible release carrying this notice. No removal version or date is set.

### Watching a known external type directory

For an existing external directory that you own, you can opt into watching newly
created type files through Vite's shared watcher. Add this small local plugin to
`vite.config.ts` alongside docgen:

```ts
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath } from "vite";
import reactDocgenTypescript from "@joshwooding/vite-plugin-react-docgen-typescript";

const externalTypesDirectory = fileURLToPath(
  new URL("../shared-types/", import.meta.url),
);

export default defineConfig({
  plugins: [
    reactDocgenTypescript(),
    {
      name: "watch-external-types",
      apply: "serve",
      config() {
        if (!statSync(externalTypesDirectory).isDirectory()) {
          throw new Error("externalTypesDirectory must be an existing directory");
        }
      },
      configureServer(server) {
        server.watcher.add(normalizePath(externalTypesDirectory));
      },
    },
  ],
});
```

The path is relative to the configuration file, not `process.cwd()`. Create the
chosen directory before starting the server. A missing path or regular file
fails development configuration before the watcher starts; this validation does
not run for production builds. Keep the directory small: its contents are watched
recursively, subject to existing depth limits and symlink settings. Avoid choosing
a repository or filesystem root.

Your watcher settings still apply. `server.watch: null` disables this workaround,
and ignored directories or files remain ignored, including Vite's default
`node_modules` exclusion. If those settings are intentional, restart to pick up
new types. Changing `server.fs.allow` is unnecessary; it controls file serving,
not watcher registration. Vite owns the shared watcher's shutdown, so the local
plugin needs no custom cleanup hook.

Registration is asynchronous. This example covers changes after the directory
watch is established; it does not guarantee writes during registration or removal
and recreation of the directory itself. If the directory was absent, create it
and restart. Consumers without this explicit configuration retain the initially
missing external-file limitation described above.

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

This plugin supports the TypeScript JavaScript compiler API in TypeScript
`>=4.3 <7`. TypeScript 7's root npm export does not provide the legacy stable
compiler API consumed by this plugin and `react-docgen-typescript`, so installing
TypeScript 7 as `typescript` produces an early compatibility error.

TypeScript 7 includes unstable native API subpaths, but they use a different
project, snapshot, and checker model. They are not a supported drop-in
replacement in this release. Native support needs a separate backend plus
parity, HMR, and packaging evidence before the peer range can be widened.
It will be reconsidered only when TypeScript provides either a stable
programmatic project API or a documented batched high-level checker that
removes the request amplification found in the native experiment. Any future
path must then pass the same parity, HMR, packed-package, and performance gates.

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
