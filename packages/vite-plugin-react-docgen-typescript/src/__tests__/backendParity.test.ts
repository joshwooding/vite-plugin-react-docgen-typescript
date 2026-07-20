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
import createPlugin from "../index";
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
    await plugin.handleHotUpdate?.call(
      {},
      {
        file: path.join(fixture.root, "props.ts"),
        server: {
          moduleGraph: {
            getModulesByFile: (fileName: string) =>
              fileName === fixture.componentPath
                ? new Set([transformedModule])
                : undefined,
            invalidateModule,
          },
        },
      },
    );
    expect(invalidateModule).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(recoverableErrorFixture.files)
        .map((fileName) => `<fixture>/${fileName}`)
        .sort(),
    ).toEqual(recoverableErrorFixture.expectedDependencies);
  });
});
