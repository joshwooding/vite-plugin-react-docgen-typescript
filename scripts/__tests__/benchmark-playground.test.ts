import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertReactMetadata,
  measureModeIteration,
  parseArgs,
  prepareIteration,
  validateBaseline,
  warmMode,
} from "../benchmark-playground.mjs";

let workspace: any;
beforeEach(() => {
  const root = mkdtempSync(path.join(tmpdir(), "benchmark-harness-"));
  const files = ["Button.tsx", "Consumer.tsx"].map((file) =>
    path.join(root, file),
  );
  for (const file of files) writeFileSync(file, "original marker");
  workspace = {
    root,
    files,
    changedFile: files[0],
    fileCount: files.length,
    temporaryRoot: root,
    cacheDirectory: path.join(root, "persistent-cache"),
    markerText: "original marker",
    updatedMarkerText: "updated marker",
    tsconfigPath: path.join(root, "tsconfig.json"),
  };
  vi.spyOn(process, "chdir").mockImplementation(() => {});
});

describe("cache lifecycle and accounting", () => {
  it.each([
    "off",
    "populate",
    "restart",
  ])("keeps %s instance counts, paths, and teardown order explicit", async (cache) => {
    const events: string[] = [];
    const configs: any[] = [];
    const factory = (config: any) => {
      const instance = configs.length;
      configs.push(config);
      events.push(`create ${instance}`);
      if (instance === 0)
        expect(existsSync(workspace.cacheDirectory)).toBe(false);
      return fakePlugin({
        closeBundle: async () => {
          await Promise.resolve();
          if (config.fileSystemCache) {
            mkdirSync(config.fileSystemCache.directory, { recursive: true });
            writeFileSync(
              path.join(config.fileSystemCache.directory, "entry.json"),
              "{}",
            );
          }
          events.push(`close ${instance}`);
        },
      });
    };
    const seed = vi.fn(async (sameWorkspace, mode) => {
      expect(sameWorkspace).toBe(workspace);
      await warmMode(factory, mode, sameWorkspace, "populate");
      return { processId: 1234 };
    });
    mkdirSync(workspace.cacheDirectory);
    writeFileSync(path.join(workspace.cacheDirectory, "old.json"), "{}");
    const lifecycle = await prepareIteration(workspace, "default", cache, seed);
    const result = await measureModeIteration(factory, "default", workspace, {
      cache,
      processFirstMeasuredInstance: false,
    });
    expect(configs).toHaveLength(cache === "restart" ? 2 : 1);
    expect(events).toEqual(
      cache === "restart"
        ? ["create 0", "close 0", "create 1", "close 1"]
        : ["create 0", "close 0"],
    );
    expect(seed).toHaveBeenCalledTimes(cache === "restart" ? 1 : 0);
    expect(lifecycle.initialEntryCount).toBe(cache === "restart" ? 1 : 0);
    expect(result).toMatchObject({
      cache,
      mode: "default",
      processFirstMeasuredInstance: false,
    });
    expect(configs[0].fileSystemCache).toEqual(
      cache === "off" ? false : { directory: workspace.cacheDirectory },
    );
    if (cache === "restart") {
      const { __benchmark, ...measuredConfig } = configs[1];
      expect(configs[0]).toEqual(measuredConfig);
      expect(__benchmark).toMatchObject({ bypassMemoryCache: false });
    }
    await prepareIteration(workspace, "default", "off", seed);
    expect(existsSync(workspace.cacheDirectory)).toBe(false);
  });

  it("rejects a seed that did not persist any entries", async () => {
    await expect(
      prepareIteration(workspace, "default", "restart", async () => ({
        processId: 1234,
      })),
    ).rejects.toThrow("no persistent cache entries");
  });

  it("does not measure after failed seed teardown", async () => {
    const factory = vi.fn(() =>
      fakePlugin({
        closeBundle: async () => {
          throw new Error("seed close failed");
        },
      }),
    );
    await expect(
      prepareIteration(workspace, "default", "restart", async () => {
        await warmMode(factory, "default", workspace, "populate");
        return { processId: 1234 };
      }),
    ).rejects.toThrow("seed close failed");
    expect(factory).toHaveBeenCalledOnce();
  });

  it("includes configuration construction and awaited close in the full session", async () => {
    let time = 0;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    const factory = () => {
      time += 7;
      return fakePlugin({
        configResolved: async () => {
          time += 5;
        },
        transform: async (source: string) => {
          time += 2;
          return `Component.__docgenInfo = ${JSON.stringify({ description: source })}`;
        },
        handleHotUpdate: async () => {
          time += 3;
        },
        closeBundle: async () => {
          await Promise.resolve();
          time += 50;
        },
      });
    };
    const result = await measureModeIteration(factory, "default", workspace);
    expect(result).toMatchObject({
      configResolvedMs: 5,
      firstBatchMs: 4,
      coldBatchMs: 9,
      warmBatchMs: 4,
      memoryCacheBatchMs: 4,
      reanalysisBatchMs: 4,
      componentHmr: { totalCycleMs: 5 },
      sessionTotalMs: 79,
    });
  });

  it("keeps legacy CLI defaults and rejects unknown cache states and old baselines", () => {
    expect(parseArgs([])).toMatchObject({
      cache: "off",
      scenario: "playground",
    });
    expect(
      parseArgs(["--modes", "default,projectService", "--cache", "restart"])
        .modes,
    ).toEqual(["default", "projectService"]);
    expect(() => parseArgs(["--cache", "warm"])).toThrow(
      "Unsupported cache state",
    );
    expect(() => validateBaseline({ results: [] }, parseArgs([]))).toThrow(
      "baseline schema",
    );
    expect(() =>
      validateBaseline(
        {
          schemaVersion: 3,
          benchmarkKind: "direct-plugin",
          cache: "restart",
          scenario: { name: "playground", scale: 1 },
        },
        parseArgs([]),
      ),
    ).toThrow("cache state");
  });

  it("rejects baseline comparisons with different process-warmth profiles or parser options", () => {
    const options = parseArgs(["--modes", "default,projectService"]);
    const baseline = {
      schemaVersion: 3,
      benchmarkKind: "direct-plugin",
      cache: "off",
      scenario: { name: "playground", scale: 1 },
      modes: options.modes,
      iterations: options.iterations,
      parserOptions: { parser: { propFilter: "plugin-default" } },
    };
    expect(() => validateBaseline(baseline, options)).not.toThrow();
    expect(() =>
      validateBaseline({ ...baseline, schemaVersion: 2 }, options),
    ).toThrow("baseline schema");
    expect(() =>
      validateBaseline({ ...baseline, nativeTiming: true }, options),
    ).toThrow("native timing");
    expect(() =>
      validateBaseline(
        { ...baseline, modes: ["projectService", "default"] },
        options,
      ),
    ).toThrow("mode order or iteration count");
    expect(() =>
      validateBaseline({ ...baseline, iterations: 1 }, options),
    ).toThrow("mode order or iteration count");
    expect(() =>
      validateBaseline({ ...baseline, parserOptions: {} }, options),
    ).toThrow("parser options");
  });

  it.each([
    "off",
    "populate",
  ])("completes React validation outside the %s measured instance", async (cache) => {
    workspace.scenario = "react-typing";
    const seed = vi.fn(async (_workspace, _mode, action) => {
      expect(action).toBe("validate");
      await Promise.resolve();
      return { processId: 5678, fixtureValidation: { compilerDiagnostics: 0 } };
    });
    const lifecycle = await prepareIteration(workspace, "default", cache, seed);
    expect(lifecycle).toMatchObject({
      initialEntryCount: 0,
      seedProcessId: null,
      validation: { processId: 5678 },
    });
    expect(existsSync(workspace.cacheDirectory)).toBe(false);
  });
});

