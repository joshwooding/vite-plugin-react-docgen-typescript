import { EventEmitter } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type BackendProjectState,
  type DocgenBackend,
  type DocgenBackendFactory,
  toBackendErrorRecord,
} from "../docgen/backend";
import {
  createLegacyBackendFactory,
  createUnresolvedCaptureResolutionHost,
  isNodeModulesPath,
} from "../docgen/legacyBackend";
import {
  cleanBoundaryPath,
  normalizeBoundaryPath,
  normalizeBoundaryPaths,
} from "../docgen/pathIdentity";
import { isSupportedRuntimeTargetExpression } from "../docgen/runtimeTarget";
import { createPlugin } from "../plugin";
import {
  createFileSelectionFingerprint,
  createFileSystemCacheNamespace,
  createFileSystemCacheProof,
  isFileSystemCacheProofValid,
} from "../utils/cache";
import { resolveFileSelection } from "../utils/fileSelection";
import type { Options } from "../utils/options";
import { loadTypescript } from "../utils/typescriptCompatibility";

const projectState = (generation: number): BackendProjectState => ({
  configFiles: [path.resolve("tsconfig.json")],
  docgenFiles: [path.resolve("src/Component.tsx")],
  generation,
  trackedFiles: [
    path.resolve("src/Component.tsx"),
    path.resolve("src/types.ts"),
  ],
});

