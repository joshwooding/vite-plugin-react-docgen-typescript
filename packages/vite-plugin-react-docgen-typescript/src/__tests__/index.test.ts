import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import reactDocgenTypescript from "../index";

const tsconfigPathForTest = resolve(__dirname, "tsconfig.test.json");
const fixturesPath = resolve(__dirname, "__fixtures__");
const projectRootForSnapshot = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
).replaceAll("\\", "/");

const normalizeSnapshotText = (value: string) =>
  value
    .replaceAll("\\", "/")
    .replaceAll(projectRootForSnapshot, "<PROJECT_ROOT>");

const normalizeTransformResultForSnapshot = <T>(value: T): T => {
  if (typeof value === "string") {
    return normalizeSnapshotText(value) as T;
  }

  if (!value || typeof value !== "object" || !("code" in value)) {
    return value;
  }

  const { code } = value;

  if (typeof code !== "string") {
    return value;
  }

  return {
    ...value,
    code: normalizeSnapshotText(code),
  } as T;
};

const fixtureTests = readdirSync(fixturesPath)
  .filter((filename) => filename.endsWith(".tsx"))
  .map((filename) => join(fixturesPath, filename))
  .map((filename) => ({
    id: filename,
    code: readFileSync(filename, "utf-8"),
  }));

const defaultPropValueFixture = fixtureTests.find(
  (f) => basename(f.id) === "DefaultPropValue.tsx",
);
const defaultExportFixture = fixtureTests.find(
  (f) => basename(f.id) === "DefaultExport.tsx",
);
const defaultExportWithDisplayNameFixture = fixtureTests.find(
  (f) => basename(f.id) === "DefaultExportWithDisplayName.tsx",
);
const forwardRefDefaultExportFixture = fixtureTests.find(
  (f) => basename(f.id) === "ForwardRefDefaultExport.tsx",
);
const richMetadataFixture = fixtureTests.find(
  (f) => basename(f.id) === "RichMetadata.tsx",
);
const simpleFixture = fixtureTests.find((f) => basename(f.id) === "Simple.tsx");
const plugins: ReturnType<typeof reactDocgenTypescript>[] = [];
const temporaryDirectories: string[] = [];

const createPlugin = (...args: Parameters<typeof reactDocgenTypescript>) => {
  const plugin = reactDocgenTypescript(...args);

  plugins.push(plugin);

  return plugin;
};

const waitForWatchFileTimestampTick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 1_100);
  });

const closePlugin = async (
  plugin: ReturnType<typeof reactDocgenTypescript> | undefined,
) => {
  const closeBundle = plugin?.closeBundle;

  if (!closeBundle) {
    return;
  }

  if (typeof closeBundle === "function") {
    await closeBundle.call({} as never);
    return;
  }

  await closeBundle.handler.call({} as never);
};

const createTemporaryDirectory = () => {
  const directory = mkdtempSync(
    join(tmpdir(), "vite-plugin-react-docgen-typescript-"),
  );

  temporaryDirectories.push(directory);

  return directory;
};

const createTemporaryFixtureProject = () => {
  const root = createTemporaryDirectory();
  const componentPath = join(root, "Simple.tsx");

  if (!simpleFixture) {
    throw new Error("Missing Simple.tsx fixture");
  }

  writeFileSync(componentPath, simpleFixture.code);

  return {
    cacheDirectory: join(root, ".docgen-cache"),
    componentPath,
    defaultCacheDirectory: join(
      root,
      "node_modules",
      ".cache",
      "vite-plugin-react-docgen-typescript",
    ),
    root,
  };
};

const createTemporaryWatchFixtureProject = () => {
  const project = createTemporaryFixtureProject();
  const tsconfigPath = join(project.root, "tsconfig.json");

  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          esModuleInterop: true,
          jsx: "react",
          module: "CommonJS",
          target: "ES2018",
        },
        include: ["./**/*"],
      },
      null,
      2,
    ),
  );

  return {
    ...project,
    tsconfigPath,
  };
};