describe("React fixture metadata validity", () => {
  function metadata(overrides: any = {}) {
    return `Button.__docgenInfo = ${JSON.stringify({
      props: {
        disabled: {
          type: { name: "boolean" },
          declarations: [{ fileName: "/node_modules/@types/react/index.d.ts" }],
        },
        intent: {
          type: { value: [{ value: '"primary"' }, { value: '"quiet"' }] },
          declarations: [{ fileName: "/fixture/src/shared.ts" }],
        },
        ...overrides,
      },
    })};`;
  }

  it("requires real inherited boolean and imported union metadata for every component", () => {
    workspace.scenario = "react-typing";
    expect(() =>
      assertReactMetadata(
        new Map([[workspace.files[0], metadata()]]),
        workspace,
      ),
    ).not.toThrow();
    expect(() =>
      assertReactMetadata(
        new Map([
          [workspace.files[0], metadata()],
          [workspace.files[1], metadata({ disabled: undefined })],
        ]),
        workspace,
      ),
    ).toThrow("inherited boolean disabled");
    expect(() =>
      assertReactMetadata(
        new Map([
          [workspace.files[0], metadata({ intent: { type: { name: "any" } } })],
        ]),
        workspace,
      ),
    ).toThrow("imported intent union");
    expect(() =>
      assertReactMetadata(
        new Map([
          [
            workspace.files[0],
            metadata({
              disabled: {
                type: { name: "boolean" },
                declarations: [{ fileName: "/fixture/shim.d.ts" }],
              },
            }),
          ],
        ]),
        workspace,
      ),
    ).toThrow("real React declarations");
    expect(() => assertReactMetadata(new Map(), workspace)).toThrow(
      "no component metadata",
    );
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  const resolved = path.resolve(workspace.root);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir()) ||
    !path.basename(resolved).startsWith("benchmark-harness-")
  ) {
    throw new Error("Unsafe harness cleanup path");
  }
  rmSync(resolved, { recursive: true, force: true });
});

