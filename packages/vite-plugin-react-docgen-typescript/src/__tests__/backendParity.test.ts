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
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLegacyBackendFactory } from "../docgen/legacyBackend";
import createPlugin from "../index";
import { resolveFileSelection } from "../utils/fileSelection";
import type { Options } from "../utils/options";
import {
  backendParityCorpus,
  emptyExtractionFixture,
  recoverableErrorFixture,
} from "./support/backendParityCorpus";

const temporaryDirectories: string[] = [];
const plugins: ReturnType<typeof createPlugin>[] = [];

const createTemporaryDirectory = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "vite-rdt-parity-"));
  temporaryDirectories.push(directory);
  return directory;
};

const closePlugin = async (plugin: ReturnType<typeof createPlugin>) => {
  const closeBundle = plugin.closeBundle;
  if (!closeBundle) return;
  if (typeof closeBundle === "function") {
    await closeBundle.call({} as never);
  } else {
    await closeBundle.handler.call({} as never);
  }
};

afterEach(async () => {
  while (plugins.length > 0) {
    const plugin = plugins.pop();
    if (plugin) await closePlugin(plugin);
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { force: true, recursive: true });
  }
});

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

const extractGeneratedComponents = (code: string, root: string) => {
  const components: unknown[] = [];
  const pattern = /([$.A-Z_a-z][$.\w]*)\.__docgenInfo\s*=\s*(\{[^\n]*\});/g;

  for (const match of code.matchAll(pattern)) {
    if (!match[1] || !match[2]) continue;
    components.push({
      ...(JSON.parse(match[2]) as Record<string, unknown>),
      targetExpression: match[1],
    });
  }

  return normalizeFixtureValue(components, root);
};

const readOnlyCacheEntry = (cacheDirectory: string) => {
  const namespace = readdirSync(cacheDirectory, { withFileTypes: true }).find(
    (entry) => entry.isDirectory(),
  );
  if (!namespace) throw new Error("Missing cache namespace");
  const namespaceDirectory = path.join(cacheDirectory, namespace.name);
  const cacheFile = readdirSync(namespaceDirectory).find((fileName) =>
    fileName.endsWith(".json"),
  );
  if (!cacheFile) throw new Error("Missing persisted transform cache entry");
  return JSON.parse(
    readFileSync(path.join(namespaceDirectory, cacheFile), "utf-8"),
  ) as { dependencies?: string[]; kind: string };
};

const createFixture = (
  files: Readonly<Record<string, string>>,
  transformFile: string,
) => {
  const root = createTemporaryDirectory();
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
  return {
    cacheDirectory: path.join(root, ".cache"),
    componentPath: path.join(root, transformFile),
    root,
    tsconfigPath,
  };
};

const transformFixture = async (
  fixture: ReturnType<typeof createFixture>,
  options: Options,
) => {
  const plugin = createPlugin({
    ...options,
    fileSystemCache: {
      directory: fixture.cacheDirectory,
      enabled: true,
    },
    tsconfigPath: fixture.tsconfigPath,
  });
  plugins.push(plugin);
  // @ts-expect-error Vite supplies the complete resolved config in production.
  await plugin.configResolved?.({ root: fixture.root });
  const source = readFileSync(fixture.componentPath, "utf-8");
  // @ts-expect-error The focused parity harness needs only the warning API.
  const result = await plugin.transform?.call(
    { warn: vi.fn() },
    source,
    fixture.componentPath,
  );
  return { plugin, result, source };
};

const createDirectBackend = async (
  fixture: ReturnType<typeof createFixture>,
  options: Options,
) => {
  const resolvedOptions = { ...options, tsconfigPath: fixture.tsconfigPath };
  const factory = createLegacyBackendFactory(resolvedOptions);
  const backend = await factory.create({
    rootDir: fixture.root,
    selection: resolveFileSelection(fixture.root, resolvedOptions),
  });
  return backend;
};