describe("compiler-neutral backend contract", () => {
  it("normalizes boundary paths once and deterministically", () => {
    expect(cleanBoundaryPath("src/Component.tsx?direct#fragment")).toBe(
      "src/Component.tsx",
    );
    expect(normalizeBoundaryPath("src/Component.tsx?direct")).toBe(
      path.resolve("src/Component.tsx"),
    );
    expect(
      normalizeBoundaryPaths([
        "src/types.ts#one",
        "src/Component.tsx?direct",
        "src/types.ts",
      ]),
    ).toEqual(
      [path.resolve("src/Component.tsx"), path.resolve("src/types.ts")].sort(),
    );
  });

  it("keeps the strict compiler-neutral runtime target grammar", () => {
    expect(isSupportedRuntimeTargetExpression("Button")).toBe(true);
    expect(isSupportedRuntimeTargetExpression("Card.Header")).toBe(true);
    expect(isSupportedRuntimeTargetExpression("default")).toBe(false);
    expect(isSupportedRuntimeTargetExpression("Button[0]")).toBe(false);
  });

  it("discovers candidates below missing directories without persisting node_modules lookups", async () => {
    expect(isNodeModulesPath("C:\\repo\\node_modules\\package\\index.ts")).toBe(
      true,
    );
    expect(isNodeModulesPath("/repo/node_modules/package/index.ts")).toBe(true);
    expect(isNodeModulesPath("/repo/node_modules-other/package/index.ts")).toBe(
      false,
    );

    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-candidates-"));
    const sourceRoot = path.join(root, "src");
    const componentFile = path.join(sourceRoot, "Component.tsx");
    const nestedCandidate = path.join(sourceRoot, "nested", "missing.ts");
    const source = `import type { Nested } from "@/nested/missing";
import type { PackageType } from "uninstalled-package";
export const Component = (_props: Nested & PackageType) => null;`;
    const compilerOptions = {
      baseUrl: ".",
      jsx: "preserve",
      module: "ESNext",
      moduleResolution: "Bundler",
      paths: { "@/*": ["src/*"] },
      target: "ES2020",
    };
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(componentFile, source);
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions,
        include: ["src/**/*"],
      }),
    );
    const options: Options = {
      exclude: [],
      include: ["src/**/*.tsx"],
      tsconfigPath: "tsconfig.json",
    };
    const backend = await createLegacyBackendFactory(options).create({
      rootDir: root,
      selection: resolveFileSelection(root, options),
    });

    try {
      const typescriptModule = await loadTypescript();
      const probedFiles: string[] = [];
      const captureHost = createUnresolvedCaptureResolutionHost(
        typescriptModule.sys,
        (fileName) => probedFiles.push(fileName),
      );
      expect(
        captureHost.directoryExists?.(path.join(sourceRoot, "nested")),
      ).toBe(true);
      for (const nodeModulesDirectory of [
        path.join(root, "node_modules", "missing"),
        "C:\\repo\\NODE_MODULES\\missing",
        "/repo/node_modules/missing",
      ]) {
        expect(captureHost.directoryExists?.(nodeModulesDirectory)).toBe(false);
      }
      typescriptModule.resolveModuleName(
        "uninstalled-package",
        componentFile,
        {},
        captureHost,
        undefined,
      );
      expect(probedFiles).toHaveLength(8);
      expect(probedFiles.filter(isNodeModulesPath)).toEqual([]);

      await backend.initialize();
      const analysis = await backend.analyze({
        fileName: componentFile,
        revision: 0,
        source,
      });
      expect(analysis.unresolvedDependencies).toContain(
        path.resolve(nestedCandidate),
      );
      expect(
        analysis.unresolvedDependencies?.filter(isNodeModulesPath),
      ).toEqual([]);
    } finally {
      await backend.dispose();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("sanitizes thrown values before they cross the backend seam", () => {
    const cause = new TypeError("broken parser");
    expect(toBackendErrorRecord(cause)).toEqual({
      message: "broken parser",
      name: "TypeError",
      stack: cause.stack,
    });
    expect(toBackendErrorRecord("plain failure")).toEqual({
      message: "plain failure",
      name: "Error",
    });
  });

  it("expresses ready, superseded, reset, and idempotent disposal outcomes", async () => {
    let disposed = false;
    let initialized = false;
    let latestRevision = 0;
    const backend: DocgenBackend = {
      async analyze({ fileName, revision }) {
        latestRevision = Math.max(latestRevision, revision);
        return {
          components: [],
          dependencies: [fileName],
          project: projectState(1),
          revision,
          status: "ok",
        };
      },
      async dispose() {
        disposed = true;
      },
      async initialize() {
        initialized = true;
        return projectState(1);
      },
      recordCacheHit() {},
      async reset({ revision }) {
        initialized = false;
        return disposed
          ? { revision, status: "disposed" }
          : { revision, status: "reset" };
      },
      async update({ change }) {
        if (disposed) {
          return {
            ready: Promise.resolve({
              revision: change.revision,
              status: "disposed",
            }),
            revision: change.revision,
            status: "pending",
          };
        }
        if (change.revision < latestRevision) {
          return {
            ready: Promise.resolve({
              revision: change.revision,
              status: "superseded",
              supersededBy: latestRevision,
            }),
            revision: change.revision,
            status: "pending",
          };
        }
        latestRevision = change.revision;
        return {
          project: projectState(change.revision),
          revision: change.revision,
          status: "ready",
        };
      },
    };
    const factory: DocgenBackendFactory = {
      async create() {
        return backend;
      },
      describe() {
        return { cacheFingerprint: "fake@1/schema-1", id: "fake" };
      },
    };

    expect(factory.describe({ rootDir: process.cwd() })).toEqual({
      cacheFingerprint: "fake@1/schema-1",
      id: "fake",
    });
    expect(await backend.initialize()).toEqual(projectState(1));
    expect(initialized).toBe(true);
    expect(
      await backend.analyze({
        fileName: path.resolve("src/Component.tsx"),
        revision: 2,
        source: "source",
      }),
    ).toEqual(
      expect.objectContaining({
        dependencies: [path.resolve("src/Component.tsx")],
        revision: 2,
        status: "ok",
      }),
    );
    const superseded = await backend.update({
      affectedComponentFiles: [],
      change: {
        fileName: path.resolve("src/types.ts"),
        kind: "change",
        revision: 1,
        source: "old",
      },
    });
    expect(superseded.status).toBe("pending");
    if (superseded.status === "pending") {
      expect(await superseded.ready).toEqual({
        revision: 1,
        status: "superseded",
        supersededBy: 2,
      });
    }
    expect(await backend.reset({ revision: 3 })).toEqual({
      revision: 3,
      status: "reset",
    });
    await backend.dispose();
    await backend.dispose();
    expect(disposed).toBe(true);
  });

  it.each([
    ["same-project", "default", {}],
    ["same-project", "watch", { EXPERIMENTAL_useWatchProgram: true }],
    [
      "same-project",
      "project-service",
      { EXPERIMENTAL_useProjectService: true },
    ],
    ["project-reference", "default", {}],
    ["project-reference", "watch", { EXPERIMENTAL_useWatchProgram: true }],
    [
      "project-reference",
      "project-service",
      { EXPERIMENTAL_useProjectService: true },
    ],
  ] as const)(
    "keeps direct legacy dependencies and imported metadata fresh in %s/%s isolation",
    async (topology, _mode, modeOptions) => {
      const commonRoot = mkdtempSync(
        path.join(tmpdir(), "vite-rdt-isolation-"),
      );
      const root = path.join(commonRoot, "app");
      const sourceRoot =
        topology === "same-project"
          ? path.join(root, "src")
          : path.join(commonRoot, "ui", "src");
      const componentFile = path.join(sourceRoot, "Component.tsx");
      const outsideFile = path.join(sourceRoot, "Outside.tsx");
      const propsFile = path.join(sourceRoot, "props.ts");
      const unrelatedFile = path.join(sourceRoot, "Unrelated.tsx");
      mkdirSync(sourceRoot, { recursive: true });
      mkdirSync(root, { recursive: true });
      const componentSource = `declare namespace JSX { interface Element {} }
import type { ImportedProps } from "./props";
export const Dependent = ({ tone }: ImportedProps): JSX.Element =>
  null as unknown as JSX.Element;
`;
      writeFileSync(componentFile, componentSource);
      writeFileSync(
        propsFile,
        `export interface ImportedProps {
  /** Initial tone. */
  tone: "base" | "quiet";
}
`,
      );
      writeFileSync(
        unrelatedFile,
        "export const Unrelated = ({ value }: { value: string }) => value;\n",
      );
      const compilerOptions = {
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
        target: "ES2020",
      };
      if (topology === "same-project") {
        writeFileSync(
          path.join(root, "tsconfig.json"),
          JSON.stringify({
            compilerOptions,
            files: ["src/Component.tsx", "src/props.ts", "src/Unrelated.tsx"],
          }),
        );
      } else {
        writeFileSync(
          path.join(root, "tsconfig.json"),
          JSON.stringify({ files: [], references: [{ path: "../ui" }] }),
        );
        writeFileSync(
          path.join(commonRoot, "ui", "tsconfig.json"),
          JSON.stringify({
            compilerOptions: { ...compilerOptions, composite: true },
            files: ["src/Component.tsx", "src/props.ts", "src/Unrelated.tsx"],
          }),
        );
      }
      const options: Options = {
        ...modeOptions,
        exclude: [],
        include:
          topology === "same-project" ? ["src/**/*.tsx"] : ["../ui/**/*.tsx"],
        shouldExtractValuesFromUnion: true,
        tsconfigPath: "tsconfig.json",
      };
      const backend = await createLegacyBackendFactory(options).create({
        rootDir: root,
        selection: resolveFileSelection(root, options),
      });

      const analyze = async (revision: number) => {
        const result = await backend.analyze({
          fileName: componentFile,
          revision,
          source: componentSource,
        });
        expect(result.status).toBe("ok");
        if (result.status !== "ok") throw new Error(result.error.message);
        expect(result.dependencies).toEqual(
          [path.resolve(componentFile), path.resolve(propsFile)].sort(),
        );
        expect(result.dependencies).not.toContain(path.resolve(unrelatedFile));
        return result.components[0]?.props.tone;
      };

      try {
        await backend.initialize();
        expect((await analyze(0))?.description).toBe("Initial tone.");
        for (const [revision, member] of [
          [1, "contrast"],
          [2, "emphasis"],
        ] as const) {
          const source = `export interface ImportedProps {
  /** ${member} tone. */
  tone: "base" | "quiet" | "${member}";
}
`;
          writeFileSync(propsFile, source);
          const update = await backend.update({
            affectedComponentFiles: [componentFile],
            change: {
              fileName: propsFile,
              kind: "change",
              revision,
              source,
            },
          });
          if (update.status === "pending") {
            const completion = await Promise.race([
              update.ready,
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error("direct update readiness timed out")),
                  10_000,
                ),
              ),
            ]);
            expect(completion.status).toBe("ready");
          } else {
            expect(update.status).toBe("ready");
          }
          const prop = await analyze(revision);
          expect(prop?.description).toBe(`${member} tone.`);
          expect(JSON.stringify(prop?.type.value)).toContain(member);
          expect(readFileSync(propsFile, "utf-8")).toBe(source);
        }
        const stateBeforeIgnoredCreation = await backend.initialize();
        writeFileSync(outsideFile, componentSource);
        const ignoredCreation = await backend.update({
          affectedComponentFiles: [],
          change: {
            fileName: outsideFile,
            kind: "create",
            revision: 3,
            source: componentSource,
          },
        });
        expect(ignoredCreation.status).toBe("ignored");
        const stateAfterIgnoredCreation = await backend.initialize();
        expect(stateAfterIgnoredCreation.generation).toBe(
          stateBeforeIgnoredCreation.generation,
        );
        expect(stateAfterIgnoredCreation.docgenFiles).not.toContain(
          path.resolve(outsideFile),
        );
        expect(stateAfterIgnoredCreation.trackedFiles).not.toContain(
          path.resolve(outsideFile),
        );
      } finally {
        await backend.dispose();
        rmSync(commonRoot, { force: true, recursive: true });
      }
    },
    60_000,
  );

  it("keeps serve lazy, build eager, and empty selection compiler-free", async () => {
    const componentFile = path.resolve("src/Component.tsx");
    const counters = { create: 0, initialize: 0 };
    const factory: DocgenBackendFactory = {
      async create() {
        counters.create += 1;
        return {
          async analyze({ revision }) {
            return {
              components: [],
              dependencies: [componentFile],
              project: projectState(1),
              revision,
              status: "ok",
            };
          },
          async dispose() {},
          async initialize() {
            counters.initialize += 1;
            return projectState(1);
          },
          recordCacheHit() {},
          async reset({ revision }) {
            return { revision, status: "reset" };
          },
          async update({ change }) {
            return {
              project: projectState(1),
              revision: change.revision,
              status: "ready",
            };
          },
        };
      },
      describe() {
        return { cacheFingerprint: "fake/schema-1", id: "fake" };
      },
    };

    const servePlugin = createPlugin({}, factory);
    // @ts-expect-error Focused harness supplies only the resolved fields used.
    await servePlugin.configResolved?.({
      command: "serve",
      root: process.cwd(),
    });
    expect(counters).toEqual({ create: 0, initialize: 0 });

    const buildPlugin = createPlugin({}, factory);
    // @ts-expect-error Focused harness supplies only the resolved fields used.
    await buildPlugin.configResolved?.({
      command: "build",
      root: process.cwd(),
    });
    expect(counters).toEqual({ create: 1, initialize: 1 });

    const emptyBuildPlugin = createPlugin({ include: [] }, factory);
    // @ts-expect-error Focused harness supplies only the resolved fields used.
    await emptyBuildPlugin.configResolved?.({
      command: "build",
      root: process.cwd(),
    });
    expect(counters).toEqual({ create: 1, initialize: 1 });

    await Promise.all([
      servePlugin.transform?.call(
        { warn: vi.fn() } as never,
        "export const Component = () => null;",
        componentFile,
      ),
      servePlugin.transform?.call(
        { warn: vi.fn() } as never,
        "export const Component = () => null;",
        componentFile,
      ),
    ]);
    expect(counters).toEqual({ create: 2, initialize: 2 });

    for (const plugin of [servePlugin, buildPlugin, emptyBuildPlugin]) {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call({} as never);
      }
    }
  });

  it("reuses only proof-bearing cold entries with matching backend and config identity", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-contract-"));
    const componentFile = path.join(root, "Component.tsx");
    const configFile = path.join(root, "membership.json");
    const dependencyFile = path.join(root, "types.ts");
    const source = "export const Component = () => null;";
    const cacheRoot = path.join(root, ".cache");
    writeFileSync(componentFile, source);
    writeFileSync(configFile, '{"member":true}');
    writeFileSync(dependencyFile, "export type Variant = 'primary';");

    const options: Options = {
      compilerOptions: { jsx: 2 },
      fileSystemCache: { directory: cacheRoot, enabled: true },
    };
    const selection = resolveFileSelection(root, options);
    const selectionFingerprint = createFileSelectionFingerprint(selection);
    const descriptor = { cacheFingerprint: "fake/schema-1", id: "fake" };
    const namespace = createFileSystemCacheNamespace(
      options,
      root,
      descriptor.cacheFingerprint,
    );
    const proof = createFileSystemCacheProof({
      backendFingerprint: descriptor.cacheFingerprint,
      componentFile,
      configFiles: [configFile],
      dependencies: [dependencyFile, componentFile],
      selectionFingerprint,
    });
    let createCount = 0;
    const factory: DocgenBackendFactory = {
      async create() {
        createCount += 1;
        const state: BackendProjectState = {
          configFiles: [configFile],
          docgenFiles: [componentFile],
          generation: 1,
          trackedFiles: [componentFile, dependencyFile].sort(),
        };
        return {
          async analyze({ revision }) {
            return {
              components: [],
              dependencies: [componentFile, dependencyFile].sort(),
              project: state,
              revision,
              status: "ok",
            };
          },
          async dispose() {},
          async initialize() {
            return state;
          },
          recordCacheHit() {},
          async reset({ revision }) {
            return { revision, status: "reset" };
          },
          async update({ change }) {
            return {
              project: state,
              revision: change.revision,
              status: "ready",
            };
          },
        };
      },
      describe() {
        return descriptor;
      },
    };

    try {
      const seedPlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await seedPlugin.configResolved?.({ command: "serve", root });
      expect(
        await seedPlugin.transform?.call(
          { warn: vi.fn() } as never,
          source,
          componentFile,
        ),
      ).toBeNull();
      expect(createCount).toBe(1);
      if (typeof seedPlugin.closeBundle === "function") {
        await seedPlugin.closeBundle.call({} as never);
      }

      const warmPlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await warmPlugin.configResolved?.({ command: "serve", root });
      expect(
        await warmPlugin.transform?.call(
          { warn: vi.fn() } as never,
          source,
          componentFile,
        ),
      ).toBeNull();
      expect(createCount).toBe(1);

      expect(
        createFileSystemCacheNamespace(options, root, "fake/schema-2"),
      ).not.toBe(namespace);
      expect(
        isFileSystemCacheProofValid(proof, {
          backendFingerprint: descriptor.cacheFingerprint,
          componentFile,
          selectionFingerprint,
        }),
      ).toBe(true);

      writeFileSync(configFile, '{"member":false}');
      expect(
        isFileSystemCacheProofValid(proof, {
          backendFingerprint: descriptor.cacheFingerprint,
          componentFile,
          selectionFingerprint,
        }),
      ).toBe(false);

      const stalePlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await stalePlugin.configResolved?.({ command: "serve", root });
      expect(
        await stalePlugin.transform?.call(
          { warn: vi.fn() } as never,
          source,
          componentFile,
        ),
      ).toBeNull();
      expect(createCount).toBe(2);

      writeFileSync(configFile, '{"member":true}');
      const refreshedPlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await refreshedPlugin.configResolved?.({ command: "serve", root });
      expect(
        await refreshedPlugin.transform?.call(
          { warn: vi.fn() } as never,
          source,
          componentFile,
        ),
      ).toBeNull();
      expect(createCount).toBe(3);
      if (typeof refreshedPlugin.closeBundle === "function") {
        await refreshedPlugin.closeBundle.call({} as never);
      }

      rmSync(dependencyFile);
      const deletedDependencyPlugin = createPlugin(options, factory);
      const deletedDependencyWarnings = vi.fn();
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await deletedDependencyPlugin.configResolved?.({
        command: "serve",
        root,
      });
      await expect(
        deletedDependencyPlugin.transform?.call(
          { warn: deletedDependencyWarnings } as never,
          source,
          componentFile,
        ),
      ).resolves.toBeNull();
      expect(createCount).toBe(4);
      expect(deletedDependencyWarnings).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write the docgen file-system cache"),
      );

      writeFileSync(dependencyFile, "export type Variant = 'secondary';");
      const rewrittenDependencyPlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await rewrittenDependencyPlugin.configResolved?.({
        command: "serve",
        root,
      });
      expect(
        await rewrittenDependencyPlugin.transform?.call(
          { warn: vi.fn() } as never,
          source,
          componentFile,
        ),
      ).toBeNull();
      expect(createCount).toBe(5);
      if (typeof rewrittenDependencyPlugin.closeBundle === "function") {
        await rewrittenDependencyPlugin.closeBundle.call({} as never);
      }

      rmSync(dependencyFile);
      mkdirSync(dependencyFile);
      const unreadableDependencyPlugin = createPlugin(options, factory);
      const unreadableDependencyWarnings = vi.fn();
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await unreadableDependencyPlugin.configResolved?.({
        command: "serve",
        root,
      });
      await expect(
        unreadableDependencyPlugin.transform?.call(
          { warn: unreadableDependencyWarnings } as never,
          source,
          componentFile,
        ),
      ).resolves.toBeNull();
      expect(createCount).toBe(6);
      expect(unreadableDependencyWarnings).toHaveBeenCalledWith(
        expect.stringContaining("Failed to write the docgen file-system cache"),
      );

      for (const plugin of [
        seedPlugin,
        warmPlugin,
        stalePlugin,
        deletedDependencyPlugin,
        unreadableDependencyPlugin,
      ]) {
        if (typeof plugin.closeBundle === "function") {
          await plugin.closeBundle.call({} as never);
        }
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("keeps warm persistent-cache dependency edits and unresolved creations live before backend startup", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-warm-hmr-"));
    const componentFile = path.join(root, "Component.tsx");
    const dependencyFile = path.join(root, "types.ts");
    const missingDependencyFile = path.join(root, "missing.ts");
    const cacheRoot = path.join(root, ".cache");
    const source = `import type { Props } from "./types";
import type { Missing } from "./missing";
export const Component = (_props: Props & Missing) => null;`;
    writeFileSync(componentFile, source);
    writeFileSync(dependencyFile, "export interface Props { value: string }");
    const options: Options = {
      compilerOptions: { jsx: 2 },
      fileSystemCache: { directory: cacheRoot, enabled: true },
    };
    let createCount = 0;
    const factory: DocgenBackendFactory = {
      async create() {
        createCount += 1;
        const getState = (): BackendProjectState => ({
          configFiles: [],
          docgenFiles: [componentFile],
          generation: existsSync(missingDependencyFile) ? 2 : 1,
          trackedFiles: [
            componentFile,
            dependencyFile,
            ...(existsSync(missingDependencyFile)
              ? [missingDependencyFile]
              : []),
          ].sort(),
        });
        return {
          async analyze({ revision }) {
            return {
              components: [],
              dependencies: [componentFile, dependencyFile].sort(),
              project: getState(),
              revision,
              status: "ok",
            };
          },
          async dispose() {},
          async initialize() {
            return getState();
          },
          recordCacheHit() {},
          async reset({ revision }) {
            return { revision, status: "reset" };
          },
          async update({ change }) {
            return {
              project: getState(),
              revision: change.revision,
              status: "ready",
            };
          },
        };
      },
      describe() {
        return { cacheFingerprint: "warm/schema-1", id: "warm" };
      },
    };
    const componentModule = { id: componentFile, url: componentFile };
    const graph = {
      getModulesByFile: (fileName: string) =>
        fileName === componentFile ? new Set([componentModule]) : undefined,
    };

    try {
      const seedPlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await seedPlugin.configResolved?.({ command: "serve", root });
      await expect(
        seedPlugin.transform?.call(
          { warn: vi.fn() } as never,
          source,
          componentFile,
        ),
      ).resolves.toBeNull();
      expect(createCount).toBe(1);
      if (typeof seedPlugin.closeBundle === "function") {
        await seedPlugin.closeBundle.call({} as never);
      }

      const warmPlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await warmPlugin.configResolved?.({ command: "serve", root });
      await expect(
        warmPlugin.transform?.call(
          { warn: vi.fn() } as never,
          source,
          componentFile,
        ),
      ).resolves.toBeNull();
      expect(createCount).toBe(1);
      if (typeof warmPlugin.hotUpdate !== "function") {
        throw new Error("Expected the Vite 6+ hotUpdate hook");
      }

      writeFileSync(dependencyFile, "export interface Props { value: number }");
      await expect(
        warmPlugin.hotUpdate.call(
          { environment: { moduleGraph: graph }, warn: vi.fn() } as never,
          {
            file: dependencyFile,
            modules: [],
            read: () => readFileSync(dependencyFile, "utf-8"),
            server: {},
            timestamp: 1,
            type: "update",
          } as never,
        ),
      ).resolves.toEqual([componentModule]);
      expect(createCount).toBe(1);

      writeFileSync(
        missingDependencyFile,
        "export interface Missing { created: true }",
      );
      await expect(
        warmPlugin.hotUpdate.call(
          { environment: { moduleGraph: graph }, warn: vi.fn() } as never,
          {
            file: missingDependencyFile,
            modules: [],
            read: () => readFileSync(missingDependencyFile, "utf-8"),
            server: {},
            timestamp: 2,
            type: "create",
          } as never,
        ),
      ).resolves.toEqual([componentModule]);
      expect(createCount).toBe(2);
      if (typeof warmPlugin.closeBundle === "function") {
        await warmPlugin.closeBundle.call({} as never);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("rejects a persistent hit when an unresolved candidate was created offline", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-offline-create-"));
    const componentFile = path.join(root, "Component.tsx");
    const missingDependencyFile = path.join(root, "missing.ts");
    const cacheRoot = path.join(root, ".cache");
    const source =
      'import type { Missing } from "./missing"; export const Component = (_props: Missing) => null;';
    writeFileSync(componentFile, source);
    const options: Options = {
      compilerOptions: { jsx: 2 },
      fileSystemCache: { directory: cacheRoot, enabled: true },
    };
    let analyzeCount = 0;
    let createCount = 0;
    const factory: DocgenBackendFactory = {
      async create() {
        createCount += 1;
        const state: BackendProjectState = {
          configFiles: [],
          docgenFiles: [componentFile],
          generation: existsSync(missingDependencyFile) ? 2 : 1,
          trackedFiles: [
            componentFile,
            ...(existsSync(missingDependencyFile)
              ? [missingDependencyFile]
              : []),
          ].sort(),
        };
        return {
          async analyze({ revision }) {
            analyzeCount += 1;
            return {
              components: [],
              dependencies: [componentFile],
              project: state,
              revision,
              status: "ok",
            };
          },
          async dispose() {},
          async initialize() {
            return state;
          },
          recordCacheHit() {},
          async reset({ revision }) {
            return { revision, status: "reset" };
          },
          async update({ change }) {
            return {
              project: state,
              revision: change.revision,
              status: "ready",
            };
          },
        };
      },
      describe() {
        return {
          cacheFingerprint: "offline-create/schema-1",
          id: "offline-create",
        };
      },
    };

    try {
      const seedPlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await seedPlugin.configResolved?.({ command: "serve", root });
      await seedPlugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      if (typeof seedPlugin.closeBundle === "function") {
        await seedPlugin.closeBundle.call({} as never);
      }
      expect({ analyzeCount, createCount }).toEqual({
        analyzeCount: 1,
        createCount: 1,
      });

      writeFileSync(
        missingDependencyFile,
        "export interface Missing { recovered: true }",
      );
      const reopenedPlugin = createPlugin(options, factory);
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await reopenedPlugin.configResolved?.({ command: "serve", root });
      await reopenedPlugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      expect({ analyzeCount, createCount }).toEqual({
        analyzeCount: 2,
        createCount: 2,
      });
      if (typeof reopenedPlugin.closeBundle === "function") {
        await reopenedPlugin.closeBundle.call({} as never);
      }
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("requires canonical and current dependency content fingerprints", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-proof-"));
    const componentFile = path.join(root, "Component.tsx");
    const dependencyFile = path.join(root, "types.ts");
    writeFileSync(componentFile, "export const Component = () => null;");
    writeFileSync(dependencyFile, "export type Variant = 'primary';");

    try {
      const proof = createFileSystemCacheProof({
        backendFingerprint: "proof/schema-1",
        componentFile,
        configFiles: [],
        dependencies: [dependencyFile, componentFile, dependencyFile],
        selectionFingerprint: "selection-1",
      });
      const expected = {
        backendFingerprint: "proof/schema-1",
        componentFile,
        selectionFingerprint: "selection-1",
      };

      expect(
        proof.dependencyFingerprints.map(({ fileName }) => fileName),
      ).toEqual([dependencyFile]);
      expect(isFileSystemCacheProofValid(proof, expected)).toBe(true);

      const firstDependencyFingerprint = proof.dependencyFingerprints[0];
      if (!firstDependencyFingerprint) {
        throw new Error("Expected a dependency fingerprint");
      }
      const duplicateProof = {
        ...proof,
        dependencyFingerprints: [
          ...proof.dependencyFingerprints,
          firstDependencyFingerprint,
        ],
      };
      expect(isFileSystemCacheProofValid(duplicateProof, expected)).toBe(false);

      const malformedProof = {
        ...proof,
        dependencyFingerprints: [
          {
            contentHash: "not-a-sha-256",
            fileName: dependencyFile,
          },
        ],
      };
      expect(isFileSystemCacheProofValid(malformedProof, expected)).toBe(false);
      expect(
        isFileSystemCacheProofValid(
          {
            ...proof,
            dependencyFingerprints: undefined as never,
          },
          expected,
        ),
      ).toBe(false);

      writeFileSync(dependencyFile, "export type Variant = 'secondary';");
      expect(isFileSystemCacheProofValid(proof, expected)).toBe(false);

      writeFileSync(dependencyFile, "export type Variant = 'primary';");
      expect(isFileSystemCacheProofValid(proof, expected)).toBe(true);

      rmSync(dependencyFile);
      expect(isFileSystemCacheProofValid(proof, expected)).toBe(false);

      mkdirSync(dependencyFile);
      expect(isFileSystemCacheProofValid(proof, expected)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("waits for the latest pending completion before returning affected modules", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-pending-"));
    const componentFile = path.join(root, "Component.tsx");
    const dependencyFile = path.join(root, "types.ts");
    const source = "export const Component = () => null;";
    writeFileSync(componentFile, source);
    writeFileSync(dependencyFile, "export interface Props { value: string }");
    const state: BackendProjectState = {
      configFiles: [],
      docgenFiles: [componentFile],
      generation: 1,
      trackedFiles: [componentFile, dependencyFile].sort(),
    };
    const completions: Array<
      (completion: {
        project?: BackendProjectState;
        revision: number;
        status: "ready" | "superseded";
        supersededBy?: number;
      }) => void
    > = [];
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        return {
          components: [],
          dependencies: [componentFile, dependencyFile].sort(),
          project: state,
          revision,
          status: "ok",
        };
      },
      async dispose() {},
      async initialize() {
        return state;
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update({ change }) {
        if (completions[0] && completions.length === 1) {
          completions[0]({
            revision: change.revision - 1,
            status: "superseded",
            supersededBy: change.revision,
          });
        }
        let resolveCompletion:
          | ((completion: {
              project?: BackendProjectState;
              revision: number;
              status: "ready" | "superseded";
              supersededBy?: number;
            }) => void)
          | undefined;
        const ready = new Promise<never>((resolve) => {
          resolveCompletion = resolve;
        });
        completions.push((completion) =>
          resolveCompletion?.(completion as never),
        );
        return { ready, revision: change.revision, status: "pending" };
      },
    };
    const plugin = createPlugin(
      {},
      {
        async create() {
          return backend;
        },
        describe() {
          return { cacheFingerprint: "pending/schema-1", id: "pending" };
        },
      },
    );
    const invalidateModule = vi.fn();
    const transformedModule = { id: componentFile, url: componentFile };
    const originalModule = { id: dependencyFile, url: dependencyFile };
    const server = {
      moduleGraph: {
        getModulesByFile: (fileName: string) =>
          fileName === componentFile ? new Set([transformedModule]) : undefined,
        invalidateModule,
      },
    };

    try {
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root });
      await plugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      // @ts-expect-error Focused harness supplies only the HMR fields used.
      const firstUpdate = plugin.handleHotUpdate?.call(
        { warn: vi.fn() },
        {
          file: dependencyFile,
          modules: [originalModule],
          read: () => "export interface Props { value: string }",
          server,
          timestamp: 1,
        },
      );
      await Promise.resolve();
      writeFileSync(dependencyFile, "export interface Props { value: number }");
      // @ts-expect-error Focused harness supplies only the HMR fields used.
      const secondUpdate = plugin.handleHotUpdate?.call(
        { warn: vi.fn() },
        {
          file: dependencyFile,
          modules: [originalModule],
          read: () => "export interface Props { value: number }",
          server,
          timestamp: 2,
        },
      );
      await Promise.resolve();
      expect(invalidateModule).not.toHaveBeenCalled();
      completions[1]?.({ project: state, revision: 2, status: "ready" });
      await expect(firstUpdate).resolves.toBeUndefined();
      await expect(secondUpdate).resolves.toEqual([
        originalModule,
        transformedModule,
      ]);
      expect(invalidateModule).not.toHaveBeenCalled();
    } finally {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call({} as never);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("updates one backend revision per Vite 6+ event without crossing environment graphs", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-hot-update-"));
    const componentFile = path.join(root, "Component.tsx");
    const dependencyFile = path.join(root, "types.ts");
    const source = "export const Component = () => null;";
    writeFileSync(componentFile, source);
    writeFileSync(dependencyFile, "export interface Props { value: string }");
    const state: BackendProjectState = {
      configFiles: [],
      docgenFiles: [componentFile],
      generation: 1,
      trackedFiles: [componentFile, dependencyFile].sort(),
    };
    const revisions: number[] = [];
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        return {
          components: [],
          dependencies: [componentFile, dependencyFile].sort(),
          project: state,
          revision,
          status: "ok",
        };
      },
      async dispose() {},
      async initialize() {
        return state;
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update({ change }) {
        revisions.push(change.revision);
        return { project: state, revision: change.revision, status: "ready" };
      },
    };
    const plugin = createPlugin(
      {},
      {
        async create() {
          return backend;
        },
        describe() {
          return { cacheFingerprint: "hot-update/schema-1", id: "hot-update" };
        },
      },
    );
    const clientModule = { id: `${componentFile}?client`, url: "/client" };
    const ssrModule = { id: `${componentFile}?ssr`, url: "/ssr" };
    const clientGraph = {
      getModulesByFile: (fileName: string) =>
        fileName === componentFile ? new Set([clientModule]) : undefined,
    };
    const ssrGraph = {
      getModulesByFile: (fileName: string) =>
        fileName === componentFile ? new Set([ssrModule]) : undefined,
    };

    try {
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root });
      await plugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      if (typeof plugin.hotUpdate !== "function") {
        throw new Error("Expected the Vite 6+ hotUpdate hook");
      }
      const event = {
        file: dependencyFile,
        modules: [],
        read: () => "export interface Props { value: number }",
        server: {},
        timestamp: 42,
        type: "update" as const,
      };
      const [clientResult, ssrResult] = await Promise.all([
        plugin.hotUpdate.call(
          { environment: { moduleGraph: clientGraph }, warn: vi.fn() } as never,
          event as never,
        ),
        plugin.hotUpdate.call(
          { environment: { moduleGraph: ssrGraph }, warn: vi.fn() } as never,
          event as never,
        ),
      ]);

      expect(revisions).toEqual([1]);
      expect(clientResult).toEqual([clientModule]);
      expect(ssrResult).toEqual([ssrModule]);
      expect(clientResult).not.toContain(ssrModule);
      expect(ssrResult).not.toContain(clientModule);
    } finally {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call({} as never);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("deduplicates more than 32 pending and settled Vite 6+ events by exact cross-environment identity", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-event-stress-"));
    const componentFile = path.join(root, "Component.tsx");
    const source = "export const Component = () => null;";
    const dependencyFiles = Array.from({ length: 40 }, (_, index) =>
      path.join(root, `types-${index}.ts`),
    );
    writeFileSync(componentFile, source);
    for (const dependencyFile of dependencyFiles) {
      writeFileSync(dependencyFile, "export type Value = string;");
    }
    const state: BackendProjectState = {
      configFiles: [],
      docgenFiles: [componentFile],
      generation: 1,
      trackedFiles: [componentFile, ...dependencyFiles].sort(),
    };
    const revisions: number[] = [];
    let delayUpdates = true;
    const updateResolvers: Array<
      (result: {
        project: BackendProjectState;
        revision: number;
        status: "ready";
      }) => void
    > = [];
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        return {
          components: [],
          dependencies: [componentFile, ...dependencyFiles].sort(),
          project: state,
          revision,
          status: "ok",
        };
      },
      async dispose() {},
      async initialize() {
        return state;
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update({ change }) {
        revisions.push(change.revision);
        if (delayUpdates) {
          return new Promise((resolve) => {
            updateResolvers.push(resolve);
          });
        }
        return {
          project: state,
          revision: change.revision,
          status: "ready",
        };
      },
    };
    const plugin = createPlugin(
      {},
      {
        async create() {
          return backend;
        },
        describe() {
          return { cacheFingerprint: "stress/schema-1", id: "stress" };
        },
      },
    );
    const clientModule = { id: `${componentFile}?client`, url: "/client" };
    const ssrModule = { id: `${componentFile}?ssr`, url: "/ssr" };
    const graphFor = (module: object) => ({
      getModulesByFile: (fileName: string) =>
        fileName === componentFile ? new Set([module]) : undefined,
    });

    try {
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root });
      await plugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      if (typeof plugin.hotUpdate !== "function") {
        throw new Error("Expected the Vite 6+ hotUpdate hook");
      }
      const events = dependencyFiles.map((file, index) => ({
        file,
        modules: [],
        read: () => `export type Value = ${index};`,
        server: {},
        timestamp: index + 1,
        type: "update" as const,
      }));
      const clientResultsPromise = Promise.all(
        events.map((event) =>
          plugin.hotUpdate?.call(
            {
              environment: { moduleGraph: graphFor(clientModule) },
              warn: vi.fn(),
            } as never,
            event as never,
          ),
        ),
      );
      while (updateResolvers.length < dependencyFiles.length) {
        await Promise.resolve();
      }
      expect(revisions).toEqual(dependencyFiles.map((_, index) => index + 1));
      delayUpdates = false;
      for (const [index, resolveUpdate] of updateResolvers.entries()) {
        resolveUpdate({
          project: state,
          revision: index + 1,
          status: "ready",
        });
      }
      const clientResults = await clientResultsPromise;
      expect(clientResults).toEqual(dependencyFiles.map(() => [clientModule]));
      const ssrResults = await Promise.all(
        events.map((event) =>
          plugin.hotUpdate?.call(
            {
              environment: { moduleGraph: graphFor(ssrModule) },
              warn: vi.fn(),
            } as never,
            event as never,
          ),
        ),
      );
      expect(ssrResults).toEqual(dependencyFiles.map(() => [ssrModule]));
      expect(revisions).toHaveLength(dependencyFiles.length);

      const collisionEvent = {
        ...events[0],
        read: () => "export type Value = 'same-timestamp-new-event';",
      };
      await expect(
        plugin.hotUpdate.call(
          {
            environment: { moduleGraph: graphFor(clientModule) },
            warn: vi.fn(),
          } as never,
          collisionEvent as never,
        ),
      ).resolves.toEqual([clientModule]);
      expect(revisions).toHaveLength(dependencyFiles.length + 1);

      for (const event of events) {
        await plugin.hotUpdate.call(
          {
            environment: { moduleGraph: graphFor(clientModule) },
            warn: vi.fn(),
          } as never,
          { ...event, read: undefined, type: "delete" } as never,
        );
      }
      const fallbackRevisionCount = revisions.length;
      await plugin.hotUpdate.call(
        {
          environment: { moduleGraph: graphFor(clientModule) },
          warn: vi.fn(),
        } as never,
        { ...events[0], read: undefined, type: "delete" } as never,
      );
      expect(revisions).toHaveLength(fallbackRevisionCount + 1);
    } finally {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call({} as never);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("drains an active Vite 6+ hot update before disposal and rejects later work", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-hot-close-"));
    const componentFile = path.join(root, "Component.tsx");
    const dependencyFile = path.join(root, "types.ts");
    const source = "export const Component = () => null;";
    writeFileSync(componentFile, source);
    writeFileSync(dependencyFile, "export type Value = string;");
    const state: BackendProjectState = {
      configFiles: [],
      docgenFiles: [componentFile],
      generation: 1,
      trackedFiles: [componentFile, dependencyFile].sort(),
    };
    const order: string[] = [];
    let resolveUpdate:
      | ((result: {
          project: BackendProjectState;
          revision: number;
          status: "ready";
        }) => void)
      | undefined;
    let markUpdateStarted = () => {};
    const updateStarted = new Promise<void>((resolve) => {
      markUpdateStarted = resolve;
    });
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        return {
          components: [],
          dependencies: [componentFile, dependencyFile],
          project: state,
          revision,
          status: "ok",
        };
      },
      async dispose() {
        order.push("dispose");
      },
      async initialize() {
        return state;
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update() {
        markUpdateStarted();
        return new Promise((resolve) => {
          resolveUpdate = resolve;
        });
      },
    };
    const plugin = createPlugin(
      {},
      {
        async create() {
          return backend;
        },
        describe() {
          return { cacheFingerprint: "close/schema-1", id: "close" };
        },
      },
    );
    const componentModule = { id: componentFile, url: componentFile };
    const graph = {
      getModulesByFile(fileName: string) {
        if (fileName !== componentFile) return undefined;
        order.push("module-return");
        return new Set([componentModule]);
      },
    };

    try {
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root });
      await plugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      if (
        typeof plugin.hotUpdate !== "function" ||
        typeof plugin.closeBundle !== "function"
      ) {
        throw new Error("Expected Vite lifecycle hooks");
      }
      const update = plugin.hotUpdate.call(
        { environment: { moduleGraph: graph }, warn: vi.fn() } as never,
        {
          file: dependencyFile,
          modules: [],
          read: () => "export type Value = number;",
          server: {},
          timestamp: 1,
          type: "update",
        } as never,
      );
      await updateStarted;
      const close = plugin.closeBundle.call({} as never);
      await Promise.resolve();
      expect(order).toEqual([]);
      resolveUpdate?.({ project: state, revision: 1, status: "ready" });
      await expect(update).resolves.toEqual([componentModule]);
      await close;
      expect(order).toEqual(["module-return", "dispose"]);
      await expect(
        plugin.hotUpdate.call(
          { environment: { moduleGraph: graph }, warn: vi.fn() } as never,
          {
            file: dependencyFile,
            modules: [],
            read: () => "export type Value = boolean;",
            server: {},
            timestamp: 2,
            type: "update",
          } as never,
        ),
      ).rejects.toThrow("shutting down");
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("does not broaden standalone component creation to existing transformed components", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-standalone-"));
    const componentFile = path.join(root, "Component.tsx");
    const standaloneFile = path.join(root, "Standalone.tsx");
    const source = "export const Component = () => null;";
    const standaloneSource = "export const Standalone = () => null;";
    writeFileSync(componentFile, source);
    writeFileSync(standaloneFile, standaloneSource);
    const initialState: BackendProjectState = {
      configFiles: [],
      docgenFiles: [componentFile],
      generation: 1,
      trackedFiles: [componentFile],
    };
    const refreshedState: BackendProjectState = {
      ...initialState,
      docgenFiles: [componentFile, standaloneFile].sort(),
      generation: 2,
      trackedFiles: [componentFile, standaloneFile].sort(),
    };
    const revisions: number[] = [];
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        return {
          components: [],
          dependencies: [componentFile],
          project: initialState,
          revision,
          status: "ok",
        };
      },
      async dispose() {},
      async initialize() {
        return initialState;
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update({ change }) {
        revisions.push(change.revision);
        return {
          project: refreshedState,
          revision: change.revision,
          status: "ready",
        };
      },
    };
    const plugin = createPlugin(
      {},
      {
        async create() {
          return backend;
        },
        describe() {
          return {
            cacheFingerprint: "standalone/schema-1",
            id: "standalone",
          };
        },
      },
    );
    const existingModule = { id: componentFile, url: componentFile };

    try {
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root });
      await plugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      if (typeof plugin.hotUpdate !== "function") {
        throw new Error("Expected the Vite 6+ hotUpdate hook");
      }
      await expect(
        plugin.hotUpdate.call(
          {
            environment: {
              moduleGraph: {
                getModulesByFile: (fileName: string) =>
                  fileName === componentFile
                    ? new Set([existingModule])
                    : undefined,
              },
            },
            warn: vi.fn(),
          } as never,
          {
            file: standaloneFile,
            modules: [],
            read: () => standaloneSource,
            server: {},
            timestamp: 1,
            type: "create",
          } as never,
        ),
      ).resolves.toBeUndefined();
      expect(revisions).toEqual([1]);
    } finally {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call({} as never);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

  it.each([
    {
      label: "path alias",
      source:
        'import type { Missing } from "@/missing"; export const Component = (_props: Missing) => null;',
    },
    {
      label: "JavaScript extension substituted by TypeScript",
      source:
        'import type { Missing } from "./missing.js"; export const Component = (_props: Missing) => null;',
    },
  ])("broadly recovers a configured non-docgen creation without an exact reverse edge: $label", async ({
    source,
  }) => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-broad-create-"));
    const componentFile = path.join(root, "Component.tsx");
    const dependencyFile = path.join(root, "missing.ts");
    writeFileSync(componentFile, source);
    writeFileSync(dependencyFile, "export interface Missing { value: true }");
    const initialState: BackendProjectState = {
      configFiles: [path.join(root, "tsconfig.json")],
      docgenFiles: [componentFile],
      generation: 1,
      trackedFiles: [componentFile],
    };
    const refreshedState: BackendProjectState = {
      ...initialState,
      generation: 2,
      trackedFiles: [componentFile, dependencyFile].sort(),
    };
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        return {
          components: [],
          dependencies: [componentFile],
          project: initialState,
          revision,
          status: "ok",
        };
      },
      async dispose() {},
      async initialize() {
        return initialState;
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update({ change }) {
        return {
          project: refreshedState,
          revision: change.revision,
          status: "ready",
        };
      },
    };
    const plugin = createPlugin(
      {},
      {
        async create() {
          return backend;
        },
        describe() {
          return {
            cacheFingerprint: "broad-create/schema-1",
            id: "broad-create",
          };
        },
      },
    );
    const componentModule = { id: componentFile, url: componentFile };

    try {
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root });
      await plugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      if (typeof plugin.hotUpdate !== "function") {
        throw new Error("Expected the Vite 6+ hotUpdate hook");
      }
      await expect(
        plugin.hotUpdate.call(
          {
            environment: {
              moduleGraph: {
                getModulesByFile: (fileName: string) =>
                  fileName === componentFile
                    ? new Set([componentModule])
                    : undefined,
              },
            },
            warn: vi.fn(),
          } as never,
          {
            file: dependencyFile,
            modules: [],
            read: () => readFileSync(dependencyFile, "utf-8"),
            server: {},
            timestamp: 1,
            type: "create",
          } as never,
        ),
      ).resolves.toEqual([componentModule]);
    } finally {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call({} as never);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("removes legacy add/unlink listeners and drains their tasks before concurrent teardown resolves", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-legacy-listener-"));
    const componentFile = path.join(root, "Component.tsx");
    const dependencyFile = path.join(root, "created.ts");
    const source = "export const Component = () => null;";
    writeFileSync(componentFile, source);
    writeFileSync(dependencyFile, "export interface Props { value: string }");
    const initialState: BackendProjectState = {
      configFiles: [path.join(root, "tsconfig.json")],
      docgenFiles: [componentFile],
      generation: 1,
      trackedFiles: [componentFile],
    };
    const refreshedState: BackendProjectState = {
      ...initialState,
      generation: 2,
      trackedFiles: [componentFile, dependencyFile].sort(),
    };
    let resolveUpdate:
      | ((result: {
          project: BackendProjectState;
          revision: number;
          status: "ready";
        }) => void)
      | undefined;
    let resolveUpdateStarted = () => {};
    const updateStarted = new Promise<void>((resolve) => {
      resolveUpdateStarted = resolve;
    });
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        return {
          components: [],
          dependencies: [componentFile],
          project: initialState,
          revision,
          status: "ok",
        };
      },
      dispose: vi.fn(),
      async initialize() {
        return initialState;
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update() {
        resolveUpdateStarted();
        return new Promise((resolveReady) => {
          resolveUpdate = (result) => resolveReady(result);
        });
      },
    };
    const plugin = createPlugin(
      {},
      {
        async create() {
          return backend;
        },
        describe() {
          return { cacheFingerprint: "legacy-listener/schema-1", id: "fake" };
        },
      },
    );
    const watcher = new EventEmitter();
    const reloadModule = vi.fn(async () => {});
    const send = vi.fn();
    const server = {
      config: { logger: { error: vi.fn(), warn: vi.fn() } },
      moduleGraph: {
        getModulesByFile: (fileName: string) =>
          fileName === componentFile
            ? new Set([{ id: componentFile, url: componentFile }])
            : undefined,
      },
      reloadModule,
      watcher,
      ws: { send },
    };
    const addBaseline = watcher.listenerCount("add");
    const unlinkBaseline = watcher.listenerCount("unlink");

    try {
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root });
      if (typeof plugin.configureServer !== "function") {
        throw new Error("Expected configureServer");
      }
      plugin.configureServer(server as never);
      expect(watcher.listenerCount("add")).toBe(addBaseline + 1);
      expect(watcher.listenerCount("unlink")).toBe(unlinkBaseline + 1);
      await plugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );

      watcher.emit("add", dependencyFile);
      await updateStarted;
      if (typeof plugin.closeBundle !== "function") {
        throw new Error("Expected closeBundle");
      }
      const firstClose = plugin.closeBundle.call({} as never);
      const secondClose = plugin.closeBundle.call({} as never);
      expect(watcher.listenerCount("add")).toBe(addBaseline);
      expect(watcher.listenerCount("unlink")).toBe(unlinkBaseline);
      resolveUpdate?.({
        project: refreshedState,
        revision: 1,
        status: "ready",
      });
      await Promise.all([firstClose, secondClose]);
      expect(reloadModule).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(backend.dispose).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("disposes a backend that finishes creation during teardown exactly once", async () => {
    const componentFile = path.resolve("src/LateComponent.tsx");
    let resolveCreation: ((backend: DocgenBackend) => void) | undefined;
    const creation = new Promise<DocgenBackend>((resolve) => {
      resolveCreation = resolve;
    });
    const dispose = vi.fn();
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        return {
          components: [],
          dependencies: [componentFile],
          project: projectState(1),
          revision,
          status: "ok",
        };
      },
      dispose,
      async initialize() {
        return projectState(1);
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update({ change }) {
        return {
          project: projectState(1),
          revision: change.revision,
          status: "ready",
        };
      },
    };
    const plugin = createPlugin(
      {},
      {
        create: () => creation,
        describe: () => ({ cacheFingerprint: "late/schema-1", id: "late" }),
      },
    );
    // @ts-expect-error Focused harness supplies only the resolved fields used.
    await plugin.configResolved?.({ command: "serve", root: process.cwd() });
    const transform = plugin.transform?.call(
      { warn: vi.fn() } as never,
      "export const LateComponent = () => null;",
      componentFile,
    );
    await Promise.resolve();
    const close =
      typeof plugin.closeBundle === "function"
        ? plugin.closeBundle.call({} as never)
        : undefined;
    resolveCreation?.(backend);
    await expect(transform).rejects.toThrow("disposed");
    await close;
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reanalyzes instead of delivering a result made stale by an update", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-stale-"));
    const componentFile = path.join(root, "Component.tsx");
    const dependencyFile = path.join(root, "types.ts");
    const source =
      "export const Stale = () => null; export const Fresh = () => null;";
    writeFileSync(componentFile, source);
    writeFileSync(dependencyFile, "export interface Props { value: string }");
    const state: BackendProjectState = {
      configFiles: [],
      docgenFiles: [componentFile],
      generation: 1,
      trackedFiles: [componentFile, dependencyFile].sort(),
    };
    let resolveFirstAnalysis:
      | ((result: Awaited<ReturnType<DocgenBackend["analyze"]>>) => void)
      | undefined;
    let analyzeCount = 0;
    const createAnalysis = (
      displayName: "Fresh" | "Stale",
      revision: number,
    ) => ({
      components: [
        {
          description: "",
          displayName,
          filePath: componentFile,
          methods: [],
          props: {},
          tags: {},
          targetExpression: displayName,
        },
      ],
      dependencies: [componentFile, dependencyFile].sort(),
      project: state,
      revision,
      status: "ok" as const,
    });
    const backend: DocgenBackend = {
      async analyze({ revision }) {
        analyzeCount += 1;
        if (analyzeCount === 1) {
          return new Promise((resolve) => {
            resolveFirstAnalysis = resolve;
          });
        }
        return createAnalysis("Fresh", revision);
      },
      async dispose() {},
      async initialize() {
        return state;
      },
      recordCacheHit() {},
      async reset({ revision }) {
        return { revision, status: "reset" };
      },
      async update({ change }) {
        return { project: state, revision: change.revision, status: "ready" };
      },
    };
    const plugin = createPlugin(
      {},
      {
        async create() {
          return backend;
        },
        describe() {
          return { cacheFingerprint: "stale/schema-1", id: "stale" };
        },
      },
    );
    try {
      // @ts-expect-error Focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root });
      const transform = plugin.transform?.call(
        { warn: vi.fn() } as never,
        source,
        componentFile,
      );
      while (!resolveFirstAnalysis) await Promise.resolve();
      // @ts-expect-error Focused harness supplies only the HMR fields used.
      await plugin.handleHotUpdate?.call(
        { warn: vi.fn() },
        {
          file: dependencyFile,
          server: {
            moduleGraph: {
              getModulesByFile: () => undefined,
              invalidateModule: vi.fn(),
            },
          },
        },
      );
      resolveFirstAnalysis(createAnalysis("Stale", 0));
      const result = await transform;
      expect(result).toEqual(
        expect.objectContaining({
          code: expect.stringContaining("Fresh.__docgenInfo"),
        }),
      );
      expect(result).not.toEqual(
        expect.objectContaining({
          code: expect.stringContaining("Stale.__docgenInfo"),
        }),
      );
      expect(analyzeCount).toBe(2);
    } finally {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call({} as never);
      }
      rmSync(root, { force: true, recursive: true });
    }
  });
});
