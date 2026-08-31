import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Plugin } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFileSelection } from "../utils/fileSelection";
import type { Options } from "../utils/options";

const temporaryDirectories: string[] = [];
const plugins: Plugin[] = [];

const createTemporaryDirectory = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "docgen-selection-"));
  temporaryDirectories.push(directory);
  return directory;
};

const importPluginFactory = async () => (await import("../index")).default;

const createPlugin = async (options: Options = {}) => {
  const factory = await importPluginFactory();
  const plugin = factory(options);
  plugins.push(plugin);
  return plugin;
};

const runConfigResolved = async (
  plugin: Plugin,
  root: string,
  command: "build" | "serve" = "serve",
) => {
  const hook = plugin.configResolved;

  if (typeof hook === "function") {
    await hook({ command, root } as never);
    return;
  }

  await hook?.handler({ command, root } as never);
};

const runTransform = async (
  plugin: Plugin,
  source: string,
  fileName: string,
  warn = vi.fn(),
) => {
  const hook = plugin.transform;
  const context = { warn } as never;

  return typeof hook === "function"
    ? hook.call(context, source, fileName)
    : hook?.handler.call(context, source, fileName);
};

const closePlugin = async (plugin: Plugin) => {
  const hook = plugin.closeBundle;

  if (typeof hook === "function") {
    await hook.call({} as never);
    return;
  }

  await hook?.handler.call({} as never);
};

afterEach(async () => {
  await Promise.all(plugins.splice(0).map(closePlugin));

  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }

  vi.doUnmock("typescript");
  vi.doUnmock("react-docgen-typescript");
});

const expectGeneratedDocgen = (result: unknown) => {
  expect(result).toBeTypeOf("object");
  expect((result as { code: string }).code).toContain(".__docgenInfo");
  return (result as { code: string }).code;
};

const componentSource = `declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { button: { children?: unknown } }
}

export interface ButtonProps {
  /** Visible label. */
  label: string;
}

export const Button = ({ label }: ButtonProps): JSX.Element => <button>{label}</button>;
`;

const createReferencedProject = () => {
  const parent = createTemporaryDirectory();
  const root = path.join(parent, "apps", "storybook");
  const uiRoot = path.join(parent, "library");
  const uiSourceDirectory = path.join(uiRoot, "src");
  const componentPath = path.join(uiSourceDirectory, "Button.tsx");
  const storyPath = path.join(uiSourceDirectory, "Button.stories.tsx");
  const rootSourcePath = path.join(root, "src", "Root.tsx");
  const tsconfigPath = path.join(root, "tsconfig.json");

  mkdirSync(path.dirname(rootSourcePath), { recursive: true });
  mkdirSync(uiSourceDirectory, { recursive: true });
  writeFileSync(componentPath, componentSource);
  writeFileSync(storyPath, componentSource);
  writeFileSync(rootSourcePath, componentSource);
  writeFileSync(
    tsconfigPath,
    JSON.stringify({
      files: [],
      references: [{ path: "../../library/tsconfig.build.json" }],
    }),
  );
  writeFileSync(
    path.join(uiRoot, "tsconfig.build.json"),
    JSON.stringify({
      compilerOptions: {
        composite: true,
        jsx: "preserve",
        module: "ESNext",
        skipLibCheck: true,
        target: "ES2020",
      },
      files: ["src/Button.tsx", "src/Button.stories.tsx"],
    }),
  );

  return {
    componentPath,
    root,
    rootSourcePath,
    storyPath,
    tsconfigPath,
    uiRoot,
  };
};