describe("pre-extraction public-plugin parity corpus", () => {
  for (const corpus of backendParityCorpus) {
    it(corpus.name, async () => {
      const fixture = createFixture(corpus.files, corpus.transformFile);
      const { result } = await transformFixture(
        fixture,
        corpus.options as Options,
      );
      expect(result).toEqual(expect.objectContaining({ map: null }));
      if (!result || typeof result === "string") {
        throw new Error("Expected generated transform result");
      }
      expect(extractGeneratedComponents(result.code, fixture.root)).toEqual(
        corpus.expectedComponents,
      );
      const cacheEntry = readOnlyCacheEntry(fixture.cacheDirectory);
      expect(
        normalizeFixtureValue(cacheEntry.dependencies, fixture.root),
      ).toEqual(corpus.expectedDependencies);
      expect(
        Object.keys(corpus.files)
          .map((fileName) => `<fixture>/${fileName}`)
          .sort(),
      ).toEqual(corpus.expectedProjectFiles);
    });
  }

  it("preserves dependencies for empty extraction", async () => {
    const fixture = createFixture(
      { [emptyExtractionFixture.fileName]: emptyExtractionFixture.source },
      emptyExtractionFixture.fileName,
    );
    const { result } = await transformFixture(fixture, {});
    expect(result).toBeNull();
    expect(
      normalizeFixtureValue(
        readOnlyCacheEntry(fixture.cacheDirectory).dependencies,
        fixture.root,
      ),
    ).toEqual([`<fixture>/${emptyExtractionFixture.fileName}`]);
  });

  it("preserves dependencies for a recoverable parser error", async () => {
    const fixture = createFixture(
      recoverableErrorFixture.files,
      recoverableErrorFixture.transformFile,
    );
    const componentNameResolver = vi.fn(() => {
      throw new Error("controlled parser callback failure");
    });
    const { plugin, result, source } = await transformFixture(fixture, {
      componentNameResolver,
    });
    expect(result).toBe(source);
    expect(componentNameResolver).toHaveBeenCalled();
    const invalidateModule = vi.fn();
    const transformedModule = {
      id: fixture.componentPath,
      url: fixture.componentPath,
    };
    // The public plugin does not persist error results, so its reverse-index
    // response is the pre-extraction observation for the authored exact list.
    // @ts-expect-error The focused harness supplies only the used HMR fields.
    const hotModules = await plugin.handleHotUpdate?.call(
      {},
      {
        file: path.join(fixture.root, "props.ts"),
        modules: [],
        read: () => recoverableErrorFixture.files["props.ts"],
        server: {
          moduleGraph: {
            getModulesByFile: (fileName: string) =>
              fileName === fixture.componentPath
                ? new Set([transformedModule])
                : undefined,
            invalidateModule,
          },
        },
        timestamp: 1,
      },
    );
    expect(hotModules).toEqual([transformedModule]);
    expect(invalidateModule).not.toHaveBeenCalled();
    expect(
      Object.keys(recoverableErrorFixture.files)
        .map((fileName) => `<fixture>/${fileName}`)
        .sort(),
    ).toEqual(recoverableErrorFixture.expectedDependencies);
  });
});

