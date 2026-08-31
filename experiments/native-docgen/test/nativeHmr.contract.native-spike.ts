import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  EnvironmentModuleNode,
  FSWatcher,
  HotPayload,
  ModuleNode,
  Plugin,
  ViteDevServer,
} from "vite";
import { createServer, normalizePath } from "vite";
import { describe, expect, test } from "vitest";
import {
  CONTRACT_TOPOLOGIES,
  runImportedTypeHmrContract,
} from "../../../packages/vite-plugin-react-docgen-typescript/src/__tests__/support/importedTypeHmrContract.ts";
import type {
  BackendFileSelection,
  BackendProjectState,
  DocgenBackend,
  DocgenBackendFactory,
  FileUpdateResult,
  UpdateCompletion,
} from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts";
import type { DocgenComponent } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/types.ts";
import { createPlugin } from "../../../packages/vite-plugin-react-docgen-typescript/src/plugin.ts";
import {
  createNativeBackendFactory,
  NativeDocgenBackend,
} from "../src/nativeBackend.ts";

type FakeLifecycle = "immediate" | "pending";

const walk = (root: string): string[] => {
  const values: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else values.push(path.resolve(target));
    }
  }
  return values;
};

const fakeComponent = ({
  description,
  displayName,
  fileName,
  propName,
  values,
}: {
  description: string;
  displayName: string;
  fileName: string;
  propName: string;
  values: readonly string[];
}): DocgenComponent => ({
  description: "",
  displayName,
  filePath: path.resolve(fileName),
  methods: [],
  props: {
    [propName]: {
      defaultValue: null,
      description,
      name: propName,
      required: true,
      tags: {},
      type: {
        name: "enum",
        raw: values.map((value) => `"${value}"`).join(" | "),
        value: values.map((value) => ({ value: `"${value}"` })),
      },
    },
  },
  tags: {},
  targetExpression: displayName,
});

class FreshFakeBackend implements DocgenBackend {
  private description = "Initial imported tone.";
  private disposed = false;
  private generation = 0;
  private latestRevision = 0;
  private readonly lifecycle: FakeLifecycle;
  private readonly rootDir: string;
  private readonly selection: BackendFileSelection;
  private readonly trace: string[];
  private values = ["base", "quiet"];

  constructor(
    rootDir: string,
    selection: BackendFileSelection,
    lifecycle: FakeLifecycle,
    trace: string[] = [],
  ) {
    this.rootDir = rootDir;
    this.selection = selection;
    this.lifecycle = lifecycle;
    this.trace = trace;
  }

  private project(): BackendProjectState {
    const commonRoot = path.dirname(this.rootDir);
    const files = walk(commonRoot);
    const trackedFiles = files
      .filter((fileName) => /\.[cm]?[jt]sx?$/.test(fileName))
      .sort();
    return {
      configFiles: files
        .filter((fileName) => path.basename(fileName) === "tsconfig.json")
        .sort(),
      docgenFiles: trackedFiles.filter((fileName) =>
        this.selection.matchesDocgenFile(fileName),
      ),
      generation: this.generation,
      trackedFiles,
    };
  }

  async initialize(): Promise<BackendProjectState> {
    return this.project();
  }

