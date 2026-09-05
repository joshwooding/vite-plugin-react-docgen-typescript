import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import typescript from "typescript";
import type { Plugin } from "vite";
import { describe, expect, it, vi } from "vitest";
import type { DocgenBackendFactory } from "../docgen/backend";
import { getReactDocgenParserOptions } from "../docgen/legacyBackend";
import { createPlugin } from "../plugin";
import { resolveDocgenRuntimeMode } from "../utils/options";

describe("runtime-mode resolution", () => {
  it.each([
    [{}, "default"],
    [{ docgenMode: "legacy" }, "default"],
    [{ docgenMode: "native" }, "native"],
    [{ docgenMode: "project-service" }, "projectService"],
    [{ EXPERIMENTAL_useWatchProgram: true }, "watch"],
    [{ EXPERIMENTAL_useProjectService: true }, "projectService"],
    [
      {
        EXPERIMENTAL_useProjectService: true,
        EXPERIMENTAL_useWatchProgram: true,
      },
      "projectService",
    ],
  ] as const)("resolves %j to %s", (options, expected) => {
    expect(resolveDocgenRuntimeMode(options)).toBe(expected);
  });

  it.each([
    [
      {
        docgenMode: "legacy",
        EXPERIMENTAL_useWatchProgram: true,
      },
      "EXPERIMENTAL_useWatchProgram",
    ],
    [
      {
        docgenMode: "project-service",
        EXPERIMENTAL_useProjectService: true,
      },
      "EXPERIMENTAL_useProjectService",
    ],
    [
      {
        docgenMode: "project-service",
        EXPERIMENTAL_useProjectService: false,
        EXPERIMENTAL_useWatchProgram: false,
      },
      "EXPERIMENTAL_useWatchProgram or EXPERIMENTAL_useProjectService",
    ],
  ] as const)("rejects stable/experimental conflict %j", (options, names) => {
    expect(() => resolveDocgenRuntimeMode(options)).toThrow(
      `docgenMode cannot be combined with ${names}`,
    );
  });
});

describe("public option types", () => {
  it("keeps callbacks strict and mode-specific for package consumers", () => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-public-options-"));
    const consumerPath = path.join(root, "consumer.ts");
    const indexPath = path.resolve(
      "packages/vite-plugin-react-docgen-typescript/src/index.ts",
    );
    const importPath = path
      .relative(root, indexPath)
      .replaceAll("\\", "/")
      .replace(/\.ts$/, "");
    writeFileSync(
      consumerPath,
      `import reactDocgenTypescript, { type DocgenMode } from ${JSON.stringify(importPath)};

declare const mode: DocgenMode;

reactDocgenTypescript({ docgenMode: mode });

reactDocgenTypescript({
  componentNameResolver(symbol, source) {
    return source.fileName + ":" + symbol.getName();
  },
  docgenMode: mode,
});

reactDocgenTypescript({
  componentNameResolver(symbol, source) {
    return symbol.flags && source.statements.length > 0
      ? symbol.getName()
      : undefined;
  },
});

reactDocgenTypescript({
  propFilter(prop) {
    return prop.defaultValue?.value !== "hidden";
  },
});

reactDocgenTypescript({
  componentNameResolver(symbol, source) {
    return symbol.flags && source.statements.length > 0
      ? symbol.getName()
      : undefined;
  },
  docgenMode: "legacy",
});

reactDocgenTypescript({
  componentNameResolver(symbol, source) {
    // @ts-expect-error Native mode deliberately hides compiler-specific fields.
    symbol.flags;
    return source.fileName + ":" + symbol.getName();
  },
  docgenMode: "native",
});
`,
    );

    try {
      const program = typescript.createProgram([consumerPath], {
        allowSyntheticDefaultImports: true,
        esModuleInterop: true,
        module: typescript.ModuleKind.ESNext,
        moduleResolution: typescript.ModuleResolutionKind.Bundler,
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: typescript.ScriptTarget.ES2022,
      });
      const consumer = program.getSourceFile(consumerPath);
      expect(consumer).toBeDefined();
      const diagnostics = typescript
        .getPreEmitDiagnostics(program, consumer)
        .map((diagnostic) =>
          typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        );

      expect(diagnostics).toEqual([]);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

const warningFactory: DocgenBackendFactory = {
  async create() {
    throw new Error("The warning test must not initialize the backend");
  },
  describe() {
    return { cacheFingerprint: "runtime-mode-test", id: "runtime-mode-test" };
  },
};

const runConfigResolved = async (
  plugin: Plugin,
  warn: ReturnType<typeof vi.fn>,
) => {
  const hook = plugin.configResolved;
  const config = { command: "serve", root: process.cwd() } as never;
  if (typeof hook === "function") {
    await hook.call({ warn } as never, config);
  } else {
    await hook?.handler.call({ warn } as never, config);
  }
};

describe("runtime-mode deprecation warnings", () => {
  it.each([
    [
      { EXPERIMENTAL_useWatchProgram: true },
      [
        'EXPERIMENTAL_useWatchProgram is deprecated; use docgenMode: "project-service" instead.',
      ],
    ],
    [
      { EXPERIMENTAL_useProjectService: true },
      [
        'EXPERIMENTAL_useProjectService is deprecated; use docgenMode: "project-service" instead.',
      ],
    ],
    [
      {
        EXPERIMENTAL_useProjectService: true,
        EXPERIMENTAL_useWatchProgram: true,
      },
      [
        'EXPERIMENTAL_useWatchProgram is deprecated; use docgenMode: "project-service" instead.',
        'EXPERIMENTAL_useProjectService is deprecated; use docgenMode: "project-service" instead.',
      ],
    ],
    [
      { EXPERIMENTAL_useWatchProgram: false },
      [
        'EXPERIMENTAL_useWatchProgram is deprecated; use docgenMode: "project-service" instead.',
      ],
    ],
    [{ docgenMode: "project-service" }, []],
    [{ docgenMode: "native" }, []],
    [{ docgenMode: "legacy" }, []],
  ] as const)("warns once per present deprecated field for %j", async (options, expected) => {
    const warn = vi.fn();
    const plugin = createPlugin(options, warningFactory);
    await runConfigResolved(plugin, warn);
    await runConfigResolved(plugin, warn);
    expect(warn.mock.calls.map(([message]) => message)).toEqual(expected);
  });
});

describe("parser option isolation", () => {
  it("does not forward docgenMode to react-docgen-typescript", () => {
    const parserOptions = getReactDocgenParserOptions({
      __benchmark: { bypassMemoryCache: true },
      docgenMode: "legacy",
      EXPERIMENTAL_useProjectService: false,
      EXPERIMENTAL_useWatchProgram: false,
      shouldExtractValuesFromUnion: true,
    });

    expect(parserOptions).not.toHaveProperty("docgenMode");
    expect(parserOptions).not.toHaveProperty("__benchmark");
    expect(parserOptions).not.toHaveProperty("EXPERIMENTAL_useWatchProgram");
    expect(parserOptions).not.toHaveProperty("EXPERIMENTAL_useProjectService");
    expect(parserOptions).toMatchObject({
      shouldExtractValuesFromUnion: true,
    });
  });
});
