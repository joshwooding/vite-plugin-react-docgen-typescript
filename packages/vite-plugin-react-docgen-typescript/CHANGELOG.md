# @joshwooding/vite-plugin-react-docgen-typescript

## 0.9.0

### Minor Changes

- 0ef782f: Add an experimental `docgenMode: "native"` backend for TypeScript 7.1's
  `typescript/unstable/sync` API, including imported-prop HMR and project-reference
  support. Native requests are batched and project/path state is reused across
  transforms. TypeScript 7.0 remains unsupported.
  
  In the [6 September 2026 CI run](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/actions/runs/34040796932),
  the 188-component fixture used seven projects, ten shared-type edits and two
  fresh processes per backend. Compared with ProjectService in that run, native
  reduced total cold time by 48% on Linux and 26% on Windows, and edit p50 by 31%
  and 11%, respectively. Post-edit retained RSS, including the native engine
  process, was 13% and 14% lower. Both platforms produced exact metadata agreement
  for all 188 components.
  
  Results depend on the workload: in the separate 24-file fixture, native's full
  session was 29% shorter on Linux but 35% longer on Windows. Cache-bypassed
  reanalysis was about four times slower on native on both platforms. These CI
  measurements are diagnostic and do not establish a speedup for every project.

### Patch Changes

- 8505fc5: Track complete component dependencies through cyclic imports regardless of transform order, so edits to shared types refresh every affected component's docgen metadata.
  
  Follow the compiler's resolved declaration targets and import/require modes, including referenced-project path mappings and unresolved conditional targets.
  
  Include existing global declarations, UMD namespaces, module augmentations, and their imported types in dependency tracking so live edits and offline edits invalidate cached metadata while ordinary modules retain selective invalidation.
- 8505fc5: Validate persistent docgen cache entries against the current TypeScript program before reuse, so newly included declarations, global types, and module augmentations invalidate stale metadata after a restart.
  
  Register existing external type dependencies with Vite's watcher so edits refresh affected components, including dependencies in referenced projects. External type files that are absent when the server starts remain a known watch limitation.
- 8505fc5: Deprecate `fileSystemCache` and annotate its options interface with `@deprecated`.
  Remove `fileSystemCache` from configuration or set it to `false`. In-memory
  transform caching and TypeScript program reuse continue. Existing boolean and
  object configurations, including custom directories, still work; the default
  remains `false`.
  
  A 60-run recheck on two Windows fixtures across both stable modes found
  insufficient startup benefit and slower edit processing with disk persistence.
  These results support simplifying the feature, without promising a speedup for
  every consumer.
  
  Removal is intended for a later breaking release, after at least one published
  compatible release carrying this notice. No removal version or date is set.
- 8505fc5: Reuse canonical dependency paths produced by the backend to avoid repeated filesystem resolution during analysis and persistent-cache validation.
- 8505fc5: Reuse canonical dependency paths during transforms to avoid repeated filesystem path resolution, while preserving physical path aliases and cache freshness checks.
- 8505fc5: Invalidate cached docgen metadata when a TypeScript config changes after loading persistent cache entries, including before the compiler backend starts.
  
  Register cached config paths with Vite's watcher so edits to custom configs and extended configs outside the Vite root trigger invalidation.

## 0.8.0

### Minor Changes

- 10ed37c: Add the stable `docgenMode: "project-service"` opt-in while retaining the
  existing legacy default. Deprecate the experimental WatchProgram and
  ProjectService option names; both remain functional for this release.

### Patch Changes

- 10ed37c: Canonicalize physical filesystem aliases when tracking project files and HMR
  dependencies, and exclude test-only declaration fixtures from the published
  package.
- 10ed37c: Bound the supported TypeScript peer range below 7, add an early compatibility
  diagnostic for unsupported compiler modules, and document the TypeScript 6
  compatibility-package workaround for side-by-side TypeScript 7 usage.
- 10ed37c: Declare support for Node.js 20 and Node.js 22 or newer, and refresh the glob dependency used for file selection.
- 10ed37c: Refresh dependent component docgen metadata when imported TypeScript props change through Vite HMR, including referenced-project and project-service setups.
- 10ed37c: Invalidate persistent docgen cache entries when imported TypeScript dependencies change between plugin instances.
- 10ed37c: Run docgen before Vite strips TypeScript syntax so project-service mode receives
  the component's imports and prop annotations instead of treating them as `any`.
- 10ed37c: Refresh TypeScript project membership when components or imported types are
  created, deleted, or recreated during Vite development without requiring a
  server restart.
- 10ed37c: Prevent barrel default re-exports from generating invalid `default.*` docgen
  assignments.
- 10ed37c: Select recursively referenced project files with consistent Vite-root-relative
  globs, preserve explicit empty include and exclude arrays, and reject non-string
  patterns with clear configuration errors.

## 0.7.0

### Minor Changes

- cd0fff6: - Add support for Vite 8.
  - Refactored the internal logic to improve correctness and improve performance.
  - Removed the CJS output to reduce the install size.

## 0.6.4

### Patch Changes

- d34c1ab: Upgrades glob to latest version

## 0.6.3

### Patch Changes

- 401ba3f: Upgraded glob to address CVE-2025-64756.

## 0.6.2

### Patch Changes

- ccb303e: Fixed sourcemap generation.

## 0.6.1

### Patch Changes

- c969a90: Expand vite peer dep range to support v7

## 0.6.0

### Minor Changes

- 0a0861f: Added `EXPERIMENTAL_useProjectService`. This option enables an experimental mode that uses the TS project service to enable HMR support.

### Patch Changes

- f2e2a5a: Fixed builds hanging if `EXPERIMENTAL_useWatchProgram` is enabled.
- 0c56631: Update magic-string

## 0.5.0

### Minor Changes

- ec0f7c3: - Update build tooling
  - Fix typescript and path imports
  - Refactor loops to improve performance

### Patch Changes

- 463faf4: Added `EXPERIMENTAL_useWatchProgram` to enable experimental watch behaviour.

## 0.4.2

### Patch Changes

- ea58da3: Support Vite 6

## 0.4.1

### Patch Changes

- 12793a6: Improved performance

## 0.4.0

### Minor Changes

- 159b8cd: Bump glob from v7 to v10.

## 0.3.1

### Patch Changes

- 2bcfd8f: Fix HMR support