const createTemporaryTypeDependencyProject = () => {
  const root = createTemporaryDirectory();
  const componentPath = join(root, "TypeDependency.tsx");
  const independentComponentPath = join(root, "IndependentComponent.tsx");
  const typeDependencyPath = join(root, "TypeDependency.types.ts");
  const tsconfigPath = join(root, "tsconfig.json");

  const componentCode = `import * as React from "react";
import type { TypeDependencyProps } from "./TypeDependency.types";

/**
 * A component that depends on imported props.
 */
export const TypeDependencyComponent: React.FC<TypeDependencyProps> = (props) => (
  <button style={{ backgroundColor: props.color }}>{props.children}</button>
);
`;
  const independentComponentCode = `import * as React from "react";

interface IndependentComponentProps {
  /** Independent label. */
  label: string;
}

/**
 * An unrelated component.
 */
export const IndependentComponent: React.FC<IndependentComponentProps> = (
  props,
) => <span>{props.label}</span>;
`;

  writeFileSync(componentPath, componentCode);
  writeFileSync(independentComponentPath, independentComponentCode);
  writeFileSync(
    typeDependencyPath,
    `export interface TypeDependencyProps {
  /** Button color. */
  color: "blue" | "green";
}
`,
  );
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          esModuleInterop: true,
          jsx: "react",
          module: "CommonJS",
          target: "ES2018",
        },
        include: ["./**/*"],
      },
      null,
      2,
    ),
  );

  return {
    cacheDirectory: join(root, ".docgen-cache"),
    componentCode,
    componentPath,
    independentComponentCode,
    independentComponentPath,
    root,
    tsconfigPath,
    typeDependencyPath,
  };
};

const createTemporaryImportedTypeDocgenProject = () => {
  const root = createTemporaryDirectory();
  const componentPath = join(root, "ImportedTypeDocgen.tsx");
  const typeDependencyPath = join(root, "ImportedTypeDocgen.types.ts");
  const tsconfigPath = join(root, "tsconfig.json");

  const componentCode = `import type { ImportedTypeDocgenProps } from "./ImportedTypeDocgen.types";

/** Component using imported props. */
export const ImportedTypeDocgen = (props: ImportedTypeDocgenProps) => (
  <button data-variant={props.variant}>{props.variant}</button>
);
`;

  writeFileSync(componentPath, componentCode);
  writeFileSync(
    typeDependencyPath,
    `export interface ImportedTypeDocgenProps {
  /** Imported variant description. */
  variant?: "pill" | "modern";
}
`,
  );
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          esModuleInterop: true,
          jsx: "react-jsx",
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ES2020",
        },
        include: ["./**/*"],
      },
      null,
      2,
    ),
  );

  return {
    componentCode,
    componentPath,
    root,
    tsconfigPath,
    typeDependencyPath,
  };
};

const createTemporaryTsconfigRefreshProject = () => {
  const root = createTemporaryDirectory();
  const componentPath = join(root, "Simple.tsx");
  const placeholderTypesPath = join(root, "Placeholder.types.ts");
  const tsconfigPath = join(root, "tsconfig.json");

  if (!simpleFixture) {
    throw new Error("Missing Simple.tsx fixture");
  }

  writeFileSync(componentPath, simpleFixture.code);
  writeFileSync(placeholderTypesPath, 'export type Placeholder = "ready";\n');
  writeFileSync(
    tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          esModuleInterop: true,
          jsx: "react",
          module: "CommonJS",
          target: "ES2018",
        },
        include: ["./**/*.types.ts"],
      },
      null,
      2,
    ),
  );

  return {
    componentCode: simpleFixture.code,
    componentPath,
    placeholderTypesPath,
    root,
    tsconfigPath,
  };
};

afterEach(async () => {
  while (plugins.length > 0) {
    const plugin = plugins.pop();

    await closePlugin(plugin);
  }

  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();

    if (!directory) {
      break;
    }

    rmSync(directory, {
      force: true,
      recursive: true,
    });
  }
});

