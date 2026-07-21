import {
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
import { createLegacyBackendFactory } from "../docgen/legacyBackend";
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
  writeFileSystemTransformCache,
} from "../utils/cache";
import { resolveFileSelection } from "../utils/fileSelection";
import type { Options } from "../utils/options";

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
    const source = "export const Component = () => null;";
    const cacheRoot = path.join(root, ".cache");
    writeFileSync(componentFile, source);
    writeFileSync(configFile, '{"member":true}');

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
      selectionFingerprint,
    });
    writeFileSystemTransformCache(
      path.join(cacheRoot, namespace),
      componentFile,
      source,
      { dependencies: [componentFile], proof, result: null },
    );

    let createCount = 0;
    const factory: DocgenBackendFactory = {
      async create() {
        createCount += 1;
        const state: BackendProjectState = {
          configFiles: [configFile],
          docgenFiles: [componentFile],
          generation: 1,
          trackedFiles: [componentFile],
        };
        return {
          async analyze({ revision }) {
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
        return descriptor;
      },
    };

    try {
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
      expect(createCount).toBe(0);

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
      expect(createCount).toBe(1);

      for (const plugin of [warmPlugin, stalePlugin]) {
        if (typeof plugin.closeBundle === "function") {
          await plugin.closeBundle.call({} as never);
        }
      }
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
