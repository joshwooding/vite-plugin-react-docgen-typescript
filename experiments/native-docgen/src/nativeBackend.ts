import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { API, Project, Snapshot } from "typescript7/unstable/async";
import type { FileSystem } from "typescript7/unstable/fs";
import type {
  AnalyzeResult,
  BackendDescriptor,
  BackendFileSelection,
  BackendProjectState,
  DocgenBackend,
  DocgenBackendFactory,
  FileUpdateResult,
  ResetCompletion,
  UpdateCompletion,
} from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts";
import { toBackendErrorRecord } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts";
import { normalizeBoundaryPath } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/pathIdentity.ts";
import {
  loadNativeAsync,
  type NativeAlias,
  readNativeVersion,
} from "./nativeCapabilities.ts";
import {
  collectNativeDependencies,
  extractNativeComponents,
  type NativeExtractionInstrumentation,
  type NativeExtractorOptions,
} from "./nativeExtractor.ts";

type OverlayValue = string | null;
type OverlayView = ReadonlyMap<string, OverlayValue>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface PendingUpdate {
  affected: readonly string[];
  change: {
    fileName: string;
    kind: "change" | "create" | "delete";
    revision: number;
    source?: string;
  };
  deferred: Deferred<UpdateCompletion>;
}

export interface NativeBackendOptions extends NativeExtractorOptions {
  tsconfigPath?: string;
}

export interface NativeBackendInstrumentation {
  analyzeCalls: number;
  cacheHits: number;
  extractor: NativeExtractionInstrumentation;
  snapshotsAdded: number;
  snapshotsDisposed: number;
  updateRequests: number;
}

const emptyExtractorInstrumentation = (): NativeExtractionInstrumentation => ({
  checkerRequests: 0,
  componentCount: 0,
  propCount: 0,
});

const createDeferred = <T>(): Deferred<T> => {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
};

const isInside = (candidate: string, directory: string): boolean => {
  const relative = path.relative(directory, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
};

const physicalEntries = (
  directoryName: string,
): { directories: string[]; files: string[] } | undefined => {
  try {
    const directories: string[] = [];
    const files: string[] = [];
    for (const entry of readdirSync(directoryName, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(entry.name);
      else if (entry.isFile()) files.push(entry.name);
      else if (entry.isSymbolicLink()) {
        try {
          const target = statSync(path.join(directoryName, entry.name));
          if (target.isDirectory()) directories.push(entry.name);
          else files.push(entry.name);
        } catch {
          // Broken links are inaccessible to the native project as well.
        }
      }
    }
    return { directories, files };
  } catch {
    return undefined;
  }
};

const createLayeredFileSystem = (
  getOverlay: () => OverlayView,
): FileSystem => ({
  directoryExists(directoryName) {
    const directory = normalizeBoundaryPath(directoryName);
    if (existsSync(directory)) {
      try {
        if (statSync(directory).isDirectory()) return true;
      } catch {
        // Overlay children may still make the directory visible.
      }
    }
    for (const [fileName, value] of getOverlay()) {
      if (
        value !== null &&
        isInside(fileName, directory) &&
        fileName !== directory
      ) {
        return true;
      }
    }
    return false;
  },
  fileExists(fileName) {
    const normalized = normalizeBoundaryPath(fileName);
    const value = getOverlay().get(normalized);
    return value === null ? false : value === undefined ? undefined : true;
  },
  getAccessibleEntries(directoryName) {
    const directory = normalizeBoundaryPath(directoryName);
    const entries = physicalEntries(directory) ?? {
      directories: [],
      files: [],
    };
    const directories = new Set(entries.directories);
    const files = new Set(entries.files);

    for (const [fileName, value] of getOverlay()) {
      if (!isInside(fileName, directory) || fileName === directory) continue;
      const relative = path.relative(directory, fileName);
      const [head, ...tail] = relative.split(path.sep);
      if (!head) continue;
      if (tail.length > 0) {
        if (value !== null) directories.add(head);
      } else if (value === null) {
        files.delete(head);
      } else {
        files.add(head);
      }
    }

    if (directories.size === 0 && files.size === 0 && !existsSync(directory)) {
      return undefined;
    }
    return {
      directories: [...directories].sort(),
      files: [...files].sort(),
    };
  },
  readFile(fileName) {
    const normalized = normalizeBoundaryPath(fileName);
    return getOverlay().has(normalized)
      ? (getOverlay().get(normalized) ?? null)
      : undefined;
  },
  realpath(fileName) {
    try {
      return realpathSync.native(fileName);
    } catch {
      return undefined;
    }
  },
});

const applyChanges = (
  base: OverlayView,
  updates: readonly PendingUpdate[],
): ReadonlyMap<string, OverlayValue> => {
  const next = new Map(base);
  for (const { change } of [...updates].sort(
    (left, right) => left.change.revision - right.change.revision,
  )) {
    const fileName = normalizeBoundaryPath(change.fileName);
    next.set(fileName, change.kind === "delete" ? null : (change.source ?? ""));
  }
  return next;
};

const parseConfigReferences = (configFile: string): readonly string[] => {
  try {
    const contents = readFileSync(configFile, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,\s*([}\]])/g, "$1");
    const parsed = JSON.parse(contents) as {
      references?: Array<{ path?: string }>;
    };
    return (parsed.references ?? []).flatMap((reference) => {
      if (!reference.path) return [];
      const target = path.resolve(path.dirname(configFile), reference.path);
      return [
        path.extname(target) ? target : path.join(target, "tsconfig.json"),
      ];
    });
  } catch {
    return [];
  }
};

