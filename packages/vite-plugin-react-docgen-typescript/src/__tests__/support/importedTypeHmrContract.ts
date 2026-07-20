import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  EnvironmentModuleNode,
  FSWatcher,
  HotPayload,
  Plugin,
  ViteDevServer,
} from "vite";
import { createServer, normalizePath } from "vite";

export const CONTRACT_TOPOLOGIES = [
  "same-project",
  "project-reference",
] as const;

export type ContractTopology = (typeof CONTRACT_TOPOLOGIES)[number];
export type ContractEdit = "first-edit" | "second-edit";
export type ContractPhase = ContractEdit | "component-recovery";

export type SemanticFailureCode =
  | `delivery:${ContractEdit}`
  | `freshness:${ContractEdit}`
  | `invalidation:${ContractEdit}`
  | `selectivity:delivery:${ContractEdit}`
  | `selectivity:invalidation:${ContractEdit}`;

export interface ImportedTypeHmrRegistration<TOptions> {
  label: string;
  options: TOptions;
  pluginFactory(options: TOptions): Plugin;
  rowKey: string;
  topology: ContractTopology;
}

interface GeneratedMetadata {
  description: string | null;
  unionValues: string[];
}

interface ModuleIdentity {
  file: string | null;
  id: string | null;
  url: string;
}

export interface IdentityCounts {
  distinctObjects: number;
  distinctPaths: number;
  occurrences: number;
  paths: string[];
}

export interface DeliveryCounts {
  distinctPaths: number;
  occurrences: number;
  paths: string[];
}

export interface NormalizedHotPayload {
  paths: string[];
  type: HotPayload["type"];
}

export interface EditObservation {
  delivery: {
    dependent: DeliveryCounts;
    fullReloads: number;
    unrelated: DeliveryCounts;
  };
  invalidation: {
    dependent: IdentityCounts;
    unrelated: IdentityCounts;
  };
  metadata: GeneratedMetadata | null;
  payloads: NormalizedHotPayload[];
  phase: ContractEdit;
  returnedModules: {
    all: ModuleIdentity[];
    dependent: IdentityCounts;
    unrelated: IdentityCounts;
  };
}

export interface ImportedTypeHmrObservation {
  allHardControlsPass: boolean;
  behaviorSignature: string;
  determinismSignature: string;
  edits: Record<ContractEdit, EditObservation>;
  graphIdentities: {
    dependent: ModuleIdentity | null;
    unrelated: ModuleIdentity | null;
  };
  hardControls: Record<string, boolean>;
  hotErrorPayloads: string[];
  infrastructureErrors: string[];
  initialMetadata: GeneratedMetadata | null;
  label: string;
  recoveryMetadata: GeneratedMetadata | null;
  rowKey: string;
  semanticFailures: SemanticFailureCode[];
  topology: ContractTopology;
}

interface ContractFixture {
  commonRoot: string;
  componentPath: string;
  componentUrl: string;
  propsPath: string;
  root: string;
  unrelatedPath: string;
  unrelatedUrl: string;
}

interface CycleCapture {
  hooksCompleted: boolean;
  invalidatedModules: EnvironmentModuleNode[];
  listenerThenables: Promise<unknown>[];
  payloads: HotPayload[];
  phase: ContractPhase;
  returnedModules: Array<{
    file: string | null;
    id: string | null;
    object: object;
    url: string;
  }>;
}

const EMPTY_COUNTS = Object.freeze({
  distinctObjects: 0,
  distinctPaths: 0,
  occurrences: 0,
  paths: [] as string[],
});

const EMPTY_DELIVERY_COUNTS = Object.freeze({
  distinctPaths: 0,
  occurrences: 0,
  paths: [] as string[],
});

const EDIT_EXPECTATIONS = {
  "first-edit": {
    description: "Tone after the first imported-type edit.",
    unionMember: "contrast",
  },
  "second-edit": {
    description: "Tone after the second imported-type edit.",
    unionMember: "emphasis",
  },
} as const;