describe.each([
  ["default", {}],
  ["watch", { EXPERIMENTAL_useWatchProgram: true }],
  ["project service", { EXPERIMENTAL_useProjectService: true }],
] as const)("direct legacy backend parity: %s", (_mode, runtimeOptions) => {
  for (const corpus of backendParityCorpus) {
    it(corpus.name, async () => {
      const fixture = createFixture(corpus.files, corpus.transformFile);
      const backend = await createDirectBackend(fixture, {
        ...corpus.options,
        ...runtimeOptions,
      } as Options);
      try {
        const initialized = await backend.initialize();
        expect(
          normalizeFixtureValue(initialized.docgenFiles, fixture.root),
        ).toEqual([`<fixture>/${corpus.transformFile}`]);
        expect(
          normalizeFixtureValue(initialized.trackedFiles, fixture.root),
        ).toEqual(corpus.expectedProjectFiles);
        expect(
          normalizeFixtureValue(initialized.configFiles, fixture.root),
        ).toEqual(["<fixture>/tsconfig.json"]);

        const result = await backend.analyze({
          fileName: fixture.componentPath,
          revision: 1,
          source: readFileSync(fixture.componentPath, "utf-8"),
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

  it("preserves dependencies for empty extraction", async () => {
    const fixture = createFixture(
      { [emptyExtractionFixture.fileName]: emptyExtractionFixture.source },
      emptyExtractionFixture.fileName,
    );
    const backend = await createDirectBackend(fixture, runtimeOptions);
    try {
      const result = await backend.analyze({
        fileName: fixture.componentPath,
        revision: 1,
        source: emptyExtractionFixture.source,
      });
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.components).toEqual([]);
      expect(normalizeFixtureValue(result.dependencies, fixture.root)).toEqual([
        `<fixture>/${emptyExtractionFixture.fileName}`,
      ]);
    } finally {
      await backend.dispose();
    }
  });

  it("sanitizes errors without losing dependencies", async () => {
    const fixture = createFixture(
      recoverableErrorFixture.files,
      recoverableErrorFixture.transformFile,
    );
    const backend = await createDirectBackend(fixture, {
      ...runtimeOptions,
      componentNameResolver: () => {
        throw new Error("controlled parser callback failure");
      },
    });
    try {
      const result = await backend.analyze({
        fileName: fixture.componentPath,
        revision: 1,
        source: readFileSync(fixture.componentPath, "utf-8"),
      });
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.error).toEqual(
          expect.objectContaining({
            message: "controlled parser callback failure",
            name: "Error",
          }),
        );
      }
      expect(normalizeFixtureValue(result.dependencies, fixture.root)).toEqual(
        recoverableErrorFixture.expectedDependencies,
      );
    } finally {
      await backend.dispose();
    }
  });

  it("reports complete referenced and extended config provenance", async () => {
    const root = createTemporaryDirectory();
    const referencedRoot = path.join(root, "packages", "referenced");
    mkdirSync(referencedRoot, { recursive: true });
    const componentPath = path.join(root, "Component.tsx");
    const referencedComponentPath = path.join(referencedRoot, "Referenced.tsx");
    const rootConfigPath = path.join(root, "tsconfig.json");
    const rootBasePath = path.join(root, "tsconfig.base.json");
    const referencedConfigPath = path.join(referencedRoot, "tsconfig.json");
    const referencedBasePath = path.join(referencedRoot, "tsconfig.base.json");
    writeFileSync(componentPath, "export const Component = () => null;\n");
    writeFileSync(
      referencedComponentPath,
      "export const Referenced = () => null;\n",
    );
    writeFileSync(
      rootBasePath,
      JSON.stringify({ compilerOptions: { jsx: "preserve" } }),
    );
    writeFileSync(
      referencedBasePath,
      JSON.stringify({ compilerOptions: { composite: true } }),
    );
    writeFileSync(
      referencedConfigPath,
      JSON.stringify({
        extends: "./tsconfig.base.json",
        files: ["Referenced.tsx"],
      }),
    );
    writeFileSync(
      rootConfigPath,
      JSON.stringify({
        extends: "./tsconfig.base.json",
        files: ["Component.tsx"],
        references: [{ path: "./packages/referenced" }],
      }),
    );
    const options: Options = {
      ...runtimeOptions,
      tsconfigPath: rootConfigPath,
    };
    const backend = await createLegacyBackendFactory(options).create({
      rootDir: root,
      selection: resolveFileSelection(root, options),
    });
    try {
      const state = await backend.initialize();
      expect(state.configFiles).toEqual(
        [
          referencedBasePath,
          referencedConfigPath,
          rootBasePath,
          rootConfigPath,
        ].sort(),
      );
      expect(state.docgenFiles).toEqual(
        [componentPath, referencedComponentPath].sort(),
      );
      expect(state.trackedFiles).toEqual(
        [componentPath, referencedComponentPath].sort(),
      );
    } finally {
      await backend.dispose();
    }
  });
});