  private apply(
    fileName: string,
    source: string | undefined,
    revision: number,
  ): void {
    if (
      path.basename(fileName) !== "props.ts" ||
      !source?.includes("export interface ImportedProps")
    ) {
      return;
    }
    const description = source.match(/\/\*\*\s*([^*]+?)\s*\*\//)?.[1]?.trim();
    const union = source.match(/tone:\s*([^;]+);/)?.[1];
    if (description) this.description = description;
    if (union) {
      this.values = [...union.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    }
    this.generation = revision;
  }

  async analyze({
    fileName,
    revision,
    source,
  }: Parameters<DocgenBackend["analyze"]>[0]) {
    this.trace.push(`analyze:${path.basename(fileName)}:${revision}`);
    const dependent = source.includes("DependentComponent");
    const unrelated = source.includes("UnrelatedComponent");
    const components = dependent
      ? [
          fakeComponent({
            description: this.description,
            displayName: "DependentComponent",
            fileName,
            propName: "tone",
            values: this.values,
          }),
        ]
      : unrelated
        ? [
            fakeComponent({
              description: "Unrelated value.",
              displayName: "UnrelatedComponent",
              fileName,
              propName: "value",
              values: ["unchanged"],
            }),
          ]
        : [];
    return {
      components,
      dependencies: dependent
        ? [
            path.resolve(fileName),
            path.join(path.dirname(fileName), "props.ts"),
          ].sort()
        : [path.resolve(fileName)],
      project: this.project(),
      revision,
      status: "ok" as const,
    };
  }

  async update({
    affectedComponentFiles,
    change,
  }: Parameters<DocgenBackend["update"]>[0]): Promise<FileUpdateResult> {
    this.trace.push(
      `update:${path.basename(change.fileName)}:${change.revision}:${affectedComponentFiles.length}`,
    );
    this.latestRevision = Math.max(this.latestRevision, change.revision);
    if (this.lifecycle === "immediate") {
      this.apply(
        change.fileName,
        change.kind === "delete" ? undefined : change.source,
        change.revision,
      );
      return {
        project: this.project(),
        revision: change.revision,
        status: "ready",
      };
    }

    const ready = new Promise<UpdateCompletion>((resolve) => {
      setTimeout(() => {
        if (this.disposed) {
          resolve({ revision: change.revision, status: "disposed" });
        } else if (change.revision < this.latestRevision) {
          resolve({
            revision: change.revision,
            status: "superseded",
            supersededBy: this.latestRevision,
          });
        } else {
          this.apply(
            change.fileName,
            change.kind === "delete" ? undefined : change.source,
            change.revision,
          );
          resolve({
            project: this.project(),
            revision: change.revision,
            status: "ready",
          });
        }
      }, 5);
    });
    return { ready, revision: change.revision, status: "pending" };
  }

  recordCacheHit(): void {}

  async reset({ revision }: { revision: number }) {
    return this.disposed
      ? ({ revision, status: "disposed" } as const)
      : ({ revision, status: "reset" } as const);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

const createFreshFactory = (
  lifecycle: FakeLifecycle,
  trace: string[] = [],
): DocgenBackendFactory => ({
  create: async ({ rootDir, selection }) =>
    new FreshFakeBackend(rootDir, selection, lifecycle, trace),
  describe: ({ rootDir }) => ({
    cacheFingerprint: `fresh-fake:${lifecycle}:${path.resolve(rootDir)}`,
    id: `fresh-fake-${lifecycle}`,
  }),
});

describe.each([
  "immediate",
  "pending",
] as const)("host preflight %s lifecycle", (lifecycle) => {
  test.each(CONTRACT_TOPOLOGIES)("host preflight: %s", async (topology) => {
    const trace: string[] = [];
    const observation = await runImportedTypeHmrContract({
      label: `fresh-fake-${lifecycle}`,
      options: { shouldExtractValuesFromUnion: true },
      pluginFactory: (options) =>
        createPlugin(options, createFreshFactory(lifecycle, trace)),
      rowKey: `fresh-fake:${lifecycle}:${topology}`,
      topology,
    });
    expect(observation.infrastructureErrors).toEqual([]);
    expect(observation.allHardControlsPass).toBe(true);
    expect(trace, JSON.stringify(observation.edits, undefined, 2)).toEqual([
      "analyze:Dependent.tsx:0",
      "analyze:Unrelated.tsx:0",
      "update:props.ts:1:1",
      "analyze:Dependent.tsx:1",
      "update:props.ts:2:1",
      "analyze:Dependent.tsx:2",
      "update:Dependent.tsx:3:1",
      "analyze:Dependent.tsx:3",
    ]);
    expect(
      observation.semanticFailures,
      JSON.stringify(observation.edits, undefined, 2),
    ).toEqual([]);
  });
});

describe("host preflight pending overlap and disposal", () => {
  test("older work is superseded and disposal has no ready completion", async () => {
    const commonRoot = mkdtempSync(path.join(tmpdir(), "vprdts-preflight-"));
    const rootDir = path.join(commonRoot, "app");
    mkdirSync(rootDir, { recursive: true });
    const backend = new FreshFakeBackend(
      rootDir,
      {
        exclude: [],
        hasIncludes: true,
        include: ["**/*.tsx"],
        matchesDocgenFile: () => true,
      },
      "pending",
    );
    try {
      const first = await backend.update({
        affectedComponentFiles: ["one.tsx"],
        change: {
          fileName: "props.ts",
          kind: "change",
          revision: 1,
          source: "",
        },
      });
      const second = await backend.update({
        affectedComponentFiles: ["two.tsx"],
        change: {
          fileName: "props.ts",
          kind: "change",
          revision: 2,
          source: "",
        },
      });
      if (first.status !== "pending" || second.status !== "pending") {
        throw new Error("pending preflight expected");
      }
      await expect(first.ready).resolves.toMatchObject({
        status: "superseded",
        supersededBy: 2,
      });
      await expect(second.ready).resolves.toMatchObject({ status: "ready" });
      const third = await backend.update({
        affectedComponentFiles: ["three.tsx"],
        change: {
          fileName: "props.ts",
          kind: "change",
          revision: 3,
          source: "",
        },
      });
      if (third.status !== "pending") {
        throw new Error("pending preflight expected");
      }
      await backend.dispose();
      await expect(third.ready).resolves.toMatchObject({ status: "disposed" });
    } finally {
      await backend.dispose();
      rmSync(commonRoot, { force: true, recursive: true });
    }
  });
});

interface ExtendedHmrFixture {
  ambient: string;
  commonRoot: string;
  components: [string, string];
  linkedPackage: string;
  props: string;
  root: string;
  unrelated: string;
}

interface ExtendedHmrCycle {
  hooksCompleted: boolean;
  invalidated: EnvironmentModuleNode[];
  listenerThenables: Promise<unknown>[];
  payloads: HotPayload[];
  returned: ModuleNode[];
}

type ChangeListener = (this: FSWatcher, ...args: unknown[]) => unknown;
type RawChangeListener = ChangeListener & { listener?: ChangeListener };

const createExtendedHmrFixture = (): ExtendedHmrFixture => {
  const commonRoot = mkdtempSync(path.join(tmpdir(), "vprdts-native-hmr-"));
  const root = path.join(commonRoot, "app");
  const sourceRoot = path.join(root, "src");
  const sharedRoot = path.join(commonRoot, "shared");
  const packageRoot = path.join(commonRoot, "packages", "tokens");
  const packageLink = path.join(root, "node_modules", "@fixture", "tokens");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(sharedRoot, { recursive: true });
  mkdirSync(packageRoot, { recursive: true });
  mkdirSync(path.dirname(packageLink), { recursive: true });

  const ambient = path.join(sharedRoot, "ambient.d.ts");
  const props = path.join(sharedRoot, "props.ts");
  const linkedPackage = path.join(packageRoot, "index.ts");
  const components = [
    path.join(sourceRoot, "DependentA.tsx"),
    path.join(sourceRoot, "DependentB.tsx"),
  ] as const;
  const unrelated = path.join(sourceRoot, "Unrelated.tsx");

  writeFileSync(ambient, 'type AmbientTone = "ambient";\n');
  writeFileSync(linkedPackage, 'export type LinkedTone = "linked";\n');
  writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({
      exports: { ".": { types: "./index.ts" } },
      name: "@fixture/tokens",
      private: true,
      type: "module",
      types: "./index.ts",
    }),
  );
  symlinkSync(packageRoot, packageLink, "junction");
  writeFileSync(
    props,
    `/// <reference path="./ambient.d.ts" />
import type { LinkedTone } from "@fixture/tokens";

export interface SharedProps {
  /** Initial shared tone. */
  tone: AmbientTone;
  /** Initial linked tone. */
  linked: LinkedTone;
}
`,
  );
  for (const [index, component] of components.entries()) {
    writeFileSync(
      component,
      `declare namespace JSX { interface Element {} }
import type { SharedProps } from "@shared/props";
export const Dependent${index === 0 ? "A" : "B"} = ({ tone: _tone }: SharedProps): JSX.Element => null as unknown as JSX.Element;
if (import.meta.hot) import.meta.hot.accept();
`,
    );
  }
  writeFileSync(
    unrelated,
    `declare namespace JSX { interface Element {} }
export interface UnrelatedProps { value: "unchanged" }
export const Unrelated = ({ value: _value }: UnrelatedProps): JSX.Element => null as unknown as JSX.Element;
if (import.meta.hot) import.meta.hot.accept();
`,
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: {
          "@fixture/tokens": ["node_modules/@fixture/tokens/index.ts"],
          "@shared/*": ["../shared/*"],
        },
        preserveSymlinks: false,
        skipLibCheck: true,
        target: "ES2020",
      },
      files: [
        "src/DependentA.tsx",
        "src/DependentB.tsx",
        "src/Unrelated.tsx",
        "../shared/props.ts",
        "../shared/ambient.d.ts",
      ],
    }),
  );