describe("component fixture", () => {
  fixtureTests.forEach((fixture) => {
    it(`${basename(fixture.id)} has code block generated`, async () => {
      const plugin = createPlugin({
        tsconfigPath: tsconfigPathForTest,
      });
      // @ts-expect-error
      await plugin.configResolved?.();
      expect(
        normalizeTransformResultForSnapshot(
          // @ts-expect-error
          await plugin.transform?.call({}, fixture.code, fixture.id),
        ),
      ).toMatchSnapshot();
    }, 15_000);
  });
});

it("generates value info for enums", async () => {
  const plugin = createPlugin({
    tsconfigPath: tsconfigPathForTest,
    shouldExtractLiteralValuesFromEnum: true,
  });
  // @ts-expect-error
  await plugin.configResolved?.();
  expect(
    normalizeTransformResultForSnapshot(
      // @ts-expect-error
      await plugin.transform?.call(
        {},
        defaultPropValueFixture?.code,
        defaultPropValueFixture?.id,
      ),
    ),
  ).toMatchSnapshot();
});

it("preserves rich component and prop metadata in docgen info", async () => {
  const plugin = createPlugin({
    tsconfigPath: tsconfigPathForTest,
  });

  // @ts-expect-error
  await plugin.configResolved?.();
  const result =
    // @ts-expect-error
    await plugin.transform?.call(
      {},
      richMetadataFixture?.code,
      richMetadataFixture?.id,
    );

  expect(result).toEqual(
    expect.objectContaining({
      code: expect.stringContaining(
        '"tags":{"status":"beta","see":"https://example.com/rich-metadata"}',
      ),
      map: null,
    }),
  );
  expect(result).toEqual(
    expect.objectContaining({
      code: expect.stringContaining(
        '"tags":{"default":"pill","remarks":"Used by the design system controls."}',
      ),
      map: null,
    }),
  );
  expect(result).toEqual(
    expect.objectContaining({
      code: expect.stringContaining('"filePath":'),
      map: null,
    }),
  );
});

it("throws for an invalid explicit tsconfig path", async () => {
  const plugin = createPlugin({
    tsconfigPath: resolve(__dirname, "missing-tsconfig.json"),
  });

  // @ts-expect-error
  await expect(plugin.configResolved?.()).rejects.toThrow(
    /Failed to read tsconfig/,
  );
});

it("uses the exported identifier for default exports", async () => {
  const plugin = createPlugin({
    tsconfigPath: tsconfigPathForTest,
  });

  // @ts-expect-error
  await plugin.configResolved?.();
  const result =
    // @ts-expect-error
    await plugin.transform?.call(
      {},
      defaultExportFixture?.code,
      defaultExportFixture?.id,
    );

  expect(result).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("DefaultExportComponent.__docgenInfo"),
      map: null,
    }),
  );
  expect((result as { code: string }).code).not.toContain(
    "DefaultExport.__docgenInfo",
  );
});

it("preserves custom displayName metadata while targeting the exported identifier", async () => {
  const plugin = createPlugin({
    tsconfigPath: tsconfigPathForTest,
  });

  // @ts-expect-error
  await plugin.configResolved?.();
  const result =
    // @ts-expect-error
    await plugin.transform?.call(
      {},
      defaultExportWithDisplayNameFixture?.code,
      defaultExportWithDisplayNameFixture?.id,
    );

  expect(result).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("DefaultExportComponent.__docgenInfo"),
      map: null,
    }),
  );
  expect((result as { code: string }).code).toContain(
    '"displayName":"DefaultExportComponentWithDisplayName"',
  );
});

it("uses the local identifier for forwardRef default exports", async () => {
  const plugin = createPlugin({
    tsconfigPath: tsconfigPathForTest,
  });

  // @ts-expect-error
  await plugin.configResolved?.();
  const result =
    // @ts-expect-error
    await plugin.transform?.call(
      {},
      forwardRefDefaultExportFixture?.code,
      forwardRefDefaultExportFixture?.id,
    );

  expect(result).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("Button.__docgenInfo"),
      map: null,
    }),
  );
  expect((result as { code: string }).code).not.toContain(
    "ForwardRefDefaultExport.__docgenInfo",
  );
});