describe("file-selection contract", () => {
  it("resolves root, referenced, parent, exclusion, and empty-array globs", () => {
    const project = createReferencedProject();
    const rootStoryPath = path.join(project.root, "src", "Root.stories.tsx");
    const declarationPath = path.join(project.uiRoot, "src", "types.d.ts");
    const defaults = resolveFileSelection(project.root, {});

    expect(defaults.matchesDocgenFile(project.rootSourcePath)).toBe(true);
    expect(defaults.matchesDocgenFile(project.componentPath)).toBe(true);
    expect(defaults.matchesDocgenFile(rootStoryPath)).toBe(false);
    expect(defaults.matchesDocgenFile(project.storyPath)).toBe(false);

    const rootOnly = resolveFileSelection(project.root, {
      include: ["src/**/*.tsx"],
    });
    expect(rootOnly.matchesDocgenFile(project.rootSourcePath)).toBe(true);
    expect(rootOnly.matchesDocgenFile(project.componentPath)).toBe(false);

    const referencedOnly = resolveFileSelection(project.root, {
      include: ["../../library/**/*.tsx"],
    });
    expect(referencedOnly.matchesDocgenFile(project.rootSourcePath)).toBe(
      false,
    );
    expect(referencedOnly.matchesDocgenFile(project.componentPath)).toBe(true);

    const explicitlyExcluded = resolveFileSelection(project.root, {
      exclude: ["../../library/src/Button.tsx"],
      include: ["../../library/**/*.tsx"],
    });
    expect(explicitlyExcluded.matchesDocgenFile(project.componentPath)).toBe(
      false,
    );

    const emptyInclude = resolveFileSelection(project.root, { include: [] });
    expect(emptyInclude.hasIncludes).toBe(false);
    expect(emptyInclude.matchesDocgenFile(project.rootSourcePath)).toBe(false);

    const emptyExclude = resolveFileSelection(project.root, { exclude: [] });
    expect(emptyExclude.matchesDocgenFile(project.storyPath)).toBe(true);

    const broadTypescript = resolveFileSelection(project.root, {
      exclude: [],
      include: ["**/*.ts", "**/*.tsx"],
    });
    expect(broadTypescript.matchesDocgenFile(declarationPath)).toBe(false);
  });

  it.each([
    ["include", /x/, /"include".*array of string globs.*RegExp/i],
    ["exclude", "x", /"exclude".*array of string globs.*string/i],
    ["include", ["**/*.tsx", /x/], /"include".*index 1.*RegExp/i],
    ["exclude", [42], /"exclude".*index 0.*number/i],
    ["include", Array(1), /"include".*index 0.*undefined/i],
  ])("rejects invalid %s patterns during configuration", async (optionName, value, expectedMessage) => {
    const root = createTemporaryDirectory();
    const plugin = await createPlugin({
      [optionName]: value,
    } as unknown as Options);

    await expect(runConfigResolved(plugin, root)).rejects.toThrowError(
      expectedMessage,
    );
    await expect(runConfigResolved(plugin, root)).rejects.not.toThrowError(
      /globSync|invalid pattern/i,
    );
  });

  it.each([
    "serve",
    "build",
  ] as const)("keeps include: [] as a no-load no-op in %s", async (command) => {
    vi.resetModules();
    let typescriptLoads = 0;
    let docgenLoads = 0;

    vi.doMock("typescript", async () => {
      typescriptLoads += 1;
      return vi.importActual("typescript");
    });
    vi.doMock("react-docgen-typescript", async () => {
      docgenLoads += 1;
      return vi.importActual("react-docgen-typescript");
    });

    const root = createTemporaryDirectory();
    const tsconfigPath = path.join(root, "tsconfig.json");
    const componentPath = path.join(root, "Component.tsx");
    const warn = vi.fn();
    writeFileSync(tsconfigPath, "{}");
    writeFileSync(componentPath, componentSource);
    const plugin = await createPlugin({ include: [], tsconfigPath });

    await runConfigResolved(plugin, root, command);
    expect(
      await runTransform(plugin, componentSource, componentPath, warn),
    ).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(typescriptLoads).toBe(0);
    expect(docgenLoads).toBe(0);
  });

  it("still rejects a missing explicit tsconfig when include is empty", async () => {
    const root = createTemporaryDirectory();
    const missingTsconfigPath = path.join(root, "missing.json");
    const plugin = await createPlugin({
      include: [],
      tsconfigPath: missingTsconfigPath,
    });

    await expect(runConfigResolved(plugin, root)).rejects.toThrowError(
      /Failed to read tsconfig.*File does not exist/,
    );
  });

  it.each([
    ["default", {}],
    ["stable legacy", { docgenMode: "legacy" }],
    ["watch", { EXPERIMENTAL_useWatchProgram: true }],
    ["project service", { EXPERIMENTAL_useProjectService: true }],
    ["stable project service", { docgenMode: "project-service" }],
    [
      "project-service precedence",
      {
        EXPERIMENTAL_useProjectService: true,
        EXPERIMENTAL_useWatchProgram: true,
      },
    ],
  ] as const)(
    "processes recursively referenced TSX files in %s mode",
    async (_, modeOptions) => {
      const project = createReferencedProject();
      const plugin = await createPlugin({
        ...modeOptions,
        tsconfigPath: project.tsconfigPath,
      });
      const warn = vi.fn();

      await runConfigResolved(plugin, project.root);
      const result = await runTransform(
        plugin,
        readFileSync(project.componentPath, "utf8"),
        project.componentPath,
        warn,
      );

      expectGeneratedDocgen(result);
      expect(warn).not.toHaveBeenCalled();
    },
    20_000,
  );

  it("discovers an explicit parent-directory include without a tsconfig", async () => {
    const project = createReferencedProject();
    const plugin = await createPlugin({
      compilerOptions: {
        jsx: 1,
        module: 99,
        target: 99,
      },
      include: ["../../library/**/*.tsx"],
    });

    await runConfigResolved(plugin, project.root);
    expectGeneratedDocgen(
      await runTransform(
        plugin,
        readFileSync(project.componentPath, "utf8"),
        project.componentPath,
      ),
    );
  });

  it("keeps nonmatching configured roots and declarations as analysis-only inputs", async () => {
    const root = createTemporaryDirectory();
    const sourceDirectory = path.join(root, "src");
    const componentPath = path.join(sourceDirectory, "Component.tsx");
    const augmentationPath = path.join(sourceDirectory, "augmentation.ts");
    const declarationPath = path.join(sourceDirectory, "sizes.d.ts");
    const tsconfigPath = path.join(root, "tsconfig.json");
    const source = `declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { button: { children?: unknown } }
}
interface Props { tone: AugmentedTone; size: DeclaredSize }
export const Component = ({ tone }: Props): JSX.Element => <button>{tone}</button>;
`;

    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(componentPath, source);
    writeFileSync(
      augmentationPath,
      'export {}; declare global { type AugmentedTone = "light" | "dark"; }',
    );
    writeFileSync(declarationPath, 'type DeclaredSize = "small" | "large";');
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: {
          jsx: "preserve",
          module: "ESNext",
          skipLibCheck: true,
          target: "ES2020",
        },
        files: ["src/Component.tsx", "src/augmentation.ts", "src/sizes.d.ts"],
      }),
    );

    const plugin = await createPlugin({
      shouldExtractValuesFromUnion: true,
      tsconfigPath,
    });
    const warn = vi.fn();
    await runConfigResolved(plugin, root);
    const generatedCode = expectGeneratedDocgen(
      await runTransform(plugin, source, componentPath, warn),
    );

    expect(generatedCode).toContain("light");
    expect(generatedCode).toContain("dark");
    expect(generatedCode).toContain("small");
    expect(generatedCode).toContain("large");
    expect(
      await runTransform(
        plugin,
        readFileSync(augmentationPath, "utf8"),
        augmentationPath,
        warn,
      ),
    ).toBeUndefined();
    expect(
      await runTransform(
        plugin,
        readFileSync(declarationPath, "utf8"),
        declarationPath,
        warn,
      ),
    ).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it("tracks a transitive TypeScript dependency without promoting it to docgen", async () => {
    const root = createTemporaryDirectory();
    const sourceDirectory = path.join(root, "src");
    const componentPath = path.join(sourceDirectory, "Component.tsx");
    const typesPath = path.join(sourceDirectory, "types.ts");
    const tsconfigPath = path.join(root, "tsconfig.json");
    const source = `import type { ButtonProps } from "./types";
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { button: { children?: unknown } }
}
export const Component = ({ tone }: ButtonProps): JSX.Element => <button>{tone}</button>;
`;
    const typesSource =
      'export interface ButtonProps { tone: "light" | "dark" }';

    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(componentPath, source);
    writeFileSync(typesPath, typesSource);
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
        files: ["src/Component.tsx"],
      }),
    );

    const plugin = await createPlugin({
      exclude: [],
      include: ["**/*.ts", "**/*.tsx"],
      tsconfigPath,
    });
    const warn = vi.fn();
    await runConfigResolved(plugin, root);
    expectGeneratedDocgen(
      await runTransform(plugin, source, componentPath, warn),
    );

    expect(await runTransform(plugin, typesSource, typesPath, warn)).toBe(
      typesSource,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /matches the plugin patterns.*not a member of the configured TypeScript project/i,
      ),
    );
  });

  it("checks configured membership before returning a persisted transform", async () => {
    const root = createTemporaryDirectory();
    const sourceDirectory = path.join(root, "src");
    const componentPath = path.join(sourceDirectory, "Component.tsx");
    const analysisPath = path.join(sourceDirectory, "analysis.ts");
    const cacheDirectory = path.join(root, "cache");
    const tsconfigPath = path.join(root, "tsconfig.json");
    const analysisSource = "export const analysisOnly = true;";
    const pluginOptions: Options = {
      exclude: [],
      fileSystemCache: { directory: cacheDirectory, enabled: true },
      include: ["**/*.ts", "**/*.tsx"],
      tsconfigPath,
    };

    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(componentPath, componentSource);
    writeFileSync(analysisPath, analysisSource);
    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { jsx: "preserve", module: "ESNext" },
        files: ["src/analysis.ts"],
      }),
    );

    const initialPlugin = await createPlugin(pluginOptions);
    await runConfigResolved(initialPlugin, root);
    expect(
      await runTransform(initialPlugin, analysisSource, analysisPath),
    ).toBeNull();

    writeFileSync(
      tsconfigPath,
      JSON.stringify({
        compilerOptions: { jsx: "preserve", module: "ESNext" },
        files: ["src/Component.tsx"],
      }),
    );

    const warmPlugin = await createPlugin(pluginOptions);
    const warn = vi.fn();
    await runConfigResolved(warmPlugin, root);
    expect(
      await runTransform(warmPlugin, analysisSource, analysisPath, warn),
    ).toBe(analysisSource);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /matches the plugin patterns.*not a member of the configured TypeScript project/i,
      ),
    );
  });
});
