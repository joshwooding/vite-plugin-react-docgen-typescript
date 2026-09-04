import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLegacyBackendFactory } from "../docgen/legacyBackend";
import {
  createNativeBackendFactory,
  type NativeBackendLoaders,
} from "../docgen/nativeBackend";
import { createPlugin } from "../plugin";
import { resolveFileSelection } from "../utils/fileSelection";
import type {
  InternalBenchmarkAnalysisEvent,
  InternalBenchmarkControls,
  InternalBenchmarkPhaseEvent,
  Options,
} from "../utils/options";
import { backendParityCorpus } from "./support/backendParityCorpus";
import { runTransformHook } from "./support/pluginHooks";

const nativeLoaders: NativeBackendLoaders = {
  loadAst: () => import("typescript7next/unstable/ast"),
  loadSync: () => import("typescript7next/unstable/sync"),
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

const createFixture = (files: Readonly<Record<string, string>>) => {
  const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-native-"));
  temporaryDirectories.push(root);
  for (const [relativePath, source] of Object.entries(files)) {
    const fileName = path.join(root, relativePath);
    mkdirSync(path.dirname(fileName), { recursive: true });
    writeFileSync(fileName, source);
  }
  const tsconfigPath = path.join(root, "tsconfig.json");
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions: {
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        skipLibCheck: true,
        target: "ES2020",
      },
      files: Object.keys(files),
    }),
  );
  return { root, tsconfigPath };
};

const createBackend = async (
  fixture: ReturnType<typeof createFixture>,
  options: Options = {},
  loaders: NativeBackendLoaders = nativeLoaders,
) => {
  const config: Options = {
    ...options,
    docgenMode: "native",
    tsconfigPath: fixture.tsconfigPath,
  };
  return createNativeBackendFactory(config, loaders).create({
    rootDir: fixture.root,
    selection: resolveFileSelection(fixture.root, config),
  });
};

const normalizeFixtureValue = (value: unknown, root: string): unknown => {
  if (typeof value === "string") {
    return value
      .replaceAll("\\", "/")
      .replaceAll(root.replaceAll("\\", "/"), "<fixture>");
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeFixtureValue(item, root));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeFixtureValue(item, root),
      ]),
    );
  }
  return value;
};