it("stores cached transforms in the default file-system cache directory", async () => {
  const project = createTemporaryFixtureProject();
  const plugin = createPlugin({
    compilerOptions: {
      jsx: 2,
    },
    fileSystemCache: true,
  });

  // @ts-expect-error
  await plugin.configResolved?.({ root: project.root });
  const result =
    // @ts-expect-error
    await plugin.transform?.call(
      {},
      simpleFixture?.code,
      project.componentPath,
    );

  expect(result).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("__docgenInfo"),
      map: null,
    }),
  );
  expect(existsSync(project.defaultCacheDirectory)).toBe(true);
  expect(readdirSync(project.defaultCacheDirectory).length).toBeGreaterThan(0);
});

it("does not write a file-system cache when disabled", async () => {
  const project = createTemporaryFixtureProject();
  const plugin = createPlugin({
    compilerOptions: {
      jsx: 2,
    },
    fileSystemCache: {
      directory: project.cacheDirectory,
      enabled: false,
    },
  });

  // @ts-expect-error
  await plugin.configResolved?.({ root: project.root });
  const result =
    // @ts-expect-error
    await plugin.transform?.call(
      {},
      simpleFixture?.code,
      project.componentPath,
    );

  expect(result).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("__docgenInfo"),
      map: null,
    }),
  );
  expect(existsSync(project.cacheDirectory)).toBe(false);
});

it("reuses the file-system cache across plugin instances", async () => {
  const project = createTemporaryFixtureProject();
  const pluginConfig = {
    compilerOptions: {
      jsx: 2,
    },
    fileSystemCache: {
      directory: project.cacheDirectory,
      enabled: true,
    },
  } as const;

  const plugin = createPlugin(pluginConfig);

  // @ts-expect-error
  await plugin.configResolved?.({ root: project.root });

  const initialTransformResult =
    // @ts-expect-error
    await plugin.transform?.call(
      {},
      simpleFixture?.code,
      project.componentPath,
    );

  expect(initialTransformResult).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("__docgenInfo"),
      map: null,
    }),
  );
  expect(existsSync(project.cacheDirectory)).toBe(true);

  rmSync(project.componentPath);

  const pluginWithWarmCache = createPlugin(pluginConfig);

  // @ts-expect-error
  await pluginWithWarmCache.configResolved?.({ root: project.root });

  expect(
    // @ts-expect-error
    await pluginWithWarmCache.transform?.call(
      {},
      simpleFixture?.code,
      project.componentPath,
    ),
  ).toEqual(initialTransformResult);
});

it("clears the persistent cache when a non-root TypeScript dependency changes", async () => {
  const project = createTemporaryTypeDependencyProject();
  const plugin = createPlugin({
    fileSystemCache: {
      directory: project.cacheDirectory,
      enabled: true,
    },
    tsconfigPath: project.tsconfigPath,
  });

  // @ts-expect-error
  await plugin.configResolved?.({ root: project.root });
  const result =
    // @ts-expect-error
    await plugin.transform?.call(
      {},
      project.componentCode,
      project.componentPath,
    );

  expect(result === null || typeof result === "object").toBe(true);
  expect(existsSync(project.cacheDirectory)).toBe(true);
  expect(readdirSync(project.cacheDirectory).length).toBeGreaterThan(0);

  // @ts-expect-error
  await plugin.handleHotUpdate?.({
    file: project.typeDependencyPath,
    modules: [],
    server: {
      moduleGraph: {
        getModulesByFile: () => undefined,
        invalidateModule: () => undefined,
      },
    },
  });

  expect(
    !existsSync(project.cacheDirectory) ||
      readdirSync(project.cacheDirectory, { recursive: true }).every(
        (entry) => typeof entry === "string" && !entry.endsWith(".json"),
      ),
  ).toBe(true);
});