const PROPS_SOURCES = {
  initial: `export interface ImportedProps {
  /** Initial imported tone. */
  tone: "base" | "quiet";
}
`,
  "first-edit": `export interface ImportedProps {
  /** Tone after the first imported-type edit. */
  tone: "base" | "quiet" | "contrast";
}
`,
  "second-edit": `export interface ImportedProps {
  /** Tone after the second imported-type edit. */
  tone: "base" | "quiet" | "contrast" | "emphasis";
}
`,
} as const;

const COMPONENT_SOURCE = `declare namespace JSX {
  interface Element {}
}

import { ImportedProps } from "./props";

export const DependentComponent = ({ tone: _tone }: ImportedProps): JSX.Element =>
  null as unknown as JSX.Element;

if (import.meta.hot) import.meta.hot.accept();
`;

const UNRELATED_SOURCE = `declare namespace JSX {
  interface Element {}
}

export interface UnrelatedProps {
  /** Unrelated value. */
  value: "unchanged";
}

export const UnrelatedComponent = ({ value: _value }: UnrelatedProps): JSX.Element =>
  null as unknown as JSX.Element;

if (import.meta.hot) import.meta.hot.accept();
`;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

const withDeadline = async <T>(
  promise: Promise<T>,
  phase: string,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${phase} exceeded the 10-second deadline`)),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const createFixture = (topology: ContractTopology): ContractFixture => {
  const commonRoot = mkdtempSync(path.join(tmpdir(), "vite-rdt-hmr-"));
  const root = path.join(commonRoot, "app");
  const sourceRoot =
    topology === "same-project"
      ? path.join(root, "src")
      : path.join(commonRoot, "ui", "src");
  const componentPath = path.join(sourceRoot, "Dependent.tsx");
  const propsPath = path.join(sourceRoot, "props.ts");
  const unrelatedPath = path.join(sourceRoot, "Unrelated.tsx");

  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(componentPath, COMPONENT_SOURCE);
  writeFileSync(propsPath, PROPS_SOURCES.initial);
  writeFileSync(unrelatedPath, UNRELATED_SOURCE);

  const compilerOptions = {
    jsx: "preserve",
    module: "ESNext",
    moduleResolution: "Bundler",
    skipLibCheck: true,
    target: "ES2020",
  };

  if (topology === "same-project") {
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions,
        files: ["src/Dependent.tsx", "src/props.ts", "src/Unrelated.tsx"],
      }),
    );
  } else {
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions,
        files: [],
        references: [{ path: "../ui" }],
      }),
    );
    writeFileSync(
      path.join(commonRoot, "ui", "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { ...compilerOptions, composite: true },
        files: ["src/Dependent.tsx", "src/props.ts", "src/Unrelated.tsx"],
      }),
    );
  }

  const toUrl = (fileName: string) =>
    topology === "same-project"
      ? `/${normalizePath(path.relative(root, fileName))}`
      : `/@fs/${normalizePath(fileName)}`;

  return {
    commonRoot,
    componentPath,
    componentUrl: toUrl(componentPath),
    propsPath,
    root,
    unrelatedPath,
    unrelatedUrl: toUrl(unrelatedPath),
  };
};

const normalizeUnionValue = (value: string): string =>
  value.replace(/^[/"]+|[/"]+$/g, "");

const extractMetadata = (
  code: string | undefined,
): GeneratedMetadata | null => {
  if (!code) return null;

  const match = code.match(/__docgenInfo\s*=\s*(\{[\s\S]*?\});/);
  if (!match?.[1]) return null;

  try {
    const docgen = JSON.parse(match[1]) as {
      props?: Record<
        string,
        {
          description?: string;
          type?: { raw?: string; value?: Array<{ value?: string }> };
        }
      >;
    };
    const tone = docgen.props?.tone;
    const values = tone?.type?.value
      ?.map(({ value }) => (value ? normalizeUnionValue(value) : ""))
      .filter(Boolean);

    return {
      description: tone?.description ?? null,
      unionValues: [...new Set(values ?? [])].sort(),
    };
  } catch {
    return null;
  }
};

const createCycleCapture = (phase: ContractPhase): CycleCapture => ({
  hooksCompleted: false,
  invalidatedModules: [],
  listenerThenables: [],
  payloads: [],
  phase,
  returnedModules: [],
});

type ChangeListener = (this: FSWatcher, ...args: unknown[]) => unknown;
type RawChangeListener = ChangeListener & { listener?: ChangeListener };

const installWatcherCompletionProbe = (
  watcher: FSWatcher,
  getActiveCycle: () => CycleCapture | undefined,
) => {
  const rawListeners = watcher.rawListeners("change") as RawChangeListener[];

  for (const rawListener of rawListeners) {
    watcher.removeListener("change", rawListener);
  }

  for (const rawListener of rawListeners) {
    const listener = rawListener.listener ?? rawListener;
    const isOnce = rawListener.listener !== undefined;
    const wrappedListener: ChangeListener = function (...args) {
      const result = Reflect.apply(listener, this, args);
      const activeCycle = getActiveCycle();

      if (
        activeCycle &&
        result !== null &&
        (typeof result === "object" || typeof result === "function") &&
        "then" in result &&
        typeof result.then === "function"
      ) {
        activeCycle.listenerThenables.push(Promise.resolve(result));
      }

      return result;
    };

    if (isOnce) watcher.once("change", wrappedListener);
    else watcher.on("change", wrappedListener);
  }

  return rawListeners.length;
};

const moduleIdentity = (
  module: Pick<EnvironmentModuleNode, "file" | "id" | "url">,
  fixture: ContractFixture,
): ModuleIdentity => ({
  file: normalizeFixturePath(module.file, fixture),
  id: normalizeFixturePath(module.id, fixture),
  url: normalizeFixturePath(module.url, fixture) ?? module.url,
});

const normalizeFixturePath = (
  value: string | null,
  fixture: ContractFixture,
): string | null => {
  if (value === null) return null;

  const normalized = normalizePath(value);
  const fixtureRoot = normalizePath(fixture.commonRoot);

  return normalized.replace(fixtureRoot, "<fixture>");
};

const moduleCandidates = (
  module: EnvironmentModuleNode,
  fixture: ContractFixture,
): Set<string> => {
  const values = [module.url, module.id, module.file].filter(
    (value): value is string => Boolean(value),
  );

  if (module.file) {
    values.push(`/@fs/${normalizePath(module.file)}`);
    values.push(`/${normalizePath(path.relative(fixture.root, module.file))}`);
  }

  return new Set(values.map((value) => normalizePath(value.split("?")[0])));
};

const matchesModule = (
  value: string,
  module: EnvironmentModuleNode,
  fixture: ContractFixture,
): boolean =>
  moduleCandidates(module, fixture).has(normalizePath(value.split("?")[0]));

const countModules = (
  modules: Array<{
    file: string | null;
    id: string | null;
    object: object;
    url: string;
  }>,
  target: EnvironmentModuleNode,
  fixture: ContractFixture,
): IdentityCounts => {
  const matches = modules.filter(
    (module) =>
      module.object === target ||
      [module.url, module.id, module.file].some(
        (value) => value && matchesModule(value, target, fixture),
      ),
  );
  const paths = matches.map((module) => {
    const canonicalPath = module.id ?? module.file ?? module.url;

    return normalizeFixturePath(canonicalPath, fixture) ?? canonicalPath;
  });

  return {
    distinctObjects: new Set(matches.map(({ object }) => object)).size,
    distinctPaths: new Set(paths).size,
    occurrences: matches.length,
    paths: [...new Set(paths)].sort(),
  };
};

const countInvalidations = (
  modules: EnvironmentModuleNode[],
  target: EnvironmentModuleNode,
  fixture: ContractFixture,
): IdentityCounts => {
  const normalized = modules.map((module) => ({
    file: module.file,
    id: module.id,
    object: module,
    url: module.url,
  }));

  return countModules(normalized, target, fixture);
};

const countDelivery = (
  payloads: HotPayload[],
  target: EnvironmentModuleNode,
  fixture: ContractFixture,
): DeliveryCounts => {
  const paths: string[] = [];
  let occurrences = 0;

  for (const payload of payloads) {
    if (payload.type !== "update") continue;

    for (const update of payload.updates) {
      const matchingPaths = [update.path, update.acceptedPath].filter((value) =>
        matchesModule(value, target, fixture),
      );

      if (matchingPaths.length > 0) {
        occurrences += 1;
        paths.push(
          ...matchingPaths.map(
            (value) => normalizeFixturePath(value, fixture) ?? value,
          ),
        );
      }
    }
  }

  return {
    distinctPaths: new Set(paths).size,
    occurrences,
    paths: [...new Set(paths)].sort(),
  };
};

const normalizePayload = (
  payload: HotPayload,
  fixture: ContractFixture,
): NormalizedHotPayload => {
  if (payload.type === "update") {
    return {
      paths: payload.updates
        .flatMap(({ acceptedPath, path: updatePath }) => [
          normalizeFixturePath(updatePath, fixture) ?? updatePath,
          normalizeFixturePath(acceptedPath, fixture) ?? acceptedPath,
        ])
        .sort(),
      type: payload.type,
    };
  }

  if (payload.type === "full-reload") {
    const paths = [payload.path, payload.triggeredBy]
      .filter((value): value is string => Boolean(value))
      .map((value) => normalizeFixturePath(value, fixture) ?? value)
      .sort();
    return { paths, type: payload.type };
  }

  return { paths: [], type: payload.type };
};

const getSingleGraphModule = (
  server: ViteDevServer,
  fileName: string,
): EnvironmentModuleNode | null => {
  const normalizedFile = normalizePath(fileName);
  const modules =
    server.environments.client.moduleGraph.getModulesByFile(normalizedFile);

  return modules?.size === 1 ? [...modules][0] : null;
};

const writeFixtureEdit = (
  fileName: string,
  contents: string,
  previousMtime: number,
): number => {
  writeFileSync(fileName, contents);
  const nextMtime = Math.max(previousMtime + 2_000, Date.now() + 2_000);
  const seconds = nextMtime / 1_000;
  utimesSync(fileName, seconds, seconds);
  return nextMtime;
};

const metadataMatches = (
  metadata: GeneratedMetadata | null,
  edit: ContractEdit,
): boolean => {
  const expected = EDIT_EXPECTATIONS[edit];

  return Boolean(
    metadata?.description === expected.description &&
      metadata.unionValues.includes(expected.unionMember),
  );
};

const createEmptyEditObservation = (phase: ContractEdit): EditObservation => ({
  delivery: {
    dependent: { ...EMPTY_DELIVERY_COUNTS },
    fullReloads: 0,
    unrelated: { ...EMPTY_DELIVERY_COUNTS },
  },
  invalidation: {
    dependent: { ...EMPTY_COUNTS },
    unrelated: { ...EMPTY_COUNTS },
  },
  metadata: null,
  payloads: [],
  phase,
  returnedModules: {
    all: [],
    dependent: { ...EMPTY_COUNTS },
    unrelated: { ...EMPTY_COUNTS },
  },
});

const semanticFailuresForEdit = (
  edit: EditObservation,
): SemanticFailureCode[] => {
  const failures: SemanticFailureCode[] = [];
  const phase = edit.phase;

  if (
    edit.delivery.fullReloads > 0 ||
    edit.delivery.dependent.occurrences !== 1
  ) {
    failures.push(`delivery:${phase}`);
  }
  if (
    edit.invalidation.dependent.occurrences !== 1 ||
    edit.invalidation.dependent.distinctObjects !== 1 ||
    edit.invalidation.dependent.distinctPaths !== 1
  ) {
    failures.push(`invalidation:${phase}`);
  }
  if (!metadataMatches(edit.metadata, phase)) {
    failures.push(`freshness:${phase}`);
  }
  if (
    edit.delivery.fullReloads > 0 ||
    edit.delivery.unrelated.occurrences > 0
  ) {
    failures.push(`selectivity:delivery:${phase}`);
  }
  if (edit.invalidation.unrelated.occurrences > 0) {
    failures.push(`selectivity:invalidation:${phase}`);
  }

  return failures;
};

const stableSignature = (
  observation: Omit<
    ImportedTypeHmrObservation,
    "allHardControlsPass" | "behaviorSignature" | "determinismSignature"
  >,
  includeRowKey: boolean,
): string =>
  JSON.stringify({
    edits: observation.edits,
    graphIdentities: observation.graphIdentities,
    hardControls: observation.hardControls,
    initialMetadata: observation.initialMetadata,
    label: includeRowKey ? observation.label : undefined,
    recoveryMetadata: observation.recoveryMetadata,
    rowKey: includeRowKey ? observation.rowKey : undefined,
    semanticFailures: observation.semanticFailures,
    topology: observation.topology,
  });

export const runImportedTypeHmrContract = async <TOptions>(
  registration: ImportedTypeHmrRegistration<TOptions>,
): Promise<ImportedTypeHmrObservation> => {
  const infrastructureErrors: string[] = [];
  const hotErrorPayloads: string[] = [];
  const hardControls: Record<string, boolean> = {
    cleanupComplete: false,
    componentRecoveryFresh: false,
    dependentGraphNodePresent: false,
    distinctGraphIdentities: false,
    firstEditCycleComplete: false,
    initialMetadataPresent: false,
    recoveryCycleComplete: false,
    secondEditCycleComplete: false,
    unrelatedGraphNodePresent: false,
  };
  const edits: Record<ContractEdit, EditObservation> = {
    "first-edit": createEmptyEditObservation("first-edit"),
    "second-edit": createEmptyEditObservation("second-edit"),
  };
  let fixture: ContractFixture | undefined;
  let server: ViteDevServer | undefined;
  let activeCycle: CycleCapture | undefined;
  let dependentModule: EnvironmentModuleNode | null = null;
  let unrelatedModule: EnvironmentModuleNode | null = null;
  let initialMetadata: GeneratedMetadata | null = null;
  let recoveryMetadata: GeneratedMetadata | null = null;

  const observerPlugin: Plugin = {
    name: "vite-rdt-imported-type-hmr-contract-observer",
    enforce: "post",
    handleHotUpdate(context) {
      if (!activeCycle) return;

      activeCycle.returnedModules.push(
        ...context.modules.map((module) => ({
          file: module.file,
          id: module.id,
          object: module,
          url: module.url,
        })),
      );
      activeCycle.hooksCompleted = true;
    },
  };

  try {
    fixture = createFixture(registration.topology);
    server = await withDeadline(
      createServer({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        plugins: [
          registration.pluginFactory(registration.options),
          observerPlugin,
        ],
        root: fixture.root,
        server: {
          fs: { allow: [fixture.commonRoot] },
          middlewareMode: true,
          watch: null,
        },
      }),
      "server creation",
    );

    const clientEnvironment = server.environments.client;
    const originalInvalidateModule =
      clientEnvironment.moduleGraph.invalidateModule;
    clientEnvironment.moduleGraph.invalidateModule = function (
      module,
      ...args
    ) {
      if (activeCycle?.hooksCompleted) {
        activeCycle.invalidatedModules.push(module);
      }

      return Reflect.apply(originalInvalidateModule, this, [module, ...args]);
    };

    const originalHotSend = clientEnvironment.hot.send;
    clientEnvironment.hot.send = function (...args: unknown[]) {
      const payload = args[0];

      if (
        activeCycle &&
        payload !== null &&
        typeof payload === "object" &&
        "type" in payload
      ) {
        activeCycle.payloads.push(payload as HotPayload);
        if ((payload as HotPayload).type === "error") {
          const errorPayload = payload as Extract<
            HotPayload,
            { type: "error" }
          >;
          const message = errorPayload.err.message;
          hotErrorPayloads.push(message);
          infrastructureErrors.push(
            `Vite emitted an error payload during ${activeCycle.phase}: ${message}`,
          );
        }
      }

      return Reflect.apply(originalHotSend, this, args);
    } as typeof clientEnvironment.hot.send;

    const probedChangeListeners = installWatcherCompletionProbe(
      server.watcher,
      () => activeCycle,
    );
    if (probedChangeListeners === 0) {
      infrastructureErrors.push(
        "No public watcher change listener was available for the Vite update cycle",
      );
    }

    const initialDependent = await withDeadline(
      server.transformRequest(fixture.componentUrl),
      "initial dependent transform",
    );
    const initialUnrelated = await withDeadline(
      server.transformRequest(fixture.unrelatedUrl),
      "initial unrelated transform",
    );
    await withDeadline(
      clientEnvironment.waitForRequestsIdle(),
      "initial module graph idle",
    );

    initialMetadata = extractMetadata(initialDependent?.code);
    hardControls.initialMetadataPresent =
      initialMetadata?.description === "Initial imported tone." &&
      initialMetadata.unionValues.includes("base");
    if (!hardControls.initialMetadataPresent) {
      infrastructureErrors.push(
        `Initial dependent metadata was missing or invalid: ${JSON.stringify(initialMetadata)}`,
      );
    }
    if (!extractMetadata(initialUnrelated?.code)) {
      infrastructureErrors.push("Initial unrelated metadata was missing");
    }

    dependentModule = getSingleGraphModule(server, fixture.componentPath);
    unrelatedModule = getSingleGraphModule(server, fixture.unrelatedPath);
    hardControls.dependentGraphNodePresent = dependentModule !== null;
    hardControls.unrelatedGraphNodePresent = unrelatedModule !== null;
    hardControls.distinctGraphIdentities = Boolean(
      dependentModule &&
        unrelatedModule &&
        dependentModule !== unrelatedModule &&
        dependentModule.id !== unrelatedModule.id &&
        dependentModule.file !== unrelatedModule.file,
    );

    if (!dependentModule) {
      infrastructureErrors.push(
        "The dependent component did not have exactly one client-environment graph node",
      );
    }
    if (!unrelatedModule) {
      infrastructureErrors.push(
        "The unrelated component did not have exactly one client-environment graph node",
      );
    }
    if (!hardControls.distinctGraphIdentities) {
      infrastructureErrors.push(
        "Dependent and unrelated client graph identities were missing or ambiguous",
      );
    }

    const emitCycle = async (
      phase: ContractPhase,
      changedFile: string,
    ): Promise<CycleCapture> => {
      const cycle = createCycleCapture(phase);
      activeCycle = cycle;

      try {
        const emitted = server?.watcher.emit("change", changedFile);
        if (!emitted) {
          throw new Error(
            `The watcher accepted no change listener for ${phase}`,
          );
        }
        if (cycle.listenerThenables.length !== 1) {
          throw new Error(
            `Expected exactly one asynchronous Vite update cycle for ${phase}; observed ${cycle.listenerThenables.length}`,
          );
        }

        await withDeadline(
          cycle.listenerThenables[0],
          `${phase} watcher cycle`,
        );
        return cycle;
      } finally {
        activeCycle = undefined;
      }
    };

    let propsMtime = statSync(fixture.propsPath).mtimeMs;
    for (const edit of ["first-edit", "second-edit"] as const) {
      try {
        await withDeadline(
          (async () => {
            propsMtime = writeFixtureEdit(
              fixture.propsPath,
              PROPS_SOURCES[edit],
              propsMtime,
            );
            const cycle = await emitCycle(edit, fixture.propsPath);
            hardControls[
              edit === "first-edit"
                ? "firstEditCycleComplete"
                : "secondEditCycleComplete"
            ] = true;
            const transformed = await server.transformRequest(
              fixture.componentUrl,
            );
            const payloads = cycle.payloads.map((payload) =>
              normalizePayload(payload, fixture as ContractFixture),
            );

            edits[edit] = {
              delivery: {
                dependent:
                  dependentModule && fixture
                    ? countDelivery(cycle.payloads, dependentModule, fixture)
                    : { ...EMPTY_DELIVERY_COUNTS },
                fullReloads: cycle.payloads.filter(
                  ({ type }) => type === "full-reload",
                ).length,
                unrelated:
                  unrelatedModule && fixture
                    ? countDelivery(cycle.payloads, unrelatedModule, fixture)
                    : { ...EMPTY_DELIVERY_COUNTS },
              },
              invalidation: {
                dependent:
                  dependentModule && fixture
                    ? countInvalidations(
                        cycle.invalidatedModules,
                        dependentModule,
                        fixture,
                      )
                    : { ...EMPTY_COUNTS },
                unrelated:
                  unrelatedModule && fixture
                    ? countInvalidations(
                        cycle.invalidatedModules,
                        unrelatedModule,
                        fixture,
                      )
                    : { ...EMPTY_COUNTS },
              },
              metadata: extractMetadata(transformed?.code),
              payloads,
              phase: edit,
              returnedModules: {
                all: cycle.returnedModules.map((module) =>
                  moduleIdentity(module, fixture as ContractFixture),
                ),
                dependent:
                  dependentModule && fixture
                    ? countModules(
                        cycle.returnedModules,
                        dependentModule,
                        fixture,
                      )
                    : { ...EMPTY_COUNTS },
                unrelated:
                  unrelatedModule && fixture
                    ? countModules(
                        cycle.returnedModules,
                        unrelatedModule,
                        fixture,
                      )
                    : { ...EMPTY_COUNTS },
              },
            };
          })(),
          `${edit} edit phase`,
        );
      } catch (error) {
        infrastructureErrors.push(
          `${edit} watcher/update cycle failed: ${getErrorMessage(error)}`,
        );
      }
    }

    try {
      await withDeadline(
        (async () => {
          let componentMtime = statSync(fixture.componentPath).mtimeMs;
          appendFileSync(fixture.componentPath, "\n// HMR recovery touch.\n");
          componentMtime = Math.max(componentMtime + 2_000, Date.now() + 2_000);
          utimesSync(
            fixture.componentPath,
            componentMtime / 1_000,
            componentMtime / 1_000,
          );
          await emitCycle("component-recovery", fixture.componentPath);
          hardControls.recoveryCycleComplete = true;
          const recovered = await server.transformRequest(fixture.componentUrl);
          recoveryMetadata = extractMetadata(recovered?.code);
        })(),
        "component recovery phase",
      );
      hardControls.componentRecoveryFresh = metadataMatches(
        recoveryMetadata,
        "second-edit",
      );
      if (!hardControls.componentRecoveryFresh) {
        infrastructureErrors.push(
          `Component-touch recovery was stale: ${JSON.stringify(recoveryMetadata)}`,
        );
      }
    } catch (error) {
      infrastructureErrors.push(
        `Component-touch recovery failed: ${getErrorMessage(error)}`,
      );
    }
  } catch (error) {
    infrastructureErrors.push(
      `Contract setup failed: ${getErrorMessage(error)}`,
    );
  } finally {
    let serverClosed = true;
    let fixtureRemoved = true;

    if (server) {
      try {
        await withDeadline(server.close(), "server cleanup");
      } catch (error) {
        serverClosed = false;
        infrastructureErrors.push(
          `Server cleanup failed: ${getErrorMessage(error)}`,
        );
      }
    }

    if (fixture) {
      try {
        rmSync(fixture.commonRoot, { force: true, recursive: true });
      } catch (error) {
        fixtureRemoved = false;
        infrastructureErrors.push(
          `Fixture cleanup failed: ${getErrorMessage(error)}`,
        );
      }
    }

    hardControls.cleanupComplete = serverClosed && fixtureRemoved;
  }

  const semanticFailures = (
    [
      ...semanticFailuresForEdit(edits["first-edit"]),
      ...semanticFailuresForEdit(edits["second-edit"]),
    ] as SemanticFailureCode[]
  ).sort();
  const graphIdentities = {
    dependent:
      dependentModule && fixture
        ? moduleIdentity(dependentModule, fixture)
        : null,
    unrelated:
      unrelatedModule && fixture
        ? moduleIdentity(unrelatedModule, fixture)
        : null,
  };
  const baseObservation = {
    edits,
    graphIdentities,
    hardControls,
    hotErrorPayloads,
    infrastructureErrors,
    initialMetadata,
    label: registration.label,
    recoveryMetadata,
    rowKey: registration.rowKey,
    semanticFailures,
    topology: registration.topology,
  };

  return {
    ...baseObservation,
    allHardControlsPass: Object.values(hardControls).every(Boolean),
    behaviorSignature: stableSignature(baseObservation, false),
    determinismSignature: stableSignature(baseObservation, true),
  };
};