describe("TypeScript 7 native backend", () => {
  for (const corpus of backendParityCorpus) {
    it(`matches legacy output for ${corpus.name}`, async () => {
      const fixture = createFixture(corpus.files);
      const backend = await createBackend(fixture, corpus.options as Options);
      const componentPath = path.join(fixture.root, corpus.transformFile);
      try {
        const project = await backend.initialize();
        expect(
          normalizeFixtureValue(project.docgenFiles, fixture.root),
        ).toEqual(
          corpus.expectedProjectFiles.filter((fileName) =>
            fileName.endsWith(".tsx"),
          ),
        );
        expect(
          normalizeFixtureValue(project.trackedFiles, fixture.root),
        ).toEqual(corpus.expectedProjectFiles);

        const result = await backend.analyze({
          fileName: componentPath,
          revision: 1,
          source: readFileSync(componentPath, "utf-8"),
        });
        expect(result.status).toBe("ok");
        if (result.status !== "ok") return;
        expect(normalizeFixtureValue(result.components, fixture.root)).toEqual(
          corpus.expectedComponents,
        );
        expect(
          normalizeFixtureValue(result.dependencies, fixture.root),
        ).toEqual(corpus.expectedDependencies);
      } finally {
        await backend.dispose();
      }
    });
  }

  it("matches the legacy backend across the component fixture suite", async () => {
    const fixtureRoot = path.join(import.meta.dirname, "__fixtures__");
    const config: Options = {
      compilerOptions: {
        esModuleInterop: true,
        jsx: 2,
        module: 99,
        moduleResolution: 100,
        skipLibCheck: true,
        strict: true,
        target: 9,
      },
      exclude: [],
      include: ["**/*.tsx"],
      shouldExtractValuesFromUnion: true,
    };
    const selection = resolveFileSelection(fixtureRoot, config);
    const legacy = await createLegacyBackendFactory(config).create({
      rootDir: fixtureRoot,
      selection,
    });
    const native = await createNativeBackendFactory(
      { ...config, docgenMode: "native" },
      nativeLoaders,
    ).create({ rootDir: fixtureRoot, selection });
    try {
      for (const fileName of readdirSync(fixtureRoot).filter((candidate) =>
        candidate.endsWith(".tsx"),
      )) {
        const absolutePath = path.join(fixtureRoot, fileName);
        const source = readFileSync(absolutePath, "utf-8");
        const [legacyResult, nativeResult] = await Promise.all([
          legacy.analyze({ fileName: absolutePath, revision: 1, source }),
          native.analyze({ fileName: absolutePath, revision: 1, source }),
        ]);
        expect(legacyResult.status, `${fileName} legacy status`).toBe("ok");
        expect(nativeResult.status, `${fileName} native status`).toBe("ok");
        if (legacyResult.status !== "ok" || nativeResult.status !== "ok") {
          continue;
        }
        expect(nativeResult.components, fileName).toEqual(
          legacyResult.components,
        );
      }
    } finally {
      await Promise.all([legacy.dispose(), native.dispose()]);
    }
  }, 30_000);

  it("refreshes imported prop metadata through a native snapshot update", async () => {
    const fixture = createFixture({
      "Component.tsx": `import type { Props } from "./props";
export const Component = (_props: Props) => null;
`,
      "props.ts": `export interface Props {
  /** Original value. */
  value: string;
}
`,
    });
    const backend = await createBackend(fixture);
    const componentPath = path.join(fixture.root, "Component.tsx");
    const propsPath = path.join(fixture.root, "props.ts");
    const componentSource = readFileSync(componentPath, "utf-8");
    try {
      const first = await backend.analyze({
        fileName: componentPath,
        revision: 1,
        source: componentSource,
      });
      expect(first.status).toBe("ok");
      if (first.status !== "ok") return;
      expect(first.components[0]?.props.value).toMatchObject({
        description: "Original value.",
        type: { name: "string" },
      });

      const updatedProps = `export interface Props {
  /** Updated value. */
  value: number;
}
`;
      writeFileSync(propsPath, updatedProps);
      const update = await backend.update({
        affectedComponentFiles: [componentPath],
        change: {
          fileName: propsPath,
          kind: "change",
          revision: 2,
          source: updatedProps,
        },
      });
      expect(update.status).toBe("ready");

      const second = await backend.analyze({
        fileName: componentPath,
        revision: 2,
        source: componentSource,
      });
      expect(second.status).toBe("ok");
      if (second.status !== "ok") return;
      expect(second.components[0]?.props.value).toMatchObject({
        description: "Updated value.",
        type: { name: "number" },
      });
    } finally {
      await backend.dispose();
    }
  });

  it("analyzes an in-memory source override through a temporary snapshot", async () => {
    const diskSource = `interface Props { value: string }
export const Component = (_props: Props) => null;
`;
    const memorySource = diskSource.replace("value: string", "value: number");
    const fixture = createFixture({ "Component.tsx": diskSource });
    const backend = await createBackend(fixture);
    const componentPath = path.join(fixture.root, "Component.tsx");
    try {
      const result = await backend.analyze({
        fileName: componentPath,
        revision: 1,
        source: memorySource,
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.components[0]?.props.value.type.name).toBe("number");
      expect(readFileSync(componentPath, "utf-8")).toBe(diskSource);
    } finally {
      await backend.dispose();
    }
  });

  it("supports componentNameResolver through the native symbol facade", async () => {
    const fixture = createFixture({
      "Component.tsx": `export interface Props {
  value: string;
}

export const Component = (_props: Props) => null;
`,
    });
    const backend = await createBackend(fixture, {
      componentNameResolver(symbol, source) {
        return `${path.basename(source.fileName)}:${symbol.getName()}`;
      },
    });
    const componentPath = path.join(fixture.root, "Component.tsx");
    try {
      const result = await backend.analyze({
        fileName: componentPath,
        revision: 1,
        source: readFileSync(componentPath, "utf-8"),
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.components[0]?.displayName).toBe("Component.tsx:Component");
    } finally {
      await backend.dispose();
    }
  });

  it("targets the local runtime binding for an aliased named export", async () => {
    const fixture = createFixture({
      "Component.tsx": `const Local = (_props: { value: string }) => null;
export { Local as Public };
`,
    });
    const backend = await createBackend(fixture);
    const componentPath = path.join(fixture.root, "Component.tsx");
    try {
      const result = await backend.analyze({
        fileName: componentPath,
        revision: 1,
        source: readFileSync(componentPath, "utf-8"),
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.components).toHaveLength(1);
      expect(result.components[0]?.targetExpression).toBe("Local");
    } finally {
      await backend.dispose();
    }
  });

  it("skips direct cross-module re-exports without a local binding", async () => {
    const fixture = createFixture({
      "Component.tsx": `export default function Component(
  _props: { value: string },
) {
  return null;
}
`,
      "Reexport.tsx": 'export { default as Public } from "./Component";\n',
    });
    const backend = await createBackend(fixture);
    const reexportPath = path.join(fixture.root, "Reexport.tsx");
    try {
      const result = await backend.analyze({
        fileName: reexportPath,
        revision: 1,
        source: readFileSync(reexportPath, "utf-8"),
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.components).toEqual([]);
    } finally {
      await backend.dispose();
    }
  });

  it("tracks imported generic type arguments as HMR dependencies", async () => {
    const fixture = createFixture({
      "Component.tsx": `import type { Item } from "./item";

interface Props {
  items: Item[];
}

export const Component = (_props: Props) => null;
`,
      "item.ts": `export interface Item {
  label: string;
}
`,
    });
    const backend = await createBackend(fixture);
    const componentPath = path.join(fixture.root, "Component.tsx");
    const itemPath = path.join(fixture.root, "item.ts");
    try {
      const result = await backend.analyze({
        fileName: componentPath,
        revision: 1,
        source: readFileSync(componentPath, "utf-8"),
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.dependencies).toContain(itemPath);
    } finally {
      await backend.dispose();
    }
  });

  it("expands an imported optional literal-union alias", async () => {
    const fixture = createFixture({
      "Component.tsx": `import type { Tone } from "./tone";

interface Props {
  tone?: Tone;
}

export const Component = (_props: Props) => null;
`,
      "tone.ts": `export type Tone = "base" | "contrast";
`,
    });
    const backend = await createBackend(fixture, {
      shouldExtractValuesFromUnion: true,
      shouldRemoveUndefinedFromOptional: true,
    });
    const componentPath = path.join(fixture.root, "Component.tsx");
    try {
      const result = await backend.analyze({
        fileName: componentPath,
        revision: 1,
        source: readFileSync(componentPath, "utf8"),
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;
      expect(result.components[0]?.props.tone.type).toMatchObject({
        name: "enum",
        value: [{ value: '"base"' }, { value: '"contrast"' }],
      });
    } finally {
      await backend.dispose();
    }
  });

  it("interleaves bulk component analysis through batched transport", async () => {
    const fixture = createFixture({
      "First.tsx": `interface Props { label: string }
export const First = (_props: Props) => null;
`,
      "Second.tsx": `interface Props { count: number }
export const Second = (_props: Props) => null;
`,
    });
    const controls: InternalBenchmarkControls = {
      collectNativeRequestProfile: true,
    };
    const backend = await createBackend(fixture, { __benchmark: controls });
    const files = ["First.tsx", "Second.tsx"].map((fileName) =>
      path.join(fixture.root, fileName),
    );
    try {
      await backend.initialize();
      expect(backend.analyzeMany).toBeTypeOf("function");
      controls.resetNativeRequestProfile?.();
      const results = await backend.analyzeMany?.(
        files.map((fileName) => ({
          fileName,
          revision: 1,
          source: readFileSync(fileName, "utf-8"),
        })),
      );
      expect(results?.map(({ status }) => status)).toEqual(["ok", "ok"]);
      const profile = controls.getNativeRequestProfile?.() as
        | {
            logicalMethods: Record<string, number>;
            logicalRequestCount: number;
            physicalMethods: Record<string, number>;
            physicalRequestCount: number;
          }
        | undefined;
      expect(profile?.logicalMethods.getSymbolOfSourceFile).toBe(2);
      expect(profile?.physicalMethods.getSymbolOfSourceFile).toBeUndefined();
      expect(profile?.physicalMethods.batchRequests).toBeGreaterThan(0);
      expect(profile?.physicalRequestCount).toBeLessThan(
        profile?.logicalRequestCount ?? 0,
      );
    } finally {
      await backend.dispose();
    }
  });

  it("chunks native bulk analysis at 256 files", async () => {
    const files = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `Component${index}.tsx`,
        `interface Props${index} { value: string }
export const Component${index} = (_props: Props${index}) => null;
`,
      ]),
    );
    const fixture = createFixture(files);
    const batchSizes: number[] = [];
    const instrumentedLoaders: NativeBackendLoaders = {
      loadAst: nativeLoaders.loadAst,
      async loadSync() {
        const sync = await nativeLoaders.loadSync();
        const API = new Proxy(sync.API, {
          construct(target, argumentsList) {
            const api = Reflect.construct(target, argumentsList) as object;
            const instrumentedApi = api as {
              batch(...requestGenerators: unknown[]): unknown;
            };
            const originalBatch = instrumentedApi.batch.bind(instrumentedApi);
            instrumentedApi.batch = (...requestGenerators) => {
              batchSizes.push(requestGenerators.length);
              return originalBatch(...requestGenerators);
            };
            return api;
          },
        });
        return { ...sync, API };
      },
    };
    const backend = await createBackend(fixture, {}, instrumentedLoaders);
    try {
      await backend.initialize();
      batchSizes.length = 0;
      const results = await backend.analyzeMany?.(
        Object.keys(files).map((relativePath) => {
          const fileName = path.join(fixture.root, relativePath);
          return {
            fileName,
            revision: 1,
            source: readFileSync(fileName, "utf-8"),
          };
        }),
      );
      expect(results).toHaveLength(257);
      expect(results?.every(({ status }) => status === "ok")).toBe(true);
      expect(batchSizes).toEqual([256, 1]);
    } finally {
      await backend.dispose();
    }
  }, 30_000);

  it("reports native timing and request profiles to the benchmark harness", async () => {
    const fixture = createFixture({
      "Component.tsx": `interface Props { label: string }
export const Component = (_props: Props) => null;
`,
    });
    const controls: InternalBenchmarkControls = {
      collectNativeRequestProfile: true,
      collectNativeTiming: true,
    };
    const backend = await createBackend(fixture, { __benchmark: controls });
    const componentPath = path.join(fixture.root, "Component.tsx");
    try {
      await backend.initialize();
      expect(controls.getNativeTimingInfo).toBeTypeOf("function");
      expect(controls.getNativeRequestProfile).toBeTypeOf("function");
      expect(controls.resetNativeTimingInfo).toBeTypeOf("function");
      expect(controls.resetNativeRequestProfile).toBeTypeOf("function");
      controls.resetNativeRequestProfile?.();
      controls.resetNativeTimingInfo?.();

      await backend.analyze({
        fileName: componentPath,
        revision: 1,
        source: readFileSync(componentPath, "utf-8"),
      });
      const timing = controls.getNativeTimingInfo?.() as
        | {
            enabled: boolean;
            totals: {
              requestCount: number;
              serverTimeMs: number;
              transportOverheadMs: number;
            };
          }
        | undefined;
      const requestProfile = controls.getNativeRequestProfile?.() as
        | {
            logicalMethods: Record<string, number>;
            logicalRequestCount: number;
            physicalMethods: Record<string, number>;
            physicalRequestCount: number;
          }
        | undefined;
      expect(timing?.enabled).toBe(true);
      expect(timing?.totals.requestCount).toBeGreaterThan(0);
      expect(timing?.totals.serverTimeMs).toBeGreaterThanOrEqual(0);
      expect(timing?.totals.transportOverheadMs).toBeGreaterThanOrEqual(0);
      expect(requestProfile?.physicalRequestCount).toBe(
        timing?.totals.requestCount,
      );
      expect(requestProfile?.logicalRequestCount).toBeGreaterThanOrEqual(
        requestProfile?.physicalRequestCount ?? 0,
      );
      expect(
        Object.values(requestProfile?.logicalMethods ?? {}).reduce(
          (total, count) => total + count,
          0,
        ),
      ).toBe(requestProfile?.logicalRequestCount);
      expect(
        Object.values(requestProfile?.physicalMethods ?? {}).reduce(
          (total, count) => total + count,
          0,
        ),
      ).toBe(requestProfile?.physicalRequestCount);
    } finally {
      await backend.dispose();
    }
    expect(controls.getNativeTimingInfo).toBeUndefined();
    expect(controls.getNativeRequestProfile).toBeUndefined();
    expect(controls.resetNativeTimingInfo).toBeUndefined();
    expect(controls.resetNativeRequestProfile).toBeUndefined();
  });

  it("reports serializable plugin phases and structured analysis", async () => {
    const fixture = createFixture({
      "Component.tsx":
        "interface Props { label: string }\nexport const Component = (_props: Props) => null;\n",
    });
    const analysisEvents: InternalBenchmarkAnalysisEvent[] = [];
    const phaseEvents: InternalBenchmarkPhaseEvent[] = [];
    const controls: InternalBenchmarkControls = {
      collectNativeTiming: true,
      onAnalysis: (event) => analysisEvents.push(event),
      onPhase: (event) => phaseEvents.push(event),
    };
    const config: Options = {
      __benchmark: controls,
      docgenMode: "native",
      fileSystemCache: false,
      tsconfigPath: fixture.tsconfigPath,
    };
    const plugin = createPlugin(
      config,
      createNativeBackendFactory(config, nativeLoaders),
    );
    const componentPath = path.join(fixture.root, "Component.tsx");
    const source = readFileSync(componentPath, "utf-8");
    const context = { warn() {} } as never;
    try {
      if (typeof plugin.configResolved === "function") {
        await plugin.configResolved.call(context, {
          command: "serve",
          root: fixture.root,
        } as never);
      }
      await expect(
        runTransformHook(plugin, context, source, componentPath),
      ).resolves.not.toBe(source);
    } finally {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call(context);
      }
    }

    expect(phaseEvents.map(({ phase }) => phase)).toEqual(
      expect.arrayContaining([
        "native-project-sync",
        "backend-initialize",
        "backend-analyze",
        "code-generation",
      ]),
    );
    expect(
      phaseEvents.every(
        ({ durationMs }) => Number.isFinite(durationMs) && durationMs >= 0,
      ),
    ).toBe(true);
    expect(analysisEvents).toHaveLength(1);
    expect(analysisEvents[0]?.result.status).toBe("ok");
    expect(() => JSON.stringify(analysisEvents[0]?.result)).not.toThrow();
  });

  it("keeps benchmark callbacks observational for success and error results", async () => {
    const fixture = createFixture({
      "Component.tsx":
        "interface Props { label: string }\nexport const Component = (_props: Props) => null;\n",
    });
    const errorAnalysisEvents: InternalBenchmarkAnalysisEvent[] = [];
    const config: Options = {
      __benchmark: {
        onAnalysis(event) {
          errorAnalysisEvents.push(event);
        },
        onPhase() {
          throw new Error("phase observer failure");
        },
      },
      componentNameResolver() {
        throw new Error("resolver failure");
      },
      docgenMode: "native",
      fileSystemCache: false,
      tsconfigPath: fixture.tsconfigPath,
    };
    const plugin = createPlugin(
      config,
      createNativeBackendFactory(config, nativeLoaders),
    );
    const componentPath = path.join(fixture.root, "Component.tsx");
    const source = readFileSync(componentPath, "utf-8");
    const warnings: string[] = [];
    const context = {
      warn(message: string) {
        warnings.push(message);
      },
    } as never;
    try {
      if (typeof plugin.configResolved === "function") {
        await plugin.configResolved.call(context, {
          command: "serve",
          root: fixture.root,
        } as never);
      }
      await expect(
        runTransformHook(plugin, context, source, componentPath),
      ).resolves.toBe(source);
    } finally {
      if (typeof plugin.closeBundle === "function") {
        await plugin.closeBundle.call(context);
      }
    }

    expect(errorAnalysisEvents).toHaveLength(1);
    expect(errorAnalysisEvents[0]?.result.status).toBe("error");
    expect(warnings).toEqual([
      expect.stringContaining("Failed to generate docgen"),
    ]);
  });

  it("reports an actionable error when the 7.1 API is unavailable", async () => {
    const fixture = createFixture({
      "Component.tsx": "export const Component = () => null;\n",
    });
    const config: Options = {
      docgenMode: "native",
      tsconfigPath: fixture.tsconfigPath,
    };
    const factory = createNativeBackendFactory(config, {
      loadAst: nativeLoaders.loadAst,
      loadSync: () => Promise.reject(new Error("missing export")),
    });

    await expect(
      factory.create({
        rootDir: fixture.root,
        selection: resolveFileSelection(fixture.root, config),
      }),
    ).rejects.toThrowError(/typescript\/unstable\/sync.*typescript@next/i);
  });
});