it("invalidates only transformed modules that depend on the changed TypeScript file", async () => {
  const project = createTemporaryTypeDependencyProject();
  const plugin = createPlugin({
    tsconfigPath: project.tsconfigPath,
  });
  const invalidateModule = vi.fn();
  const transformedDependentModule = {
    id: project.componentPath,
    url: project.componentPath,
  };
  const transformedIndependentModule = {
    id: project.independentComponentPath,
    url: project.independentComponentPath,
  };

  // @ts-expect-error
  await plugin.configResolved?.({ root: project.root });
  expect(
    // @ts-expect-error
    await plugin.transform?.call(
      { warn: vi.fn() },
      project.componentCode,
      project.componentPath,
    ),
  ).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("__docgenInfo"),
      map: null,
    }),
  );
  expect(
    // @ts-expect-error
    await plugin.transform?.call(
      { warn: vi.fn() },
      project.independentComponentCode,
      project.independentComponentPath,
    ),
  ).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("__docgenInfo"),
      map: null,
    }),
  );

  writeFileSync(
    project.typeDependencyPath,
    `export interface TypeDependencyProps {
  /** Button color. */
  color: "red" | "green";
}
`,
  );

  // @ts-expect-error
  await plugin.handleHotUpdate?.({
    file: project.typeDependencyPath,
    modules: [],
    server: {
      moduleGraph: {
        getModulesByFile: (file: string) =>
          file === project.componentPath
            ? new Set([transformedDependentModule])
            : file === project.independentComponentPath
              ? new Set([transformedIndependentModule])
              : undefined,
        invalidateModule,
      },
    },
  });

  expect(invalidateModule).toHaveBeenCalledTimes(1);
  expect(invalidateModule).toHaveBeenCalledWith(
    transformedDependentModule,
    undefined,
    expect.any(Number),
    true,
  );
});

it("re-resolves the TypeScript project after tsconfig changes", async () => {
  const project = createTemporaryTsconfigRefreshProject();
  const plugin = createPlugin({
    tsconfigPath: project.tsconfigPath,
  });
  const invalidateModule = vi.fn();
  const transformedModule = {
    id: project.componentPath,
    url: project.componentPath,
  };
  const pluginContext = {
    warn: vi.fn(),
  };

  // @ts-expect-error
  await plugin.configResolved?.({ root: project.root });
  const skippedResult =
    // @ts-expect-error
    await plugin.transform?.call(
      pluginContext,
      project.componentCode,
      project.componentPath,
    );

  expect(skippedResult).toBe(project.componentCode);

  writeFileSync(
    project.tsconfigPath,
    JSON.stringify(
      {
        compilerOptions: {
          esModuleInterop: true,
          jsx: "react",
          module: "CommonJS",
          target: "ES2018",
        },
        include: ["./**/*"],
      },
      null,
      2,
    ),
  );

  // @ts-expect-error
  await plugin.handleHotUpdate?.({
    file: project.tsconfigPath,
    modules: [],
    server: {
      moduleGraph: {
        getModulesByFile: (file: string) =>
          file === project.componentPath
            ? new Set([transformedModule])
            : undefined,
        invalidateModule,
      },
    },
  });

  expect(invalidateModule).toHaveBeenCalledTimes(1);

  const updatedResult =
    // @ts-expect-error
    await plugin.transform?.call(
      pluginContext,
      project.componentCode,
      project.componentPath,
    );

  expect(updatedResult).toEqual(
    expect.objectContaining({
      code: expect.stringContaining("__docgenInfo"),
      map: null,
    }),
  );
});

