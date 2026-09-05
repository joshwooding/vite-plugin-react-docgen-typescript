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
import type { DocgenBackend } from "../docgen/backend";
import { createLegacyBackendFactory } from "../docgen/legacyBackend";
import createPlugin from "../index";
import { createPlugin as createPluginWithBackend } from "../plugin";
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
] as const)("existing ambient input freshness: %s", (_mode, modeOptions) => {
  it.each([
    "global script",
    "declare global",
    "root augmentation",
  ] as const)("tracks %s inputs through live edits and restarted persistent caches", async (shape) => {
    const changedFile = shape === "declare global" ? "shared.ts" : "ambient.ts";
    const changedSource = (phase: string) => {
      const props = `\n  /** ${phase} ambient tone. */\n  tone: "base" | "${phase}";\n`;
      if (shape === "global script") return `interface AmbientProps {${props}}`;
      if (shape === "declare global")
        return `export interface SharedProps {${props}}`;
      return `export {}; declare module "./props" { interface Props {${props}} }`;
    };
    const componentSource = `declare namespace JSX { interface Element {} }
${shape === "root augmentation" ? 'import type { Props } from "./props";' : ""}
export const Component = (_props: ${shape === "root augmentation" ? "Props" : "AmbientProps"}): JSX.Element =>
  null as unknown as JSX.Element;
`;
    const otherSource = `declare namespace JSX { interface Element {} }
import type { OrdinaryProps } from "./ordinary";
import "./commonjs.js";
export const Other = (_props: OrdinaryProps): JSX.Element =>
  null as unknown as JSX.Element;
`;
    const ordinarySource = (phase: string) => `export interface OrdinaryProps {
  /** ${phase} ordinary value. */
  value: string;
}`;
    const sharedFiles = ["ambient.ts"];
    const ambientFiles: Record<string, string> = {
      [changedFile]: changedSource("initial"),
    };
    if (shape === "declare global") {
      ambientFiles["ambient.ts"] = `import type { SharedProps } from "./shared";
declare global { interface AmbientProps extends SharedProps {} }`;
      sharedFiles.push("shared.ts");
    } else if (shape === "root augmentation") {
      ambientFiles["props.ts"] = "export interface Props {}";
      sharedFiles.push("props.ts");
    }
    const fixture = createFixture(
      {
        ...ambientFiles,
        "Component.tsx": componentSource,
        "Other.tsx": otherSource,
        "ordinary.ts": ordinarySource("initial"),
        "ordinary.d.ts": "export interface UnusedProps { value: boolean; }",
        "local-namespace.ts":
          "export {}; declare namespace JSX { interface LocalElement {} }",
        "commonjs.js": "var out = exports; out.value = 1;",
        "commonjs-require.js": 'const local = require("./commonjs");',
        "commonjs-define.js":
          'Object.defineProperty(module.exports, "value", { value: 1 });',
      },
      "Component.tsx",
    );
    const fixtureConfig = JSON.parse(
      readFileSync(fixture.tsconfigPath, "utf-8"),
    );
    fixtureConfig.compilerOptions.allowJs = true;
    writeFileSync(fixture.tsconfigPath, JSON.stringify(fixtureConfig));
    const otherFile = path.join(fixture.root, "Other.tsx");
    const changedPath = path.join(fixture.root, changedFile);
    const options: Options = {
      ...modeOptions,
      fileSystemCache: { directory: fixture.cacheDirectory, enabled: true },
      shouldExtractValuesFromUnion: true,
      tsconfigPath: fixture.tsconfigPath,
    };
    const expectedDependencies = (file: string) =>
      [
        file,
        ...sharedFiles.map((shared) => path.join(fixture.root, shared)),
        ...(file === otherFile
          ? [
              path.join(fixture.root, "ordinary.ts"),
              path.join(fixture.root, "commonjs.js"),
            ]
          : []),
      ].sort();
    const dependencies = new Map<string, readonly string[]>();
    const analyses = new Map<string, number>();
    let backend: DocgenBackend | undefined;
    let createCount = 0;
    const factory = createLegacyBackendFactory(options);
    const startPlugin = async () => {
      const plugin = createPluginWithBackend(options, {
        ...factory,
        async create(context) {
          createCount += 1;
          const activeBackend = await factory.create(context);
          backend = activeBackend;
          return {
            ...activeBackend,
            async analyze(request) {
              const result = await activeBackend.analyze(request);
              dependencies.set(request.fileName, result.dependencies);
              analyses.set(
                request.fileName,
                (analyses.get(request.fileName) ?? 0) + 1,
              );
              return result;
            },
          };
        },
      });
      plugins.push(plugin);
      // @ts-expect-error The focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root: fixture.root });
      return plugin;
    };
    const transform = async (
      plugin: ReturnType<typeof createPlugin>,
      fileName: string,
    ) => {
      const result = await plugin.transform?.call(
        { addWatchFile: vi.fn(), warn: vi.fn() } as never,
        readFileSync(fileName, "utf-8"),
        fileName,
      );
      if (!result || typeof result === "string")
        throw new Error("Expected generated metadata");
      return result.code;
    };
    const expectedTone = (phase: string) => ({
      description: `${phase} ambient tone.`,
      type: { value: [{ value: '"base"' }, { value: `"${phase}"` }] },
    });
    const expectTone = (code: string, phase: string) => {
      expect
        .soft(extractGeneratedComponents(code, fixture.root))
        .toMatchObject([{ props: { tone: expectedTone(phase) } }]);
    };
    const componentModule = {
      id: fixture.componentPath,
      url: fixture.componentPath,
    };
    const otherModule = { id: otherFile, url: otherFile };
    const hotUpdate = async (
      plugin: ReturnType<typeof createPlugin>,
      file: string,
      source: string,
      timestamp: number,
    ) => {
      // @ts-expect-error The focused harness supplies only the used HMR fields.
      const modules = await plugin.handleHotUpdate?.call(
        { warn: vi.fn() },
        {
          file,
          modules: [],
          read: () => source,
          server: {
            moduleGraph: {
              getModulesByFile: (fileName: string) =>
                fileName === fixture.componentPath
                  ? new Set([componentModule])
                  : fileName === otherFile
                    ? new Set([otherModule])
                    : undefined,
              invalidateModule: vi.fn(),
            },
          },
          timestamp,
        },
      );
      return modules?.map((module) => module.id).sort();
    };

    const plugin = await startPlugin();
    expectTone(await transform(plugin, fixture.componentPath), "initial");
    expect
      .soft(readOnlyCacheEntry(fixture.cacheDirectory).dependencies)
      .toEqual(expectedDependencies(fixture.componentPath));
    await transform(plugin, otherFile);
    expect
      .soft(dependencies.get(otherFile))
      .toEqual(expectedDependencies(otherFile));

    const liveSource = changedSource("live");
    writeFileSync(changedPath, liveSource);
    expect
      .soft(await hotUpdate(plugin, changedPath, liveSource, 1))
      .toEqual([fixture.componentPath, otherFile].sort());
    if (!backend) throw new Error("Expected an initialized backend");
    const fresh = await backend.analyze({
      fileName: fixture.componentPath,
      revision: 1,
      source: componentSource,
    });
    expect(fresh.status).toBe("ok");
    if (fresh.status !== "ok") throw new Error(fresh.error.message);
    expect(fresh.components[0]?.props.tone).toMatchObject(expectedTone("live"));
    const liveCode = await transform(plugin, fixture.componentPath);
    expectTone(liveCode, "live");
    expect
      .soft(dependencies.get(fixture.componentPath))
      .toEqual(expectedDependencies(fixture.componentPath));
    await transform(plugin, otherFile);

    const ordinaryPath = path.join(fixture.root, "ordinary.ts");
    const updatedOrdinary = ordinarySource("updated");
    writeFileSync(ordinaryPath, updatedOrdinary);
    expect(await hotUpdate(plugin, ordinaryPath, updatedOrdinary, 2)).toEqual([
      otherFile,
    ]);
    const componentAnalyses = analyses.get(fixture.componentPath);
    expect(await transform(plugin, fixture.componentPath)).toBe(liveCode);
    expect(analyses.get(fixture.componentPath)).toBe(componentAnalyses);
    expect(await transform(plugin, otherFile)).toContain(
      "updated ordinary value.",
    );
    const commonJsPath = path.join(fixture.root, "commonjs.js");
    const commonJsSource = "var out = exports; out.value = 2;";
    writeFileSync(commonJsPath, commonJsSource);
    expect(await hotUpdate(plugin, commonJsPath, commonJsSource, 3)).toEqual([
      otherFile,
    ]);
    expect(await transform(plugin, fixture.componentPath)).toBe(liveCode);
    expect(analyses.get(fixture.componentPath)).toBe(componentAnalyses);
    await transform(plugin, otherFile);
    await closePlugin(plugin);

    const warmPlugin = await startPlugin();
    expectTone(await transform(warmPlugin, fixture.componentPath), "live");
    expect(createCount).toBe(1);
    await closePlugin(warmPlugin);
    writeFileSync(changedPath, changedSource("offline"));
    const restartedPlugin = await startPlugin();
    expectTone(
      await transform(restartedPlugin, fixture.componentPath),
      "offline",
    );
    expect(createCount).toBe(2);
    expect(dependencies.get(fixture.componentPath)).toEqual(
      expectedDependencies(fixture.componentPath),
    );
  }, 60_000);
});