function fakePlugin(overrides: any = {}) {
  return {
    transform: vi.fn(
      async (source: string) =>
        `Component.__docgenInfo = ${JSON.stringify({ description: source })}`,
    ),
    closeBundle: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("direct plugin benchmark lifecycle", () => {
  it("transforms alias workspace files when HMR returns physical file paths", async () => {
    const physicalRoot = path.join(workspace.root, "physical");
    const aliasRoot = path.join(workspace.root, "alias");
    mkdirSync(physicalRoot);
    for (const file of workspace.files) {
      writeFileSync(
        path.join(physicalRoot, path.basename(file)),
        "original marker",
      );
    }
    symlinkSync(
      physicalRoot,
      aliasRoot,
      process.platform === "win32" ? "junction" : "dir",
    );
    workspace.files = workspace.files.map((file: string) =>
      path.join(aliasRoot, path.basename(file)),
    );
    workspace.changedFile = workspace.files[0];
    const plugin = fakePlugin({
      handleHotUpdate: () => [
        ...workspace.files.map((file: string) => ({
          file: realpathSync(file),
        })),
        { id: "\u0000virtual:benchmark" },
        { file: path.join(aliasRoot, "missing.tsx") },
      ],
    });
    const result = await measureModeIteration(
      () => plugin,
      "default",
      workspace,
    );
    expect(
      plugin.transform.mock.calls.slice(6).map((call: any[]) => call[1]),
    ).toEqual(workspace.files);
    expect(result.componentHmr).toMatchObject({
      affectedModuleCount: 2,
      status: "updated",
    });
  });

  it("transforms both returned affected modules without explicit invalidation", async () => {
    const plugin = fakePlugin({
      handleHotUpdate: () =>
        workspace.files.map((file: string) => ({ file, id: file })),
    });
    const result = await measureModeIteration(
      () => plugin,
      "default",
      workspace,
    );
    expect(
      plugin.transform.mock.calls.slice(6).map((call: any[]) => call[1]),
    ).toEqual(workspace.files);
    expect(result.componentHmr.affectedModuleCount).toBe(2);
    expect(result.componentHmr.invalidatedModuleCount).toBe(0);
  });

  it("combines explicit invalidations with returned modules and deduplicates file identity", async () => {
    const plugin = fakePlugin({
      handleHotUpdate: ({ server }: any) => {
        server.moduleGraph.invalidateModule({
          file: workspace.files[1],
          id: `${workspace.files[1]}?v=1`,
        });
        return workspace.files.map((file: string) => ({
          file,
          id: `${file}?v=2`,
        }));
      },
    });
    const result = await measureModeIteration(
      () => plugin,
      "default",
      workspace,
    );
    expect(
      plugin.transform.mock.calls.slice(6).map((call: any[]) => call[1]),
    ).toEqual(workspace.files);
    expect(result.componentHmr.affectedModuleCount).toBe(2);
    expect(result.componentHmr.invalidatedModuleCount).toBe(1);
  });

  it("uses incoming modules when the hook returns undefined", async () => {
    const plugin = fakePlugin({ handleHotUpdate: () => undefined });
    const result = await measureModeIteration(
      () => plugin,
      "default",
      workspace,
    );
    expect(result.componentHmr.affectedModuleCount).toBe(1);
    expect(
      plugin.transform.mock.calls.slice(6).map((call: any[]) => call[1]),
    ).toEqual([workspace.changedFile]);
  });

  it("preserves an explicitly empty affected list and rejects missing fresh metadata", async () => {
    const plugin = fakePlugin({ handleHotUpdate: () => [] });
    await expect(
      measureModeIteration(() => plugin, "default", workspace),
    ).rejects.toThrow(/stale/i);
    expect(plugin.transform).toHaveBeenCalledTimes(6);
  });

  it("rejects stale metadata and still restores the fixture after closing", async () => {
    const plugin = fakePlugin({
      transform: async () =>
        'Component.__docgenInfo = {"description":"original marker"}',
    });
    await expect(
      measureModeIteration(() => plugin, "default", workspace),
    ).rejects.toThrow(/stale/i);
    expect(plugin.closeBundle).toHaveBeenCalledOnce();
    expect(readFileSync(workspace.changedFile, "utf8")).toBe("original marker");
  });

  it("awaits measurement teardown before restoring the fixture or resolving", async () => {
    let finishClose!: () => void;
    let startedClose!: () => void;
    const closing = new Promise<void>((resolve) => {
      startedClose = resolve;
    });
    const plugin = fakePlugin({
      closeBundle: () => {
        startedClose();
        return new Promise<void>((resolve) => {
          finishClose = resolve;
        });
      },
    });
    let resolved = false;
    const measurement = measureModeIteration(
      () => plugin,
      "default",
      workspace,
    ).then(() => {
      resolved = true;
    });
    await closing;
    expect(readFileSync(workspace.changedFile, "utf8")).toBe("updated marker");
    expect(resolved).toBe(false);
    finishClose();
    await measurement;
    expect(readFileSync(workspace.changedFile, "utf8")).toBe("original marker");
  });

  it("awaits warmup teardown", async () => {
    let closed = false;
    const plugin = fakePlugin({
      closeBundle: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        closed = true;
      },
    });
    await warmMode(() => plugin, "default", workspace);
    expect(closed).toBe(true);
  });

  it("propagates teardown failures after restoring the fixture", async () => {
    const plugin = fakePlugin({
      closeBundle: async () => {
        throw new Error("teardown failed");
      },
    });
    await expect(
      measureModeIteration(() => plugin, "default", workspace),
    ).rejects.toThrow("teardown failed");
    expect(readFileSync(workspace.changedFile, "utf8")).toBe("original marker");
  });
});