describe("EXPERIMENTAL_useWatchProgram", () => {
  describe("component fixture", () => {
    fixtureTests.forEach((fixture) => {
      it(`${basename(fixture.id)} has code block generated`, async () => {
        const plugin = createPlugin({
          EXPERIMENTAL_useWatchProgram: true,
          tsconfigPath: tsconfigPathForTest,
        });
        // @ts-expect-error
        await plugin.configResolved?.();
        expect(
          normalizeTransformResultForSnapshot(
            // @ts-expect-error
            await plugin.transform?.call({}, fixture.code, fixture.id),
          ),
        ).toMatchSnapshot();
      }, 15_000);
    });
  });

  it("generates value info for enums", async () => {
    const plugin = createPlugin({
      EXPERIMENTAL_useWatchProgram: true,
      tsconfigPath: tsconfigPathForTest,
      shouldExtractLiteralValuesFromEnum: true,
    });
    // @ts-expect-error
    await plugin.configResolved?.();
    expect(
      normalizeTransformResultForSnapshot(
        // @ts-expect-error
        await plugin.transform?.call(
          {},
          defaultPropValueFixture?.code,
          defaultPropValueFixture?.id,
        ),
      ),
    ).toMatchSnapshot();
  });

  it("waits for watch updates before caching transformed output", async () => {
    const project = createTemporaryWatchFixtureProject();
    const plugin = createPlugin({
      EXPERIMENTAL_useWatchProgram: true,
      tsconfigPath: project.tsconfigPath,
    });
    const invalidateModule = vi.fn();
    const transformedModule = {
      id: project.componentPath,
      url: project.componentPath,
    };
    const pluginContext = {
      warn: vi.fn(),
    };
    const initialSource = readFileSync(project.componentPath, "utf-8");
    const updatedSource = initialSource.replace(
      "A simple component.",
      "An updated simple component.",
    );

    // @ts-expect-error
    await plugin.configResolved?.({ root: project.root });
    const initialResult =
      // @ts-expect-error
      await plugin.transform?.call(
        pluginContext,
        initialSource,
        project.componentPath,
      );

    expect(initialResult).toEqual(
      expect.objectContaining({
        code: expect.stringContaining('"description":"A simple component."'),
        map: null,
      }),
    );

    await waitForWatchFileTimestampTick();
    writeFileSync(project.componentPath, updatedSource);

    // @ts-expect-error
    await plugin.handleHotUpdate?.({
      file: project.componentPath,
      modules: [],
      server: {
        moduleGraph: {
          getModulesByFile: (file: string) =>
            file === project.componentPath
              ? new Set([transformedModule])
              : undefined,
          invalidateModule,
        },
      },
    });

    const updatedResult =
      // @ts-expect-error
      await plugin.transform?.call(
        pluginContext,
        updatedSource,
        project.componentPath,
      );

    expect(invalidateModule).toHaveBeenCalledTimes(1);
    expect(updatedResult).toEqual(
      expect.objectContaining({
        code: expect.stringContaining(
          '"description":"An updated simple component."',
        ),
        map: null,
      }),
    );
    expect(
      // @ts-expect-error
      await plugin.transform?.call(
        pluginContext,
        updatedSource,
        project.componentPath,
      ),
    ).toEqual(updatedResult);
  }, 15_000);
});