describe.each([
  ["default", {}],
  ["watch", { EXPERIMENTAL_useWatchProgram: true }],
  ["project service", { EXPERIMENTAL_useProjectService: true }],
] as const)("compiler-consistent dependency resolution: %s", (_mode, modeOptions) => {
  const declarationSource = (mode: string, revision: number) =>
    `export interface Props {
  /** ${mode} tone ${revision}. */
  tone: "${mode}-${revision}";
}
`;
  const componentSource = (statement: string, props = "Props") =>
    `declare namespace JSX { interface Element {} }
${statement}
export const Component = (_props: ${props}): JSX.Element =>
  null as unknown as JSX.Element;
`;

  const createConditionalFixture = (files: Record<string, string>) => {
    const fixture = createFixture(
      {
        ...files,
        "esm.d.ts": declarationSource("esm", 0),
        "cjs.d.ts": declarationSource("cjs", 0),
      },
      Object.keys(files)[0],
    );
    writeFileSync(
      path.join(fixture.root, "package.json"),
      JSON.stringify({
        exports: {
          "./missing": { import: "./missing-esm.d.ts", require: "./cjs.d.ts" },
          "./props": { import: "./esm.d.ts", require: "./cjs.d.ts" },
        },
        name: "conditional-types",
        type: "module",
      }),
    );
    writeFileSync(
      fixture.tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          jsx: "preserve",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          skipLibCheck: true,
          target: "ES2020",
        },
        include: ["**/*.tsx", "*.d.ts"],
      }),
    );
    return fixture;
  };

  it("tracks the NodeNext declaration selected by each import and refreshes its metadata", async () => {
    const fixture = createConditionalFixture({
      "Import.tsx": componentSource(
        'import type { Props } from "conditional-types/props";',
      ),
      "commonjs/Common.tsx": componentSource(
        'import type { Props } from "conditional-types/props";',
      ),
      "Require.tsx": componentSource(
        'import Required = require("conditional-types/props");',
        "Required.Props",
      ),
      "Attribute.tsx": componentSource(
        'import type { Props } from "conditional-types/props" with { "resolution-mode": "require" };',
      ),
      "Mixed.tsx": `${componentSource(
        `import type { Props } from "conditional-types/props";
import type { Props as RequiredProps } from "conditional-types/props" with { "resolution-mode": "require" };`,
      )}
export const RequiredComponent = (_props: RequiredProps): JSX.Element =>
  null as unknown as JSX.Element;`,
      "RequireCall.tsx": componentSource(
        'declare function require(specifier: string): unknown; const required = require("conditional-types/props");',
        "{ value: string }",
      ),
    });
    writeFileSync(
      path.join(fixture.root, "commonjs", "package.json"),
      JSON.stringify({ type: "commonjs" }),
    );
    const backend = await createDirectBackend(fixture, {
      ...modeOptions,
      shouldExtractValuesFromUnion: true,
    });
    const cases = [
      ["Import.tsx", ["esm"]],
      ["commonjs/Common.tsx", ["cjs"]],
      ["Require.tsx", ["cjs"]],
      ["Attribute.tsx", ["cjs"]],
      ["Mixed.tsx", ["esm", "cjs"]],
    ] as const;
    const typeRevisions = { cjs: 0, esm: 0 };
    const analyze = async (revision: number) => {
      for (const [file, modes] of cases) {
        const fileName = path.join(fixture.root, file);
        const result = await backend.analyze({
          fileName,
          revision,
          source: readFileSync(fileName, "utf-8"),
        });
        expect(result.status).toBe("ok");
        if (result.status !== "ok") throw new Error(result.error.message);
        expect(
          result.components.map((component) => component.props.tone),
        ).toMatchObject(
          modes.map((mode) => ({
            description: `${mode} tone ${typeRevisions[mode]}.`,
            type: { name: `"${mode}-${typeRevisions[mode]}"` },
          })),
        );
        expect(result.dependencies).toEqual(
          [
            fileName,
            ...modes.map((mode) => path.join(fixture.root, `${mode}.d.ts`)),
          ].sort(),
        );
        expect(result.unresolvedDependencies).toEqual([]);
      }
    };
    try {
      await analyze(0);
      const requireFile = path.join(fixture.root, "RequireCall.tsx");
      const required = await backend.analyze({
        fileName: requireFile,
        revision: 0,
        source: readFileSync(requireFile, "utf-8"),
      });
      expect(required.status).toBe("ok");
      expect(required.dependencies).toEqual(
        [requireFile, path.join(fixture.root, "cjs.d.ts")].sort(),
      );
      for (const [revision, mode] of [
        [1, "esm"],
        [2, "cjs"],
      ] as const) {
        const source = declarationSource(mode, revision);
        const fileName = path.join(fixture.root, `${mode}.d.ts`);
        writeFileSync(fileName, source);
        const update = await backend.update({
          affectedComponentFiles: cases
            .filter(([, targets]) => targets.some((target) => target === mode))
            .map(([file]) => path.join(fixture.root, file)),
          change: { fileName, kind: "change", revision, source },
        });
        expect(
          update.status === "pending"
            ? (await update.ready).status
            : update.status,
        ).toBe("ready");
        typeRevisions[mode] = revision;
        await analyze(revision);
      }
    } finally {
      await backend.dispose();
    }
  }, 60_000);

  it("records a missing NodeNext import target instead of the existing require target", async () => {
    const fixture = createConditionalFixture({
      "Missing.tsx": componentSource(
        'import type { Props } from "conditional-types/missing";',
      ),
    });
    const backend = await createDirectBackend(fixture, modeOptions);
    try {
      const result = await backend.analyze({
        fileName: fixture.componentPath,
        revision: 0,
        source: readFileSync(fixture.componentPath, "utf-8"),
      });
      expect(result.status).toBe("ok");
      expect(result.unresolvedDependencies).toContain(
        path.join(fixture.root, "missing-esm.d.ts"),
      );
      expect(result.dependencies).toEqual([fixture.componentPath]);
      expect(result.unresolvedDependencies).not.toContain(
        path.join(fixture.root, "cjs.d.ts"),
      );
    } finally {
      await backend.dispose();
    }
  });
});