  return {
    ambient,
    commonRoot,
    components: [components[0], components[1]],
    linkedPackage,
    props,
    root,
    unrelated,
  };
};

const installCompletionProbe = (
  watcher: FSWatcher,
  getActiveCycle: () => ExtendedHmrCycle | undefined,
): void => {
  const rawListeners = watcher.rawListeners("change") as RawChangeListener[];
  for (const rawListener of rawListeners) {
    watcher.removeListener("change", rawListener);
  }
  for (const rawListener of rawListeners) {
    const listener = rawListener.listener ?? rawListener;
    const wrapped: ChangeListener = function (...args) {
      const result = Reflect.apply(listener, this, args);
      if (
        getActiveCycle() &&
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        "then" in result &&
        typeof result.then === "function"
      ) {
        getActiveCycle()?.listenerThenables.push(Promise.resolve(result));
      }
      return result;
    };
    if (rawListener.listener) watcher.once("change", wrapped);
    else watcher.on("change", wrapped);
  }
};

const docgenMetadata = (code: string | undefined, propName = "tone") => {
  const encoded = code?.match(/__docgenInfo\s*=\s*(\{[\s\S]*?\});/)?.[1];
  if (!encoded) return undefined;
  const info = JSON.parse(encoded) as {
    props?: Record<
      string,
      {
        description?: string;
        type?: {
          name?: string;
          raw?: string;
          value?: Array<{ value?: string }>;
        };
      }
    >;
  };
  return {
    description: info.props?.[propName]?.description,
    name: info.props?.[propName]?.type?.name,
    raw: info.props?.[propName]?.type?.raw,
    values:
      info.props?.[propName]?.type?.value
        ?.map(({ value }) => value)
        .filter(Boolean) ?? [],
  };
};

