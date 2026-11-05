import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
export type ContractPhase =
  | ContractEdit
  | "component-recovery"
  | "dependency-create"
  | "dependency-delete"
  | "dependency-recreate"
  | "new-component"
  | "out-of-project-component"
  | "post-recreate-edit"
  | "unselected-create";

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
  warmFileSystemCache?: boolean;
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
  excludedComponentPath: string;
  excludedComponentUrl: string;
  missingComponentPath: string;
  missingComponentUrl: string;
  missingPropsPath: string;
  newComponentPath: string;
  newComponentUrl: string;
  propsPath: string;
  root: string;
  unselectedPath: string;
  unrelatedPath: string;
  unrelatedUrl: string;
}

interface CycleCapture {
  hooksCompleted: boolean;
  hooksCompletion: Promise<void>;
  invalidatedModules: EnvironmentModuleNode[];
  listenerInvocations: number;
  payloads: HotPayload[];
  phase: ContractPhase;
  resolveHooksCompletion: () => void;
  resolveTerminalPayload: (payload: HotPayload) => void;
  returnedModules: Array<{
    file: string | null;
    id: string | null;
    object: object;
    url: string;
  }>;
  terminalPayload: Promise<HotPayload>;
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

const NEW_COMPONENT_SOURCE = `declare namespace JSX {
  interface Element {}
}

export interface NewComponentProps {
  /** Newly discovered tone. */
  tone: "new" | "dynamic";
}

export const NewComponent = ({ tone: _tone }: NewComponentProps): JSX.Element =>
  null as unknown as JSX.Element;

if (import.meta.hot) import.meta.hot.accept();
`;

const MISSING_DEPENDENT_SOURCE = `declare namespace JSX {
  interface Element {}
}

import { MissingProps } from "./missingProps";

export const MissingDependent = ({ tone: _tone }: MissingProps): JSX.Element =>
  null as unknown as JSX.Element;

if (import.meta.hot) import.meta.hot.accept();
`;

const CREATED_PROPS_SOURCE = `export interface MissingProps {
  /** Tone after missing dependency creation. */
  tone: "base" | "created";
}
`;

const RECREATED_PROPS_SOURCE = `export interface MissingProps {
  /** Tone after dependency recreation. */
  tone: "base" | "recreated";
}
`;

const POST_RECREATE_PROPS_SOURCE = `export interface MissingProps {
  /** Tone after the post-recreate edit. */
  tone: "base" | "recreated" | "selective";
}
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
  const excludedComponentPath = path.join(
    sourceRoot,
    "excluded",
    "Excluded.tsx",
  );
  const missingComponentPath = path.join(sourceRoot, "MissingDependent.tsx");
  const missingPropsPath = path.join(sourceRoot, "missingProps.ts");
  const newComponentPath = path.join(sourceRoot, "NewComponent.tsx");
  const propsPath = path.join(sourceRoot, "props.ts");
  const unselectedPath = path.join(sourceRoot, "notes.md");
  const unrelatedPath = path.join(sourceRoot, "Unrelated.tsx");

  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(root, { recursive: true });
  writeFileSync(componentPath, COMPONENT_SOURCE);
  writeFileSync(missingComponentPath, MISSING_DEPENDENT_SOURCE);
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
        exclude: ["src/excluded"],
        include: ["src/**/*"],
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
        exclude: ["src/excluded"],
        include: ["src/**/*"],
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
    excludedComponentPath,
    excludedComponentUrl: toUrl(excludedComponentPath),
    missingComponentPath,
    missingComponentUrl: toUrl(missingComponentPath),
    missingPropsPath,
    newComponentPath,
    newComponentUrl: toUrl(newComponentPath),
    propsPath,
    root,
    unselectedPath,
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

const createCycleCapture = (phase: ContractPhase): CycleCapture => {
  let resolveHooksCompletion = () => {};
  const hooksCompletion = new Promise<void>((resolve) => {
    resolveHooksCompletion = resolve;
  });
  let resolveTerminalPayload: (payload: HotPayload) => void = () => {};
  const terminalPayload = new Promise<HotPayload>((resolve) => {
    resolveTerminalPayload = resolve;
  });

  return {
    hooksCompleted: false,
    hooksCompletion,
    invalidatedModules: [],
    listenerInvocations: 0,
    payloads: [],
    phase,
    resolveHooksCompletion,
    resolveTerminalPayload,
    returnedModules: [],
    terminalPayload,
  };
};

type WatcherListener = (this: FSWatcher, ...args: unknown[]) => unknown;
type RawWatcherListener = WatcherListener & { listener?: WatcherListener };

const installWatcherCompletionProbe = (
  watcher: FSWatcher,
  event: "add" | "change" | "unlink",
  getActiveCycle: () => CycleCapture | undefined,
) => {
  const rawListeners = watcher.rawListeners(event) as RawWatcherListener[];

  for (const rawListener of rawListeners) {
    watcher.removeListener(event, rawListener);
  }

  for (const rawListener of rawListeners) {
    const listener = rawListener.listener ?? rawListener;
    const isOnce = rawListener.listener !== undefined;
    const wrappedListener: WatcherListener = function (...args) {
      const activeCycle = getActiveCycle();
      if (activeCycle) activeCycle.listenerInvocations += 1;
      return Reflect.apply(listener, this, args);
    };

    if (isOnce) watcher.once(event, wrappedListener);
    else watcher.on(event, wrappedListener);
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
    dependencyCreateFresh: false,
    dependencyDeleteFresh: false,
    dependencyRecreateFresh: false,
    dependentGraphNodePresent: false,
    distinctGraphIdentities: false,
    firstEditCycleComplete: false,
    initialMetadataPresent: false,
    initialMissingDependencyUnresolved: false,
    missingDependentGraphNodePresent: false,
    newComponentFresh: false,
    newComponentSelective: false,
    outOfProjectComponentSkipped: false,
    postRecreateEditSelective: false,
    recoveryCycleComplete: false,
    secondEditCycleComplete: false,
    unselectedCreationIgnored: false,
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
  let missingDependentModule: EnvironmentModuleNode | null = null;
  let unrelatedModule: EnvironmentModuleNode | null = null;
  let initialMetadata: GeneratedMetadata | null = null;
  let recoveryMetadata: GeneratedMetadata | null = null;

  const observeUpdate = (
    modules: readonly EnvironmentModuleNode[],
  ): undefined => {
    if (!activeCycle) return;

    activeCycle.returnedModules.push(
      ...modules.map((module) => ({
        file: module.file,
        id: module.id,
        object: module,
        url: module.url,
      })),
    );
    activeCycle.hooksCompleted = true;
    activeCycle.resolveHooksCompletion();
  };

  const observerPlugin: Plugin = {
    name: "vite-rdt-imported-type-hmr-contract-observer",
    enforce: "post",
    handleHotUpdate(context) {
      return observeUpdate(context.modules);
    },
    hotUpdate(options) {
      return observeUpdate(options.modules);
    },
  };

  try {
    fixture = createFixture(registration.topology);
    const runtimeOptions = registration.warmFileSystemCache
      ? ({
          ...registration.options,
          fileSystemCache: {
            directory: path.join(fixture.commonRoot, ".docgen-cache"),
            enabled: true,
          },
        } as TOptions)
      : registration.options;
    if (registration.warmFileSystemCache) {
      const seedServer = await withDeadline(
        createServer({
          appType: "custom",
          configFile: false,
          logLevel: "silent",
          optimizeDeps: { noDiscovery: true },
          plugins: [registration.pluginFactory(runtimeOptions)],
          root: fixture.root,
          server: {
            fs: { allow: [fixture.commonRoot] },
            middlewareMode: true,
            watch: null,
          },
        }),
        "warm-cache seed server creation",
      );
      try {
        await withDeadline(
          seedServer.transformRequest(fixture.componentUrl),
          "warm-cache dependent seed transform",
        );
        await withDeadline(
          seedServer.transformRequest(fixture.missingComponentUrl),
          "warm-cache unresolved seed transform",
        );
      } finally {
        await withDeadline(
          seedServer.close(),
          "warm-cache seed server cleanup",
        );
      }
    }
    server = await withDeadline(
      createServer({
        appType: "custom",
        configFile: false,
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        plugins: [registration.pluginFactory(runtimeOptions), observerPlugin],
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
        const hotPayload = payload as HotPayload;
        activeCycle.payloads.push(hotPayload);
        if (
          hotPayload.type === "error" ||
          hotPayload.type === "full-reload" ||
          hotPayload.type === "update"
        ) {
          activeCycle.resolveTerminalPayload(hotPayload);
        }
        if (hotPayload.type === "error") {
          const errorPayload = hotPayload as Extract<
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

    for (const event of ["add", "change", "unlink"] as const) {
      const probedListeners = installWatcherCompletionProbe(
        server.watcher,
        event,
        () => activeCycle,
      );
      if (probedListeners === 0) {
        infrastructureErrors.push(
          `No public watcher ${event} listener was available for the Vite update cycle`,
        );
      }
    }

    const initialDependent = await withDeadline(
      server.transformRequest(fixture.componentUrl),
      "initial dependent transform",
    );
    const initialUnrelated = await withDeadline(
      server.transformRequest(fixture.unrelatedUrl),
      "initial unrelated transform",
    );
    const initialMissingDependent = await withDeadline(
      server.transformRequest(fixture.missingComponentUrl),
      "initial missing-dependent transform",
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
    const initialMissingMetadata = extractMetadata(
      initialMissingDependent?.code,
    );
    hardControls.initialMissingDependencyUnresolved = Boolean(
      !initialMissingMetadata ||
        (initialMissingMetadata.description === null &&
          initialMissingMetadata.unionValues.length === 0),
    );
    if (!hardControls.initialMissingDependencyUnresolved) {
      infrastructureErrors.push(
        `Initially missing dependency unexpectedly produced metadata: ${JSON.stringify(initialMissingMetadata)}`,
      );
    }

    dependentModule = getSingleGraphModule(server, fixture.componentPath);
    missingDependentModule = getSingleGraphModule(
      server,
      fixture.missingComponentPath,
    );
    unrelatedModule = getSingleGraphModule(server, fixture.unrelatedPath);
    hardControls.dependentGraphNodePresent = dependentModule !== null;
    hardControls.missingDependentGraphNodePresent =
      missingDependentModule !== null;
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
    if (!missingDependentModule) {
      infrastructureErrors.push(
        "The missing-import dependent did not have exactly one client-environment graph node",
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
      event: "add" | "change" | "unlink" = "change",
      expectTerminalPayload = true,
    ): Promise<CycleCapture> => {
      const cycle = createCycleCapture(phase);
      activeCycle = cycle;

      try {
        const emitted = server?.watcher.emit(event, changedFile);
        if (!emitted) {
          throw new Error(
            `The watcher accepted no ${event} listener for ${phase}`,
          );
        }
        if (cycle.listenerInvocations === 0) {
          throw new Error(
            `The watcher did not invoke a ${event} listener for ${phase}`,
          );
        }

        await withDeadline(cycle.hooksCompletion, `${phase} hook completion`);
        if (expectTerminalPayload) {
          await withDeadline(
            cycle.terminalPayload,
            `${phase} hot-channel delivery`,
          );
        }
        return cycle;
      } finally {
        activeCycle = undefined;
      }
    };

    const cycleHasNoErrorOrReload = (cycle: CycleCapture) =>
      cycle.payloads.every(
        ({ type }) => type !== "error" && type !== "full-reload",
      );
    const cycleIsExactForDependent = (cycle: CycleCapture) =>
      Boolean(
        fixture &&
          missingDependentModule &&
          unrelatedModule &&
          cycleHasNoErrorOrReload(cycle) &&
          countDelivery(cycle.payloads, missingDependentModule, fixture)
            .occurrences === 1 &&
          countDelivery(cycle.payloads, unrelatedModule, fixture)
            .occurrences === 0 &&
          countInvalidations(
            cycle.invalidatedModules,
            missingDependentModule,
            fixture,
          ).occurrences === 1 &&
          countInvalidations(cycle.invalidatedModules, unrelatedModule, fixture)
            .occurrences === 0,
      );
    const cycleDeliversDependentOnce = (cycle: CycleCapture) =>
      Boolean(
        fixture &&
          missingDependentModule &&
          cycleHasNoErrorOrReload(cycle) &&
          countDelivery(cycle.payloads, missingDependentModule, fixture)
            .occurrences === 1,
      );
    const cycleLeavesExistingComponentsUntouched = (cycle: CycleCapture) =>
      Boolean(
        fixture &&
          dependentModule &&
          missingDependentModule &&
          unrelatedModule &&
          [dependentModule, missingDependentModule, unrelatedModule].every(
            (module) =>
              countDelivery(cycle.payloads, module, fixture as ContractFixture)
                .occurrences === 0 &&
              countInvalidations(
                cycle.invalidatedModules,
                module,
                fixture as ContractFixture,
              ).occurrences === 0 &&
              countModules(
                cycle.returnedModules,
                module,
                fixture as ContractFixture,
              ).occurrences === 0,
          ),
      );

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
          writeFileSync(fixture.newComponentPath, NEW_COMPONENT_SOURCE);
          const cycle = await emitCycle(
            "new-component",
            fixture.newComponentPath,
            "add",
            false,
          );
          const transformed = await server.transformRequest(
            fixture.newComponentUrl,
          );
          const metadata = extractMetadata(transformed?.code);
          hardControls.newComponentFresh = Boolean(
            cycleHasNoErrorOrReload(cycle) &&
              metadata?.description === "Newly discovered tone." &&
              metadata.unionValues.includes("dynamic"),
          );
          hardControls.newComponentSelective =
            cycleLeavesExistingComponentsUntouched(cycle);
          if (!hardControls.newComponentFresh) {
            infrastructureErrors.push(
              `New matching component was not transformable with fresh metadata: ${JSON.stringify(metadata)}`,
            );
          }
          if (!hardControls.newComponentSelective) {
            infrastructureErrors.push(
              "New matching component creation touched an existing transformed component",
            );
          }
        })(),
        "new matching component phase",
      );
    } catch (error) {
      infrastructureErrors.push(
        `New matching component failed: ${getErrorMessage(error)}`,
      );
    }

    try {
      await withDeadline(
        (async () => {
          writeFileSync(fixture.missingPropsPath, CREATED_PROPS_SOURCE);
          const cycle = await emitCycle(
            "dependency-create",
            fixture.missingPropsPath,
            "add",
          );
          const transformed = await server.transformRequest(
            fixture.missingComponentUrl,
          );
          const metadata = extractMetadata(transformed?.code);
          hardControls.dependencyCreateFresh = Boolean(
            cycleDeliversDependentOnce(cycle) &&
              metadata?.description ===
                "Tone after missing dependency creation." &&
              metadata.unionValues.includes("created"),
          );
          if (!hardControls.dependencyCreateFresh) {
            infrastructureErrors.push(
              `Created missing dependency metadata or delivery was stale: ${JSON.stringify(metadata)}`,
            );
          }
        })(),
        "missing dependency creation phase",
      );
    } catch (error) {
      infrastructureErrors.push(
        `Missing dependency creation failed: ${getErrorMessage(error)}`,
      );
    }

    try {
      await withDeadline(
        (async () => {
          rmSync(fixture.missingPropsPath);
          const cycle = await emitCycle(
            "dependency-delete",
            fixture.missingPropsPath,
            "unlink",
          );
          const transformed = await server.transformRequest(
            fixture.missingComponentUrl,
          );
          const metadata = extractMetadata(transformed?.code);
          hardControls.dependencyDeleteFresh = Boolean(
            cycleIsExactForDependent(cycle) &&
              metadata?.description !==
                "Tone after missing dependency creation." &&
              !metadata?.unionValues.includes("created"),
          );
          if (!hardControls.dependencyDeleteFresh) {
            infrastructureErrors.push(
              `Deleted dependency left stale metadata or inexact delivery: ${JSON.stringify(metadata)}`,
            );
          }
        })(),
        "dependency deletion phase",
      );
    } catch (error) {
      infrastructureErrors.push(
        `Dependency deletion failed: ${getErrorMessage(error)}`,
      );
    }

    try {
      await withDeadline(
        (async () => {
          writeFileSync(fixture.missingPropsPath, RECREATED_PROPS_SOURCE);
          const cycle = await emitCycle(
            "dependency-recreate",
            fixture.missingPropsPath,
            "add",
          );
          const transformed = await server.transformRequest(
            fixture.missingComponentUrl,
          );
          const metadata = extractMetadata(transformed?.code);
          hardControls.dependencyRecreateFresh = Boolean(
            cycleDeliversDependentOnce(cycle) &&
              metadata?.description === "Tone after dependency recreation." &&
              metadata.unionValues.includes("recreated"),
          );
          if (!hardControls.dependencyRecreateFresh) {
            infrastructureErrors.push(
              `Recreated dependency metadata or delivery was stale: ${JSON.stringify(metadata)}`,
            );
          }
        })(),
        "dependency recreation phase",
      );
    } catch (error) {
      infrastructureErrors.push(
        `Dependency recreation failed: ${getErrorMessage(error)}`,
      );
    }

    try {
      await withDeadline(
        (async () => {
          const previousMtime = statSync(fixture.missingPropsPath).mtimeMs;
          writeFixtureEdit(
            fixture.missingPropsPath,
            POST_RECREATE_PROPS_SOURCE,
            previousMtime,
          );
          const cycle = await emitCycle(
            "post-recreate-edit",
            fixture.missingPropsPath,
          );
          const transformed = await server.transformRequest(
            fixture.missingComponentUrl,
          );
          const metadata = extractMetadata(transformed?.code);
          hardControls.postRecreateEditSelective = Boolean(
            cycleIsExactForDependent(cycle) &&
              metadata?.description === "Tone after the post-recreate edit." &&
              metadata.unionValues.includes("selective"),
          );
          if (!hardControls.postRecreateEditSelective) {
            infrastructureErrors.push(
              `Post-recreate edit did not return to exact selectivity: ${JSON.stringify(metadata)}`,
            );
          }
        })(),
        "post-recreate edit phase",
      );
    } catch (error) {
      infrastructureErrors.push(
        `Post-recreate edit failed: ${getErrorMessage(error)}`,
      );
    }

    try {
      await withDeadline(
        (async () => {
          mkdirSync(path.dirname(fixture.excludedComponentPath), {
            recursive: true,
          });
          writeFileSync(fixture.excludedComponentPath, NEW_COMPONENT_SOURCE);
          const cycle = await emitCycle(
            "out-of-project-component",
            fixture.excludedComponentPath,
            "add",
            false,
          );
          const transformed = await server.transformRequest(
            fixture.excludedComponentUrl,
          );
          hardControls.outOfProjectComponentSkipped = Boolean(
            cycleHasNoErrorOrReload(cycle) &&
              extractMetadata(transformed?.code) === null,
          );
          if (!hardControls.outOfProjectComponentSkipped) {
            infrastructureErrors.push(
              "A matching component outside configured TypeScript membership was admitted",
            );
          }
        })(),
        "out-of-project matching component phase",
      );
    } catch (error) {
      infrastructureErrors.push(
        `Out-of-project component control failed: ${getErrorMessage(error)}`,
      );
    }

    try {
      await withDeadline(
        (async () => {
          writeFileSync(fixture.unselectedPath, "# ignored");
          const cycle = await emitCycle(
            "unselected-create",
            fixture.unselectedPath,
            "add",
            false,
          );
          const transformed = await server.transformRequest(
            fixture.componentUrl,
          );
          const metadata = extractMetadata(transformed?.code);
          hardControls.unselectedCreationIgnored = Boolean(
            cycleHasNoErrorOrReload(cycle) &&
              dependentModule &&
              fixture &&
              countInvalidations(
                cycle.invalidatedModules,
                dependentModule,
                fixture,
              ).occurrences === 0 &&
              metadataMatches(metadata, "second-edit"),
          );
          if (!hardControls.unselectedCreationIgnored) {
            infrastructureErrors.push(
              `Unselected creation reset or invalidated the active project: ${JSON.stringify(metadata)}`,
            );
          }
        })(),
        "unselected creation phase",
      );
    } catch (error) {
      infrastructureErrors.push(
        `Unselected creation control failed: ${getErrorMessage(error)}`,
      );
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

export const runUnresolvedBoundaryHmrContract = async <TOptions>(
  registration: ImportedTypeHmrRegistration<TOptions>,
) => {
  const commonRoot = mkdtempSync(path.join(tmpdir(), "vite-rdt-boundary-"));
  const root = path.join(commonRoot, "app");
  const sourceRoot = path.join(root, "src");
  const aliasComponentPath = path.join(sourceRoot, "AliasDependent.tsx");
  const aliasDependencyPath = path.join(sourceRoot, "aliasMissing.ts");
  const substitutionComponentPath = path.join(
    sourceRoot,
    "SubstitutionDependent.tsx",
  );
  const substitutionDependencyPath = path.join(
    sourceRoot,
    "substitutionMissing.ts",
  );
  const aliasComponentUrl = "/src/AliasDependent.tsx";
  const substitutionComponentUrl = "/src/SubstitutionDependent.tsx";
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@/*": ["src/*"] },
        skipLibCheck: true,
        target: "ES2020",
      },
      include: ["src/**/*"],
    }),
  );
  writeFileSync(
    aliasComponentPath,
    `declare namespace JSX { interface Element {} }
import type { AliasProps } from "@/aliasMissing";
export const AliasDependent = ({ tone: _tone }: AliasProps): JSX.Element =>
  null as unknown as JSX.Element;
if (import.meta.hot) import.meta.hot.accept();
`,
  );
  writeFileSync(
    substitutionComponentPath,
    `declare namespace JSX { interface Element {} }
import type { SubstitutionProps } from "./substitutionMissing.js";
export const SubstitutionDependent = ({ tone: _tone }: SubstitutionProps): JSX.Element =>
  null as unknown as JSX.Element;
if (import.meta.hot) import.meta.hot.accept();
`,
  );

  let resolveHook:
    | ((modules: readonly EnvironmentModuleNode[]) => void)
    | undefined;
  const observerPlugin: Plugin = {
    name: "vite-rdt-unresolved-boundary-observer",
    enforce: "post",
    handleHotUpdate(context) {
      resolveHook?.(context.modules);
      resolveHook = undefined;
    },
    hotUpdate(options) {
      resolveHook?.(options.modules);
      resolveHook = undefined;
    },
  };
  let server: ViteDevServer | undefined;

  try {
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
        resolve: { alias: { "@": sourceRoot } },
        root,
        server: {
          fs: { allow: [commonRoot] },
          middlewareMode: true,
          watch: null,
        },
      }),
      "unresolved-boundary server creation",
    );
    await withDeadline(
      server.transformRequest(aliasComponentUrl),
      "initial alias-dependent transform",
    );
    await withDeadline(
      server.transformRequest(substitutionComponentUrl),
      "initial substitution-dependent transform",
    );
    await withDeadline(
      server.environments.client.waitForRequestsIdle(),
      "unresolved-boundary graph idle",
    );
    const aliasModule = getSingleGraphModule(server, aliasComponentPath);
    const substitutionModule = getSingleGraphModule(
      server,
      substitutionComponentPath,
    );
    if (!aliasModule || !substitutionModule) {
      throw new Error("Unresolved boundary graph identities were unavailable");
    }

    const emitCreation = async (fileName: string, phase: string) => {
      const hookCompletion = new Promise<readonly EnvironmentModuleNode[]>(
        (resolve) => {
          resolveHook = resolve;
        },
      );
      if (!server?.watcher.emit("add", fileName)) {
        throw new Error(`No watcher listener accepted ${phase}`);
      }
      return withDeadline(hookCompletion, `${phase} hook completion`);
    };

    writeFileSync(
      aliasDependencyPath,
      `export interface AliasProps {
  /** Alias dependency recovered. */
  tone: "alias" | "recovered";
}
`,
    );
    const aliasReturnedModules = await emitCreation(
      aliasDependencyPath,
      "alias dependency creation",
    );
    const aliasMetadata = extractMetadata(
      (
        await withDeadline(
          server.transformRequest(aliasComponentUrl),
          "alias recovery transform",
        )
      )?.code,
    );

    writeFileSync(
      substitutionDependencyPath,
      `export interface SubstitutionProps {
  /** Extension substitution recovered. */
  tone: "substitution" | "recovered";
}
`,
    );
    const substitutionReturnedModules = await emitCreation(
      substitutionDependencyPath,
      "extension-substitution dependency creation",
    );
    const substitutionMetadata = extractMetadata(
      (
        await withDeadline(
          server.transformRequest(substitutionComponentUrl),
          "extension-substitution recovery transform",
        )
      )?.code,
    );

    return {
      aliasRecovered:
        aliasMetadata?.description === "Alias dependency recovered." &&
        aliasMetadata.unionValues.includes("recovered"),
      aliasReturned: aliasReturnedModules.includes(aliasModule),
      substitutionRecovered:
        substitutionMetadata?.description ===
          "Extension substitution recovered." &&
        substitutionMetadata.unionValues.includes("recovered"),
      substitutionReturned:
        substitutionReturnedModules.includes(substitutionModule),
    };
  } finally {
    if (server) {
      await withDeadline(server.close(), "unresolved-boundary server cleanup");
    }
    rmSync(commonRoot, { force: true, recursive: true });
  }
};

export const runOfflineUnresolvedCacheContract = async <TOptions>(
  registration: ImportedTypeHmrRegistration<TOptions>,
) => {
  const commonRoot = mkdtempSync(path.join(tmpdir(), "vite-rdt-offline-"));
  const root = path.join(commonRoot, "app");
  const sourceRoot = path.join(root, "src");
  const componentPath = path.join(sourceRoot, "OfflineDependent.tsx");
  const dependencyPath = path.join(sourceRoot, "nested", "offlineMissing.ts");
  const componentUrl = "/src/OfflineDependent.tsx";
  const cacheDirectory = path.join(commonRoot, ".docgen-cache");
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@/*": ["src/*"] },
        skipLibCheck: true,
        target: "ES2020",
      },
      include: ["src/**/*"],
    }),
  );
  writeFileSync(
    componentPath,
    `declare namespace JSX { interface Element {} }
import type { OfflineProps } from "@/nested/offlineMissing";
export const OfflineDependent = ({ tone: _tone }: OfflineProps): JSX.Element =>
  null as unknown as JSX.Element;
`,
  );
  const runtimeOptions = {
    ...registration.options,
    fileSystemCache: { directory: cacheDirectory, enabled: true },
  } as TOptions;
  const createFixtureServer = () =>
    createServer({
      appType: "custom",
      configFile: false,
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true },
      plugins: [registration.pluginFactory(runtimeOptions)],
      resolve: { alias: { "@": sourceRoot } },
      root,
      server: {
        fs: { allow: [commonRoot] },
        middlewareMode: true,
        watch: null,
      },
    });
  const countCacheFiles = (directory: string): number =>
    readdirSync(directory, { withFileTypes: true }).reduce(
      (count, entry) =>
        count +
        (entry.isDirectory()
          ? countCacheFiles(path.join(directory, entry.name))
          : 1),
      0,
    );
  let seedServer: ViteDevServer | undefined;
  let reopenedServer: ViteDevServer | undefined;

  try {
    seedServer = await withDeadline(
      createFixtureServer(),
      "offline-cache seed server creation",
    );
    await withDeadline(
      seedServer.transformRequest(componentUrl),
      "offline-cache seed transform",
    );
    await withDeadline(seedServer.close(), "offline-cache seed server cleanup");
    seedServer = undefined;
    const cachedFiles = countCacheFiles(cacheDirectory);
    if (cachedFiles === 0) {
      throw new Error("Offline-cache seed produced no persistent entry");
    }

    mkdirSync(path.dirname(dependencyPath), { recursive: true });
    writeFileSync(
      dependencyPath,
      `export interface OfflineProps {
  /** Offline dependency recovered. */
  tone: "offline" | "recovered";
}
`,
    );
    reopenedServer = await withDeadline(
      createFixtureServer(),
      "offline-cache reopened server creation",
    );
    const metadata = extractMetadata(
      (
        await withDeadline(
          reopenedServer.transformRequest(componentUrl),
          "offline-cache reopened transform",
        )
      )?.code,
    );
    return {
      cachedFiles,
      recovered:
        metadata?.description === "Offline dependency recovered." &&
        metadata.unionValues.includes("recovered"),
    };
  } finally {
    if (seedServer) {
      await withDeadline(
        seedServer.close(),
        "offline-cache seed fallback cleanup",
      );
    }
    if (reopenedServer) {
      await withDeadline(
        reopenedServer.close(),
        "offline-cache reopened server cleanup",
      );
    }
    rmSync(commonRoot, { force: true, recursive: true });
  }
};