it("uses referenced ProjectService paths and ambient inputs after analyzing the root", async () => {
  const root = createTemporaryDirectory();
  const referencedRoot = path.join(root, "referenced");
  mkdirSync(referencedRoot);
  const componentSource = `declare namespace JSX { interface Element {} }
import type { Props } from "@props";
export const Component = (_props: Props & AmbientProps): JSX.Element =>
  null as unknown as JSX.Element;
`;
  const propsSource = (description: string) =>
    `export interface Props {\n /** ${description} */\n tone: "base" | "quiet"; }`;
  const rootFile = path.join(root, "Root.tsx");
  const componentFile = path.join(referencedRoot, "Component.tsx");
  const propsFile = path.join(referencedRoot, "props.ts");
  writeFileSync(rootFile, componentSource);
  writeFileSync(
    componentFile,
    `${componentSource}\nimport type { Missing } from "@missing";`,
  );
  writeFileSync(path.join(root, "props.ts"), propsSource("Root tone."));
  writeFileSync(propsFile, propsSource("Referenced tone."));
  writeFileSync(
    path.join(root, "ambient.ts"),
    'interface AmbientProps { ambient: "root"; }',
  );
  writeFileSync(
    path.join(referencedRoot, "ambient.ts"),
    'interface AmbientProps { ambient: "referenced"; }',
  );
  const compilerOptions = {
    baseUrl: ".",
    jsx: "preserve",
    module: "ESNext",
    moduleResolution: "Bundler",
    paths: { "@missing": ["missing.ts"], "@props": ["props.ts"] },
    skipLibCheck: true,
    target: "ES2020",
  };
  const tsconfigPath = path.join(root, "tsconfig.json");
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      compilerOptions,
      files: ["Root.tsx", "props.ts", "ambient.ts"],
      references: [{ path: "./referenced" }],
    }),
  );
  writeFileSync(
    path.join(referencedRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { ...compilerOptions, composite: true },
      files: ["Component.tsx", "props.ts", "ambient.ts"],
    }),
  );
  const options: Options = {
    EXPERIMENTAL_useProjectService: true,
    tsconfigPath,
  };
  const backend = await createLegacyBackendFactory(options).create({
    rootDir: root,
    selection: resolveFileSelection(root, options),
  });
  const analyze = async (
    fileName: string,
    description: string,
    revision: number,
  ) => {
    const result = await backend.analyze({
      fileName,
      revision,
      source: readFileSync(fileName, "utf-8"),
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error(result.error.message);
    expect(result.components[0]?.props.tone.description).toBe(description);
    expect(result.components[0]?.props.ambient.type.name).toBe(
      fileName === rootFile ? '"root"' : '"referenced"',
    );
    expect(result.dependencies).toEqual(
      [
        fileName,
        path.join(path.dirname(fileName), "props.ts"),
        path.join(path.dirname(fileName), "ambient.ts"),
      ].sort(),
    );
    return result;
  };
  try {
    await analyze(rootFile, "Root tone.", 0);
    const result = await analyze(componentFile, "Referenced tone.", 0);
    expect(result.unresolvedDependencies).toContain(
      path.join(referencedRoot, "missing.ts"),
    );
    expect(result.unresolvedDependencies).not.toContain(
      path.join(root, "missing.ts"),
    );
    const source = propsSource("Updated referenced tone.");
    writeFileSync(propsFile, source);
    const update = await backend.update({
      affectedComponentFiles: [componentFile],
      change: { fileName: propsFile, kind: "change", revision: 1, source },
    });
    expect(update.status).toBe("ready");
    await analyze(componentFile, "Updated referenced tone.", 1);
    await analyze(rootFile, "Root tone.", 1);
  } finally {
    await backend.dispose();
  }
});