const touchFile = (fileName: string, source: string): void => {
  const previousMtime = statSync(fileName).mtimeMs;
  writeFileSync(fileName, source);
  const nextMtime = Math.max(previousMtime + 2_000, Date.now() + 2_000);
  utimesSync(fileName, nextMtime / 1_000, nextMtime / 1_000);
};

const graphModule = (
  server: ViteDevServer,
  fileName: string,
): EnvironmentModuleNode => {
  const modules =
    server.environments.client.moduleGraph.getModulesByFile(
      normalizePath(fileName),
    ) ?? server.environments.client.moduleGraph.getModulesByFile(fileName);
  if (modules?.size !== 1) {
    throw new Error(`Expected one graph module for ${fileName}`);
  }
  return [...modules][0];
};

const deliveryCount = (
  payloads: readonly HotPayload[],
  module: EnvironmentModuleNode,
): number =>
  payloads.reduce((total, payload) => {
    if (payload.type !== "update") return total;
    return (
      total +
      payload.updates.filter(({ acceptedPath, path: updatePath }) =>
        [acceptedPath, updatePath].some(
          (candidate) =>
            candidate === module.url ||
            candidate === module.id ||
            candidate === module.file,
        ),
      ).length
    );
  }, 0);

const moduleIdentity = (
  module: Pick<ModuleNode, "file" | "id" | "url">,
): string => normalizePath(module.file ?? module.id ?? module.url);