const discoverConfigFiles = (rootConfig: string): readonly string[] => {
  const configs = new Set<string>();
  const pending = [path.resolve(rootConfig)];
  while (pending.length > 0) {
    const config = pending.pop();
    if (!config || configs.has(config)) continue;
    configs.add(config);
    pending.push(...parseConfigReferences(config));
  }
  return [...configs].sort();
};

export class NativeDocgenBackend implements DocgenBackend {
  readonly alias: NativeAlias;
  readonly instrumentation: NativeBackendInstrumentation = {
    analyzeCalls: 0,
    cacheHits: 0,
    extractor: emptyExtractorInstrumentation(),
    snapshotsAdded: 0,
    snapshotsDisposed: 0,
    updateRequests: 0,
  };

  private readonly configFile: string;
  private readonly configFiles: readonly string[];
  private readonly fileSystem: FileSystem;
  private readonly options: NativeBackendOptions;
  private readonly rootDir: string;
  private readonly selection: BackendFileSelection;
  private activeOverlay: OverlayView = new Map();
  private api: API | undefined;
  private currentProjectState: BackendProjectState | undefined;
  private currentRevision = 0;
  private currentSnapshot: Snapshot | undefined;
  private disposed = false;
  private latestRequestedRevision = 0;
  private logicalOverlay: OverlayView = new Map();
  private pending = new Map<number, PendingUpdate>();
  private serial: Promise<void> = Promise.resolve();