describe.each([
  ["default", {}],
  ["watch", { EXPERIMENTAL_useWatchProgram: true }],
  ["project service", { EXPERIMENTAL_useProjectService: true }],
] as const)("cyclic dependency tracking: %s", (_mode, modeOptions) => {
  it.each([
    ["A then B", ["A.tsx", "B.tsx"]],
    ["B then A", ["B.tsx", "A.tsx"]],
  ] as const)(
    "keeps exact dependencies and fresh shared metadata in %s transform order",
    async (_order, cycleFiles) => {
      const sharedSource = (description: string, values: readonly string[]) =>
        `export interface SharedProps {
  /** ${description} */
  tone: ${values.map((value) => JSON.stringify(value)).join(" | ")};
}
`;
      const componentSource = (name: string, imports: string, props: string) =>
        `declare namespace JSX { interface Element {} }
${imports}
export const ${name} = (_props: ${props}): JSX.Element =>
  null as unknown as JSX.Element;
`;
      const fixture = createFixture(
        {
          "A.tsx": componentSource(
            "A",
            `import type { BLink } from "./B";
import type { SharedProps } from "./Shared";
export interface ALink { next?: BLink; }
export type AProps = SharedProps;`,
            "AProps",
          ),
          "B.tsx": componentSource(
            "B",
            `import type { ALink, AProps } from "./A";
export interface BLink { next?: ALink; }`,
            "AProps",
          ),
          "Diamond.tsx": componentSource(
            "Diamond",
            `import type { LeftProps } from "./Left";
import type { RightProps } from "./Right";`,
            "LeftProps & RightProps",
          ),
          "Left.ts":
            'export type { SharedProps as LeftProps } from "./Shared";',
          "Right.ts":
            'export type { SharedProps as RightProps } from "./Shared";',
          "Self.tsx": componentSource(
            "Self",
            `import type { SelfLink as Link } from "./Self";
import type { SharedProps } from "./Shared";
export interface SelfLink { next?: Link; }`,
            "SharedProps",
          ),
          "Shared.ts": sharedSource("Initial shared tone.", ["base", "quiet"]),
          "Unrelated.tsx": componentSource(
            "Unrelated",
            "",
            "{ value: string }",
          ),
        },
        "A.tsx",
      );
      const expectedDependencies = {
        "A.tsx": ["A.tsx", "B.tsx", "Shared.ts"],
        "B.tsx": ["A.tsx", "B.tsx", "Shared.ts"],
        "Diamond.tsx": ["Diamond.tsx", "Left.ts", "Right.ts", "Shared.ts"],
        "Self.tsx": ["Self.tsx", "Shared.ts"],
        "Unrelated.tsx": ["Unrelated.tsx"],
      };
      const options: Options = {
        ...modeOptions,
        exclude: [],
        include: ["*.tsx"],
        shouldExtractValuesFromUnion: true,
        tsconfigPath: fixture.tsconfigPath,
      };
      const dependencies = new Map<string, readonly string[]>();
      const factory = createLegacyBackendFactory(options);
      const plugin = createPluginWithBackend(options, {
        ...factory,
        async create(context) {
          const backend = await factory.create(context);
          return {
            ...backend,
            async analyze(request) {
              const result = await backend.analyze(request);
              dependencies.set(request.fileName, result.dependencies);
              return result;
            },
          };
        },
      });
      plugins.push(plugin);
      // @ts-expect-error The focused harness supplies only the resolved fields used.
      await plugin.configResolved?.({ command: "serve", root: fixture.root });

      const transform = async (
        file: keyof typeof expectedDependencies,
        description: string,
        values: readonly string[],
      ) => {
        const fileName = path.join(fixture.root, file);
        const result = await plugin.transform?.call(
          { warn: vi.fn() } as never,
          readFileSync(fileName, "utf-8"),
          fileName,
        );
        if (!result || typeof result === "string") {
          throw new Error(`Expected generated transform result for ${file}`);
        }
        if (file !== "Unrelated.tsx") {
          expect(extractGeneratedComponents(result.code, fixture.root)).toEqual(
            [
              expect.objectContaining({
                props: expect.objectContaining({
                  tone: expect.objectContaining({
                    description,
                    type: expect.objectContaining({
                      value: values.map((value) => ({
                        value: JSON.stringify(value),
                      })),
                    }),
                  }),
                }),
              }),
            ],
          );
        }
        expect(dependencies.get(fileName)).toEqual(
          expectedDependencies[file]
            .map((dependency) => path.join(fixture.root, dependency))
            .sort(),
        );
        return result.code;
      };
      const dependentFiles = [
        ...cycleFiles,
        "Self.tsx",
        "Diamond.tsx",
      ] as const;
      for (const file of dependentFiles) {
        await transform(file, "Initial shared tone.", ["base", "quiet"]);
      }
      const unrelatedCode = await transform("Unrelated.tsx", "", []);
      const modules = new Map(
        [...dependentFiles, "Unrelated.tsx"].map((file) => {
          const fileName = path.join(fixture.root, file);
          return [fileName, { id: fileName, url: fileName }];
        }),
      );
      const sharedFile = path.join(fixture.root, "Shared.ts");
      for (const [timestamp, member] of [
        [1, "contrast"],
        [2, "emphasis"],
      ] as const) {
        const description = `${member} shared tone.`;
        const values = ["base", "quiet", member];
        const source = sharedSource(description, values);
        writeFileSync(sharedFile, source);
        // @ts-expect-error The focused harness supplies only the used HMR fields.
        const hotModules = await plugin.handleHotUpdate?.call(
          { warn: vi.fn() },
          {
            file: sharedFile,
            modules: [],
            read: () => source,
            server: {
              moduleGraph: {
                getModulesByFile: (fileName: string) => {
                  const module = modules.get(fileName);
                  return module ? new Set([module]) : undefined;
                },
                invalidateModule: vi.fn(),
              },
            },
            timestamp,
          },
        );
        expect(hotModules?.map((module) => module.id).sort()).toEqual(
          dependentFiles.map((file) => path.join(fixture.root, file)).sort(),
        );
        for (const file of dependentFiles) {
          await transform(file, description, values);
        }
        expect(await transform("Unrelated.tsx", "", [])).toBe(unrelatedCode);
      }
    },
    60_000,
  );
});

describe.each([
  ["default", {}],
  ["stable legacy", { docgenMode: "legacy" }],
  ["watch", { EXPERIMENTAL_useWatchProgram: true }],
  ["project service", { EXPERIMENTAL_useProjectService: true }],
  ["stable project service", { docgenMode: "project-service" }],
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