describe("EXPERIMENTAL_useProjectService", () => {
  describe("component fixture", () => {
    fixtureTests.forEach((fixture) => {
      it(`${basename(fixture.id)} has code block generated`, async () => {
        const plugin = createPlugin({
          EXPERIMENTAL_useProjectService: true,
          tsconfigPath: tsconfigPathForTest,
        });
        // @ts-expect-error
        await plugin.configResolved?.();
        expect(
          normalizeTransformResultForSnapshot(
            // @ts-expect-error
            await plugin.transform?.call({}, fixture.code, fixture.id),
          ),
        ).toMatchSnapshot();
      }, 15_000);
    });
  });

  it("generates value info for enums", async () => {
    const plugin = createPlugin({
      EXPERIMENTAL_useProjectService: true,
      tsconfigPath: tsconfigPathForTest,
      shouldExtractLiteralValuesFromEnum: true,
    });
    // @ts-expect-error
    await plugin.configResolved?.();
    expect(
      normalizeTransformResultForSnapshot(
        // @ts-expect-error
        await plugin.transform?.call(
          {},
          defaultPropValueFixture?.code,
          defaultPropValueFixture?.id,
        ),
      ),
    ).toMatchSnapshot();
  });

  it("reloads open files after tracked updates without recreating the project service", async () => {
    const project = createTemporaryFixtureProject();
    const tsconfigPath = join(project.root, "tsconfig.json");
    const plugin = createPlugin({
      EXPERIMENTAL_useProjectService: true,
      tsconfigPath,
    });
    const invalidateModule = vi.fn();
    const transformedModule = {
      id: project.componentPath,
      url: project.componentPath,
    };
    const pluginContext = {
      warn: vi.fn(),
    };

    writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            esModuleInterop: true,
            jsx: "react",
            module: "CommonJS",
            target: "ES2018",
          },
          include: ["./**/*"],
        },
        null,
        2,
      ),
    );

    // @ts-expect-error
    await plugin.configResolved?.({ root: project.root });
    const initialResult =
      // @ts-expect-error
      await plugin.transform?.call(
        pluginContext,
        simpleFixture?.code,
        project.componentPath,
      );

    expect(initialResult).toEqual(
      expect.objectContaining({
        code: expect.stringContaining('"description":"A simple component."'),
        map: null,
      }),
    );

    const updatedSource = simpleFixture?.code.replace(
      "A simple component.",
      "An updated simple component.",
    );

    writeFileSync(
      project.componentPath,
      updatedSource ?? simpleFixture?.code ?? "",
    );

    // @ts-expect-error
    await plugin.handleHotUpdate?.({
      file: project.componentPath,
      modules: [],
      server: {
        moduleGraph: {
          getModulesByFile: (file: string) =>
            file === project.componentPath
              ? new Set([transformedModule])
              : undefined,
          invalidateModule,
        },
      },
    });

    expect(invalidateModule).toHaveBeenCalledTimes(1);

    const updatedResult =
      // @ts-expect-error
      await plugin.transform?.call(
        pluginContext,
        updatedSource,
        project.componentPath,
      );

    expect(updatedResult).toEqual(
      expect.objectContaining({
        code: expect.stringContaining(
          '"description":"An updated simple component."',
        ),
        map: null,
      }),
    );
  });

  it("refreshes imported type docgen when both experimental modes are enabled", async () => {
    const project = createTemporaryImportedTypeDocgenProject();
    const plugin = createPlugin({
      EXPERIMENTAL_useProjectService: true,
      EXPERIMENTAL_useWatchProgram: true,
      tsconfigPath: project.tsconfigPath,
    });
    const invalidateModule = vi.fn();
    const transformedModule = {
      id: project.componentPath,
      url: project.componentPath,
    };
    const pluginContext = {
      warn: vi.fn(),
    };

    // @ts-expect-error
    await plugin.configResolved?.({ root: project.root });
    const initialResult =
      // @ts-expect-error
      await plugin.transform?.call(
        pluginContext,
        project.componentCode,
        project.componentPath,
      );

    expect(initialResult).toEqual(
      expect.objectContaining({
        code: expect.stringContaining(
          '"description":"Imported variant description."',
        ),
        map: null,
      }),
    );

    await waitForWatchFileTimestampTick();
    writeFileSync(
      project.typeDependencyPath,
      `export interface ImportedTypeDocgenProps {
  /** Updated imported variant description. */
  variant?: "pill" | "modern";
}
`,
    );

    // @ts-expect-error
    await plugin.handleHotUpdate?.({
      file: project.typeDependencyPath,
      modules: [],
      server: {
        moduleGraph: {
          getModulesByFile: (file: string) =>
            file === project.componentPath
              ? new Set([transformedModule])
              : undefined,
          invalidateModule,
        },
      },
    });

    expect(invalidateModule).toHaveBeenCalledTimes(1);

    const updatedResult =
      // @ts-expect-error
      await plugin.transform?.call(
        pluginContext,
        project.componentCode,
        project.componentPath,
      );

    expect(updatedResult).toEqual(
      expect.objectContaining({
        code: expect.stringContaining(
          '"description":"Updated imported variant description."',
        ),
        map: null,
      }),
    );
  });
});