  constructor({
    alias,
    options,
    rootDir,
    selection,
  }: {
    alias: NativeAlias;
    options: NativeBackendOptions;
    rootDir: string;
    selection: BackendFileSelection;
  }) {
    this.alias = alias;
    this.options = options;
    this.rootDir = path.resolve(rootDir);
    this.selection = selection;
    this.configFile = path.resolve(
      this.rootDir,
      options.tsconfigPath ?? "tsconfig.json",
    );
    this.configFiles = discoverConfigFiles(this.configFile);
    this.fileSystem = createLayeredFileSystem(() => this.activeOverlay);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.serial.then(operation, operation);
    this.serial = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async buildProjectState(
    snapshot: Snapshot,
  ): Promise<BackendProjectState> {
    const configFiles = new Set<string>();
    const trackedFiles = new Set<string>();

    for (const project of snapshot.getProjects()) {
      configFiles.add(normalizeBoundaryPath(project.configFileName));
      for (const fileName of await project.program.getSourceFileNames()) {
        const normalized = normalizeBoundaryPath(fileName);
        const sourceFile = await project.program.getSourceFile(normalized);
        if (!sourceFile) continue;
        if (await project.program.isSourceFileDefaultLibrary(sourceFile))
          continue;
        if (normalized.includes(`${path.sep}node_modules${path.sep}`)) continue;
        trackedFiles.add(normalized);
      }
    }

    const sortedTracked = [...trackedFiles].sort();
    return {
      configFiles: [...configFiles].sort(),
      docgenFiles: sortedTracked.filter((fileName) =>
        this.selection.matchesDocgenFile(fileName),
      ),
      generation: this.currentRevision,
      trackedFiles: sortedTracked,
    };
  }

  private async ensureInitialized(): Promise<BackendProjectState> {
    if (this.disposed) throw new Error("Native backend is disposed");
    if (this.api && this.currentSnapshot && this.currentProjectState) {
      return this.currentProjectState;
    }

    const { API: NativeAPI } = await loadNativeAsync(this.alias);
    const api = new NativeAPI({
      collectTiming: true,
      cwd: this.rootDir,
      fs: this.fileSystem,
    });
    this.api = api;
    await Promise.all(
      this.configFiles.map((configFile) => api.parseConfigFile(configFile)),
    );
    this.currentSnapshot = await api.updateSnapshot({
      openProjects: [...this.configFiles],
    });
    this.instrumentation.snapshotsAdded += 1;
    this.currentProjectState = await this.buildProjectState(
      this.currentSnapshot,
    );
    return this.currentProjectState;
  }

  async initialize(): Promise<BackendProjectState> {
    return this.enqueue(() => this.ensureInitialized());
  }

  private async findProject(fileName: string): Promise<Project | undefined> {
    const snapshot = this.currentSnapshot;
    if (!snapshot) return undefined;
    const defaultProject = await snapshot.getDefaultProjectForFile(fileName);
    if (defaultProject) return defaultProject;

    for (const project of snapshot.getProjects()) {
      if (await project.program.getSourceFile(fileName)) return project;
    }
    return undefined;
  }

  private scheduleDrain(): void {
    void this.enqueue(async () => {
      if (this.pending.size === 0) return;
      const batch = [...this.pending.values()];
      for (const { change } of batch) this.pending.delete(change.revision);
      await this.transition(batch);
    });
  }

  private async transition(batch: readonly PendingUpdate[]): Promise<void> {
    const batchRevision = Math.max(
      ...batch.map(({ change }) => change.revision),
    );
    const nextOverlay = applyChanges(this.logicalOverlay, batch);
    this.logicalOverlay = nextOverlay;

    if (this.disposed) {
      for (const update of batch) {
        update.deferred.resolve({
          revision: update.change.revision,
          status: "disposed",
        });
      }
      return;
    }

    await this.ensureInitialized();
    this.activeOverlay = nextOverlay;
    const changed: string[] = [];
    const created: string[] = [];
    const deleted: string[] = [];
    for (const { change } of batch) {
      const target =
        change.kind === "create"
          ? created
          : change.kind === "delete"
            ? deleted
            : changed;
      target.push(normalizeBoundaryPath(change.fileName));
    }

    const candidate = await this.api?.updateSnapshot({
      fileChanges: {
        ...(changed.length > 0 ? { changed } : {}),
        ...(created.length > 0 ? { created } : {}),
        ...(deleted.length > 0 ? { deleted } : {}),
      },
    });
    if (!candidate) throw new Error("Native snapshot transition did not start");
    this.instrumentation.snapshotsAdded += 1;

    if (this.disposed) {
      await candidate.dispose();
      this.instrumentation.snapshotsDisposed += 1;
      for (const update of batch) {
        update.deferred.resolve({
          revision: update.change.revision,
          status: "disposed",
        });
      }
      return;
    }

    if (batchRevision < this.latestRequestedRevision) {
      await candidate.dispose();
      this.instrumentation.snapshotsDisposed += 1;
      for (const update of batch) {
        update.deferred.resolve({
          revision: update.change.revision,
          status: "superseded",
          supersededBy: this.latestRequestedRevision,
        });
      }
      return;
    }

    const oldSnapshot = this.currentSnapshot;
    this.currentSnapshot = candidate;
    this.currentRevision = batchRevision;
    this.currentProjectState = await this.buildProjectState(candidate);
    if (oldSnapshot && oldSnapshot !== candidate) {
      await oldSnapshot.dispose();
      this.instrumentation.snapshotsDisposed += 1;
    }

    for (const update of batch) {
      if (update.change.revision === batchRevision) {
        update.deferred.resolve({
          project: this.currentProjectState,
          revision: batchRevision,
          status: "ready",
        });
      } else {
        update.deferred.resolve({
          revision: update.change.revision,
          status: "superseded",
          supersededBy: batchRevision,
        });
      }
    }
  }

  async update({
    affectedComponentFiles,
    change,
  }: Parameters<DocgenBackend["update"]>[0]): Promise<FileUpdateResult> {
    this.instrumentation.updateRequests += 1;
    if (this.disposed) {
      return {
        ready: Promise.resolve({
          revision: change.revision,
          status: "disposed",
        }),
        revision: change.revision,
        status: "pending",
      };
    }

    if (
      this.currentProjectState?.configFiles.includes(
        normalizeBoundaryPath(change.fileName),
      )
    ) {
      await this.reset({ revision: change.revision });
      return { revision: change.revision, status: "project-reset" };
    }

    this.latestRequestedRevision = Math.max(
      this.latestRequestedRevision,
      change.revision,
    );
    const deferred = createDeferred<UpdateCompletion>();
    this.pending.set(change.revision, {
      affected: affectedComponentFiles.map(normalizeBoundaryPath),
      change: {
        ...change,
        fileName: normalizeBoundaryPath(change.fileName),
      },
      deferred,
    });
    this.scheduleDrain();
    return {
      ready: deferred.promise,
      revision: change.revision,
      status: "pending",
    };
  }

  async analyze({
    fileName,
    revision,
    source,
  }: Parameters<DocgenBackend["analyze"]>[0]): Promise<AnalyzeResult> {
    this.instrumentation.analyzeCalls += 1;
    const normalizedFile = normalizeBoundaryPath(fileName);
    const overlayValue = this.logicalOverlay.get(normalizedFile);
    const diskValue = existsSync(normalizedFile)
      ? readFileSync(normalizedFile, "utf-8")
      : undefined;
    if ((overlayValue === undefined ? diskValue : overlayValue) !== source) {
      const result = await this.update({
        affectedComponentFiles: [normalizedFile],
        change: {
          fileName: normalizedFile,
          kind: existsSync(normalizedFile) ? "change" : "create",
          revision,
          source,
        },
      });
      if (result.status === "pending") await result.ready;
    }

    return this.enqueue(async () => {
      try {
        const projectState = await this.ensureInitialized();
        const project = await this.findProject(normalizedFile);
        const sourceFile = await project?.program.getSourceFile(normalizedFile);
        if (!project || !sourceFile) {
          throw new Error(`Native project does not contain ${normalizedFile}`);
        }
        const extraction = await extractNativeComponents({
          fileName: normalizedFile,
          options: this.options,
          project,
          sourceFile,
        });
        this.instrumentation.extractor = {
          checkerRequests:
            this.instrumentation.extractor.checkerRequests +
            extraction.instrumentation.checkerRequests,
          componentCount:
            this.instrumentation.extractor.componentCount +
            extraction.instrumentation.componentCount,
          propCount:
            this.instrumentation.extractor.propCount +
            extraction.instrumentation.propCount,
        };
        return {
          components: extraction.components,
          dependencies: extraction.dependencies,
          project: projectState,
          revision: Math.max(revision, this.currentRevision),
          status: "ok",
        };
      } catch (error) {
        const project =
          this.currentProjectState ??
          ({
            configFiles: [this.configFile],
            docgenFiles: [],
            generation: this.currentRevision,
            trackedFiles: [],
          } satisfies BackendProjectState);
        let dependencies: readonly string[] = [normalizedFile];
        const nativeProject = await this.findProject(normalizedFile).catch(
          () => undefined,
        );
        if (nativeProject) {
          dependencies = await collectNativeDependencies(
            nativeProject,
            normalizedFile,
          ).catch(() => dependencies);
        }
        return {
          dependencies,
          error: toBackendErrorRecord(error),
          project,
          revision: Math.max(revision, this.currentRevision),
          status: "error",
        };
      }
    });
  }

  recordCacheHit(): void {
    this.instrumentation.cacheHits += 1;
  }

  async reset({ revision }: { revision: number }): Promise<ResetCompletion> {
    this.latestRequestedRevision = Math.max(
      this.latestRequestedRevision,
      revision,
    );
    return this.enqueue(async () => {
      if (this.disposed) return { revision, status: "disposed" };
      for (const update of this.pending.values()) {
        update.deferred.resolve({
          revision: update.change.revision,
          status: "disposed",
        });
      }
      this.pending.clear();
      if (this.currentSnapshot) {
        await this.currentSnapshot.dispose();
        this.instrumentation.snapshotsDisposed += 1;
      }
      await this.api?.close();
      this.api = undefined;
      this.currentSnapshot = undefined;
      this.currentProjectState = undefined;
      this.currentRevision = revision;
      return { revision, status: "reset" };
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const update of this.pending.values()) {
      update.deferred.resolve({
        revision: update.change.revision,
        status: "disposed",
      });
    }
    this.pending.clear();
    await this.serial;
    if (this.currentSnapshot && !this.currentSnapshot.isDisposed()) {
      await this.currentSnapshot.dispose();
      this.instrumentation.snapshotsDisposed += 1;
    }
    await this.api?.close();
    this.currentSnapshot = undefined;
    this.api = undefined;
  }
}

export const createNativeBackendFactory = (
  options: NativeBackendOptions,
  alias: NativeAlias = "typescript7",
): DocgenBackendFactory => ({
  create: async ({ rootDir, selection }) =>
    new NativeDocgenBackend({ alias, options, rootDir, selection }),
  describe({ rootDir }): BackendDescriptor {
    return {
      cacheFingerprint: JSON.stringify({
        alias,
        extractorSchema: 1,
        options,
        rootDir: path.resolve(rootDir),
        version: readNativeVersion(alias),
      }),
      id: `native-${alias}`,
    };
  },
});
