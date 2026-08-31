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
      docgenMode: "legacy",
      EXPERIMENTAL_useProjectService: false,
      EXPERIMENTAL_useWatchProgram: false,
      shouldExtractValuesFromUnion: true,
    });

    expect(parserOptions).not.toHaveProperty("docgenMode");
    expect(parserOptions).not.toHaveProperty("EXPERIMENTAL_useWatchProgram");
    expect(parserOptions).not.toHaveProperty("EXPERIMENTAL_useProjectService");
    expect(parserOptions).toMatchObject({
      shouldExtractValuesFromUnion: true,
    });
  });
});