test("native HMR tracks ambient, aliased, symlinked, and multi-dependent edits", async () => {
  const fixture = createExtendedHmrFixture();
  let activeCycle: ExtendedHmrCycle | undefined;
  const observer: Plugin = {
    name: "native-extended-hmr-observer",
    enforce: "post",
    handleHotUpdate(context) {
      if (!activeCycle) return;
      activeCycle.returned.push(...context.modules);
      activeCycle.hooksCompleted = true;
    },
  };
  let server: ViteDevServer | undefined;

  try {
    const dependencyProbe = new NativeDocgenBackend({
      alias: "typescript7",
      options: { shouldExtractValuesFromUnion: true },
      rootDir: fixture.root,
      selection: {
        exclude: [],
        hasIncludes: true,
        include: ["src/**/*.tsx"],
        matchesDocgenFile: (fileName) => fileName.endsWith(".tsx"),
      },
    });
    const dependencyResult = await dependencyProbe.analyze({
      fileName: fixture.components[0],
      revision: 0,
      source: readFileSync(fixture.components[0], "utf-8"),
    });
    expect(dependencyResult.status).toBe("ok");
    if (dependencyResult.status === "ok") {
      expect(dependencyResult.dependencies).toEqual(
        expect.arrayContaining([
          path.resolve(fixture.components[0]),
          path.resolve(fixture.props),
          path.resolve(fixture.ambient),
          path.resolve(fixture.linkedPackage),
        ]),
      );
    }
    await dependencyProbe.dispose();

    const options = {
      exclude: [],
      include: ["src/**/*.tsx"],
      shouldExtractValuesFromUnion: true,
      tsconfigPath: "tsconfig.json",
    };
    server = await createServer({
      appType: "custom",
      configFile: false,
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true },
      plugins: [
        createPlugin(
          options,
          createNativeBackendFactory(
            { shouldExtractValuesFromUnion: true },
            "typescript7",
          ),
        ),
        observer,
      ],
      resolve: {
        alias: { "@shared": path.join(fixture.commonRoot, "shared") },
      },
      root: fixture.root,
      server: {
        fs: { allow: [fixture.commonRoot] },
        middlewareMode: true,
        watch: null,
      },
    });
    installCompletionProbe(server.watcher, () => activeCycle);

    for (const component of [...fixture.components, fixture.unrelated]) {
      await server.transformRequest(
        `/${normalizePath(path.relative(fixture.root, component))}`,
      );
    }
    await server.environments.client.waitForRequestsIdle();
    const dependents = fixture.components.map((component) =>
      graphModule(server as ViteDevServer, component),
    );
    const unrelated = graphModule(server, fixture.unrelated);

    const moduleGraph = server.environments.client.moduleGraph;
    const originalInvalidateModule = moduleGraph.invalidateModule;
    moduleGraph.invalidateModule = function (module, ...args) {
      if (activeCycle?.hooksCompleted) activeCycle.invalidated.push(module);
      return Reflect.apply(originalInvalidateModule, this, [module, ...args]);
    };
    const hot = server.environments.client.hot;
    const originalSend = hot.send;
    hot.send = function (...args: unknown[]) {
      const payload = args[0];
      if (
        activeCycle &&
        payload &&
        typeof payload === "object" &&
        "type" in payload
      ) {
        activeCycle.payloads.push(payload as HotPayload);
      }
      return Reflect.apply(originalSend, this, args);
    };

    const runEdit = async (
      fileName: string,
      source: string,
      assertion: (metadata: ReturnType<typeof docgenMetadata>) => void,
      propName = "tone",
    ) => {
      touchFile(fileName, source);
      const cycle: ExtendedHmrCycle = {
        hooksCompleted: false,
        invalidated: [],
        listenerThenables: [],
        payloads: [],
        returned: [],
      };
      activeCycle = cycle;
      try {
        expect(server?.watcher.emit("change", fileName)).toBe(true);
        expect(cycle.listenerThenables).toHaveLength(1);
        await cycle.listenerThenables[0];
      } finally {
        activeCycle = undefined;
      }

      expect(new Set(cycle.returned.map(moduleIdentity))).toEqual(
        new Set(dependents.map(moduleIdentity)),
      );
      expect(new Set(cycle.invalidated.map(moduleIdentity))).toEqual(
        new Set(dependents.map(moduleIdentity)),
      );
      for (const dependent of dependents) {
        expect(
          cycle.returned.filter(
            (module) => moduleIdentity(module) === moduleIdentity(dependent),
          ),
        ).toHaveLength(1);
        expect(
          cycle.invalidated.filter((module) => module === dependent),
        ).toHaveLength(1);
        expect(deliveryCount(cycle.payloads, dependent)).toBe(1);
      }
      expect(cycle.returned.map(moduleIdentity)).not.toContain(
        moduleIdentity(unrelated),
      );
      expect(cycle.invalidated).not.toContain(unrelated);
      expect(deliveryCount(cycle.payloads, unrelated)).toBe(0);
      expect(
        cycle.payloads.filter(({ type }) => type === "full-reload"),
      ).toHaveLength(0);

      for (const [index, component] of fixture.components.entries()) {
        const transformed = await server?.transformRequest(
          `/${normalizePath(path.relative(fixture.root, component))}`,
        );
        const metadata = docgenMetadata(transformed?.code, propName);
        assertion(metadata);
        expect(metadata, `dependent ${index + 1}`).toBeDefined();
      }
    };

    await runEdit(
      fixture.props,
      `/// <reference path="./ambient.d.ts" />
import type { LinkedTone } from "@fixture/tokens";
export interface SharedProps {
  /** Aliased props after edit. */
  tone: AmbientTone;
  /** Initial linked tone. */
  linked: LinkedTone;
}
`,
      (metadata) =>
        expect(metadata?.description).toBe("Aliased props after edit."),
    );
    await runEdit(
      fixture.ambient,
      'type AmbientTone = "ambient" | "ambient-next";\n',
      (metadata) => expect(metadata?.values).toContain('"ambient-next"'),
    );
    await runEdit(
      fixture.linkedPackage,
      'export type LinkedTone = "linked" | "linked-next";\n',
      (metadata) => expect(metadata?.values).toContain('"linked-next"'),
      "linked",
    );
  } finally {
    await server?.close();
    rmSync(fixture.commonRoot, { force: true, recursive: true });
  }
}, 60_000);

describe.each([
  "typescript7",
  "typescript7next",
] as const)("%s native HMR", (alias) => {
  test.each(CONTRACT_TOPOLOGIES)("native HMR: %s", async (topology) => {
    const backendOptions = { shouldExtractValuesFromUnion: true };
    const pluginOptions = {
      exclude: [],
      include:
        topology === "project-reference"
          ? ["../ui/**/*.tsx"]
          : ["src/**/*.tsx"],
      shouldExtractValuesFromUnion: true,
      tsconfigPath: "tsconfig.json",
    };
    const observation = await runImportedTypeHmrContract({
      label: alias,
      options: pluginOptions,
      pluginFactory: (options) =>
        createPlugin(
          options,
          createNativeBackendFactory(backendOptions, alias),
        ),
      rowKey: `${alias}:${topology}`,
      topology,
    });
    expect(observation.infrastructureErrors).toEqual([]);
    expect(observation.allHardControlsPass).toBe(true);
    expect(observation.semanticFailures).toEqual([]);
  });
});
