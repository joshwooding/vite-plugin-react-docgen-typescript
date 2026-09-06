import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type {
  EnvironmentModuleNode,
  ModuleNode,
  Plugin,
  ResolvedConfig,
  ViteDevServer,
} from "vite";
import { normalizePath } from "vite";
import type {
  AnalyzeInput,
  AnalyzeResult,
  BackendDescriptor,
  BackendProjectState,
  DocgenBackend,
  DocgenBackendFactory,
} from "./docgen/backend";
import {
  normalizeBoundaryPath,
  normalizeBoundaryPaths,
} from "./docgen/pathIdentity";
import {
  clearFileSystemTransformCache,
  createFileSelectionFingerprint,
  createFileSystemCacheNamespace,
  createFileSystemCacheProof,
  deleteFileSystemTransformCache,
  isFileSystemCacheProofValid,
  readFileSystemTransformCache,
  resolveFileSystemCacheOptions,
  writeFileSystemTransformCache,
} from "./utils/cache";
import type { ResolvedFileSelection } from "./utils/fileSelection";
import { generateDocgenCodeBlock } from "./utils/generate";
import {
  getGenerateOptions,
  type InternalBenchmarkAnalysisEvent,
  type InternalBenchmarkPhaseEvent,
  type Options,
} from "./utils/options";

type Filepath = string;
type TransformResult = { code: string; map: null } | null | string;
type CachedTransformResult = { code: string; map: null } | null;
type TrackedDependencies = readonly string[] | undefined;
type UpdateKind = "create" | "delete" | "update";
type UpdateModule = EnvironmentModuleNode | ModuleNode;

interface LogicalUpdateResult {
  affectedFiles: ReadonlySet<Filepath>;
  handled: boolean;
  invalidatesLegacyModules: boolean;
}

interface ModuleGraphBoundary<TModule extends UpdateModule> {
  getModulesByFile(file: string): Set<TModule> | undefined;
}

interface TransformCacheEntry {
  dependencies: TrackedDependencies;
  result: TransformResult;
  source: string;
  unresolvedDependencies: readonly string[];
}

interface PreparedAnalysis {
  readonly result: AnalyzeResult;
  readonly revision: number;
  readonly source: string;
}

interface EventUpdateEntry {
  promise: Promise<LogicalUpdateResult>;
  settled: boolean;
}

const cleanModuleId = (id: string) => id.split("?", 1)[0];
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const hasOwnOption = (options: Options, key: keyof Options): boolean =>
  Object.hasOwn(options, key);
const IMPORT_SPECIFIER_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s*)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["']([^"']+)["']/g;
const TRANSFORM_HOOK_ID_FILTER = /\.[cm]?[jt]sx?(?:$|[?#])/i;
const UNRESOLVED_MODULE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".d.ts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

export const collectUnresolvedRelativeDependencies = (
  moduleFile: string,
  source: string,
  resolvedDependencies: readonly string[],
) => {
  const resolved = new Set(resolvedDependencies);
  const unresolved = new Set<string>();

  for (const match of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    const specifier = match[1] ?? match[2];
    if (!specifier?.startsWith(".")) continue;
    const unresolvedBase = path.resolve(path.dirname(moduleFile), specifier);
    const candidates = path.extname(unresolvedBase)
      ? [unresolvedBase]
      : [
          ...UNRESOLVED_MODULE_EXTENSIONS.map(
            (extension) => `${unresolvedBase}${extension}`,
          ),
          ...UNRESOLVED_MODULE_EXTENSIONS.map((extension) =>
            path.join(unresolvedBase, `index${extension}`),
          ),
        ];
    for (const candidate of candidates) {
      if (resolved.has(candidate)) break;
      const normalizedCandidate = normalizeBoundaryPath(candidate);
      if (existsSync(candidate)) {
        if (resolved.has(normalizedCandidate)) break;
        continue;
      }
      if (!resolved.has(normalizedCandidate)) {
        unresolved.add(normalizedCandidate);
      }
    }
  }

  return [...unresolved].sort();
};

export function createPlugin(
  config: Options,
  backendFactory: DocgenBackendFactory,
): Plugin {
  let configRoot = process.cwd();
  let fileSelection: ResolvedFileSelection | undefined;
  let fileSystemCacheDirectory: string | null = null;
  let selectionFingerprint = "";
  let backendDescriptor: BackendDescriptor | undefined;
  let backend: DocgenBackend | undefined;
  let backendPromise: Promise<DocgenBackend> | undefined;
  let backendInitializationPromise: Promise<DocgenBackend> | undefined;
  let projectState: BackendProjectState | undefined;
  let revision = 0;
  let didDispose = false;
  let isTearingDown = false;
  let devServer: ViteDevServer | undefined;
  let legacyAddHandler: ((fileName: string) => void) | undefined;
  let legacyUnlinkHandler: ((fileName: string) => void) | undefined;
  let dependencyUnlinkHandler: ((fileName: string) => void) | undefined;
  let teardownPromise: Promise<void> | undefined;
  const disposedBackends = new WeakSet<DocgenBackend>();

  const eventUpdatesByRead = new WeakMap<
    () => Promise<string> | string,
    Promise<LogicalUpdateResult>
  >();
  const eventUpdates = new Map<string, EventUpdateEntry>();
  const hookUpdateTasks = new Set<Promise<unknown>>();
  const legacyListenerTasks = new Set<Promise<void>>();
  const pendingAffectedFiles = new Set<Filepath>();
  const moduleDependencies = new Map<Filepath, Set<Filepath>>();
  const moduleFilesByDependency = new Map<Filepath, Set<Filepath>>();
  const transformedModuleFiles = new Set<string>();
  const transformCache = new Map<Filepath, TransformCacheEntry>();
  const preparedAnalyses = new Map<Filepath, PreparedAnalysis>();
  const cachedConfigFiles = new Set<Filepath>();
  const warnedMessages = new Set<string>();

  const emitBenchmarkPhase = (event: InternalBenchmarkPhaseEvent) => {
    try {
      config.__benchmark?.onPhase?.(event);
    } catch {
      // Benchmark instrumentation is observational and must not affect Vite.
    }
  };

  const emitBenchmarkAnalysis = (event: InternalBenchmarkAnalysisEvent) => {
    try {
      config.__benchmark?.onAnalysis?.(event);
    } catch {
      // Benchmark instrumentation is observational and must not affect Vite.
    }
  };

  const disposeBackend = async (candidate: DocgenBackend | undefined) => {
    if (!candidate || disposedBackends.has(candidate)) return;
    disposedBackends.add(candidate);
    await candidate.dispose();
  };

  const warnOnce = (
    pluginContext: { warn(message: string): void },
    key: string,
    message: string,
  ) => {
    if (warnedMessages.has(key)) return;
    warnedMessages.add(key);
    pluginContext.warn(message);
  };

  const clearTrackedModuleDependencies = (moduleFile: Filepath) => {
    const trackedDependencies = moduleDependencies.get(moduleFile);
    if (!trackedDependencies) return;
    for (const dependencyFile of trackedDependencies) {
      const dependentModuleFiles = moduleFilesByDependency.get(dependencyFile);
      dependentModuleFiles?.delete(moduleFile);
      if (dependentModuleFiles?.size === 0) {
        moduleFilesByDependency.delete(dependencyFile);
      }
    }
    moduleDependencies.delete(moduleFile);
  };

  const trackModuleDependencies = (
    moduleFile: Filepath,
    dependencies: TrackedDependencies,
    unresolvedDependencies: readonly string[] = [],
  ) => {
    transformedModuleFiles.add(moduleFile);
    clearTrackedModuleDependencies(moduleFile);
    if (
      (!dependencies || dependencies.length === 0) &&
      unresolvedDependencies.length === 0
    ) {
      return;
    }
    const trackedDependencies = new Set([
      ...(dependencies ?? []),
      ...unresolvedDependencies,
    ]);
    trackedDependencies.add(moduleFile);
    moduleDependencies.set(moduleFile, trackedDependencies);
    for (const dependencyFile of trackedDependencies) {
      const dependentFiles =
        moduleFilesByDependency.get(dependencyFile) ?? new Set<string>();
      dependentFiles.add(moduleFile);
      moduleFilesByDependency.set(dependencyFile, dependentFiles);
    }
  };

  const watchFiles = (
    context: { addWatchFile?: (fileName: string) => void },
    files: readonly string[],
  ) => {
    for (const fileName of [...new Set(files)].sort()) {
      if (!existsSync(fileName)) continue;
      const viteFileName = normalizePath(fileName);
      // Serve watches use the existing reverse index for HMR, without creating import edges.
      if (devServer) devServer.watcher.add(viteFileName);
      else context.addWatchFile?.(viteFileName);
    }
  };

  const clearAllTrackedModuleDependencies = () => {
    moduleDependencies.clear();
    moduleFilesByDependency.clear();
  };

  const getAffectedTransformedModuleFiles = (dependencyFile: Filepath) =>
    new Set(moduleFilesByDependency.get(dependencyFile) ?? []);

  const getBackend = async () => {
    if (isTearingDown || didDispose) {
      throw new Error("Docgen plugin is shutting down");
    }
    if (backend) return backend;
    if (!fileSelection) {
      throw new Error("Internal error: file selection was not initialized");
    }
    backendPromise ??= backendFactory.create({
      rootDir: configRoot,
      selection: fileSelection,
    });
    try {
      const createdBackend = await backendPromise;
      if (didDispose) {
        await disposeBackend(createdBackend);
        throw new Error("Docgen plugin has been disposed");
      }
      backend = createdBackend;
      return backend;
    } catch (error) {
      backendPromise = undefined;
      throw error;
    }
  };

  const initializeBackend = async () => {
    backendInitializationPromise ??= (async () => {
      const shouldMeasure = config.__benchmark?.onPhase !== undefined;
      const startedAt = shouldMeasure ? performance.now() : 0;
      try {
        const activeBackend = await getBackend();
        projectState = await activeBackend.initialize();
        if (shouldMeasure) {
          emitBenchmarkPhase({
            durationMs: performance.now() - startedAt,
            fileCount: projectState.docgenFiles.length,
            phase: "backend-initialize",
            revision,
            status: "completed",
          });
        }
        return activeBackend;
      } catch (error) {
        if (shouldMeasure) {
          emitBenchmarkPhase({
            durationMs: performance.now() - startedAt,
            fileCount: 0,
            phase: "backend-initialize",
            revision,
            status: "failed",
          });
        }
        throw error;
      }
    })();
    try {
      return await backendInitializationPromise;
    } catch (error) {
      backendInitializationPromise = undefined;
      await disposeBackend(backend);
      backend = undefined;
      backendPromise = undefined;
      throw error;
    }
  };

  const clearPersistentCache = () => {
    if (!fileSystemCacheDirectory) return;
    try {
      clearFileSystemTransformCache(fileSystemCacheDirectory);
    } catch {
      // Cache cleanup is best effort and must never fail a transform.
    }
  };

  const collectTransformedModules = <TModule extends UpdateModule>(
    moduleGraph: ModuleGraphBoundary<TModule>,
    affectedFiles: Iterable<Filepath>,
    contextModules: readonly TModule[],
  ): TModule[] | undefined => {
    const modules = new Set(contextModules);
    for (const transformedFile of affectedFiles) {
      const affectedModules =
        moduleGraph.getModulesByFile(transformedFile) ??
        moduleGraph.getModulesByFile(normalizePath(transformedFile));
      if (!affectedModules) continue;
      for (const module of affectedModules) modules.add(module);
    }
    return modules.size > 0 ? [...modules] : undefined;
  };

  const deleteCachedTransforms = (
    pluginContext: { warn(message: string): void },
    affectedFiles: Iterable<Filepath>,
  ) => {
    for (const affectedFile of affectedFiles) {
      preparedAnalyses.delete(affectedFile);
      const cachedTransform = transformCache.get(affectedFile);
      if (fileSystemCacheDirectory && cachedTransform) {
        try {
          deleteFileSystemTransformCache(
            fileSystemCacheDirectory,
            affectedFile,
            cachedTransform.source,
          );
        } catch (error) {
          warnOnce(
            pluginContext,
            `${fileSystemCacheDirectory}:file-system-cache-delete:${affectedFile}:${getErrorMessage(error)}`,
            `Failed to delete the docgen file-system cache entry for "${affectedFile}" at "${fileSystemCacheDirectory}": ${getErrorMessage(error)}`,
          );
        }
      }
      transformCache.delete(affectedFile);
    }
  };

  const prepareAffectedAnalyses = async (
    activeBackend: DocgenBackend,
    affectedFiles: ReadonlySet<Filepath>,
  ) => {
    if (!activeBackend.analyzeMany || affectedFiles.size < 2) return;
    const preparedRevision = revision;
    const inputs: AnalyzeInput[] = [];
    for (const fileName of [...affectedFiles].sort()) {
      if (
        !fileSelection?.matchesDocgenFile(fileName) ||
        !projectState?.docgenFiles.includes(fileName) ||
        !existsSync(fileName)
      ) {
        continue;
      }
      try {
        inputs.push({
          fileName,
          revision: preparedRevision,
          source: readFileSync(fileName, "utf-8"),
        });
      } catch {
        // The file may disappear between dependency collection and prefetch.
        // Its transform will use the ordinary single-file path if it returns.
      }
    }
    if (inputs.length < 2) return;

    const shouldMeasure =
      config.__benchmark?.onPhase !== undefined ||
      config.__benchmark?.onAnalysis !== undefined;
    const startedAt = shouldMeasure ? performance.now() : 0;
    try {
      const results = await activeBackend.analyzeMany(inputs);
      if (results.length !== inputs.length) {
        throw new Error(
          `Backend returned ${results.length} results for ${inputs.length} analysis inputs`,
        );
      }
      if (preparedRevision !== revision) return;
      const durationMs = shouldMeasure ? performance.now() - startedAt : 0;
      for (const [index, input] of inputs.entries()) {
        const result = results[index];
        if (!result || result.revision !== preparedRevision) continue;
        preparedAnalyses.set(input.fileName, {
          result,
          revision: preparedRevision,
          source: input.source,
        });
        if (shouldMeasure) {
          emitBenchmarkAnalysis({
            durationMs: durationMs / inputs.length,
            fileName: input.fileName,
            result,
            revision: preparedRevision,
          });
        }
      }
      if (shouldMeasure) {
        emitBenchmarkPhase({
          durationMs,
          fileCount: inputs.length,
          phase: "backend-analyze",
          revision: preparedRevision,
          status: "completed",
        });
      }
      projectState = results.at(-1)?.project ?? projectState;
    } catch {
      if (shouldMeasure) {
        emitBenchmarkPhase({
          durationMs: performance.now() - startedAt,
          fileCount: inputs.length,
          phase: "backend-analyze",
          revision: preparedRevision,
          status: "failed",
        });
      }
      // Bulk analysis is an optimization. Individual transforms remain the
      // correctness fallback if a backend cannot prepare the whole set.
    }
  };

  const readCachedTransform = async (
    pluginContext: { warn(message: string): void },
    normalizedFileId: string,
    source: string,
  ): Promise<
    | {
        dependencies: TrackedDependencies;
        configFiles: readonly string[];
        result: CachedTransformResult;
        unresolvedDependencies?: readonly string[];
      }
    | undefined
  > => {
    if (!fileSystemCacheDirectory || !backendDescriptor) return undefined;
    try {
      const cached = readFileSystemTransformCache(
        fileSystemCacheDirectory,
        normalizedFileId,
        source,
      );
      if (!cached) return undefined;
      const validationRevision = revision;
      const activeBackend = await initializeBackend();
      const validation = await activeBackend.prepareCacheValidation?.({
        fileName: normalizedFileId,
        revision: validationRevision,
        source,
      });
      if (
        !validation ||
        validationRevision !== revision ||
        isTearingDown ||
        didDispose ||
        !validation.project.docgenFiles.includes(normalizedFileId)
      ) {
        return undefined;
      }
      projectState = validation.project;
      const hasValidProof =
        cached &&
        isFileSystemCacheProofValid(cached.proof, {
          backendFingerprint: backendDescriptor.cacheFingerprint,
          componentFile: normalizedFileId,
          configFiles: validation.project.configFiles,
          dependencies: validation.dependencies,
          selectionFingerprint,
          trackedFiles: validation.project.trackedFiles,
        });
      if (!cached || !hasValidProof) return;
      const unresolvedDependencies = cached.unresolvedDependencies;
      if (
        unresolvedDependencies !== undefined &&
        (!Array.isArray(unresolvedDependencies) ||
          unresolvedDependencies.some(
            (dependency) =>
              typeof dependency !== "string" || existsSync(dependency),
          ))
      ) {
        deleteFileSystemTransformCache(
          fileSystemCacheDirectory,
          normalizedFileId,
          source,
        );
        return;
      }
      return {
        configFiles: [...validation.project.configFiles],
        dependencies: [...validation.dependencies],
        result: cached.result,
        // Serialized candidates cross a disk boundary even when the proof is valid.
        unresolvedDependencies: normalizeBoundaryPaths(
          unresolvedDependencies ?? [],
        ),
      };
    } catch (error) {
      warnOnce(
        pluginContext,
        `${fileSystemCacheDirectory}:file-system-cache-read:${getErrorMessage(error)}`,
        `Failed to read the docgen file-system cache at "${fileSystemCacheDirectory}": ${getErrorMessage(error)}`,
      );
      return undefined;
    }
  };

  const writeCachedTransform = (
    pluginContext: { warn(message: string): void },
    normalizedFileId: string,
    source: string,
    dependencies: readonly string[],
    unresolvedDependencies: readonly string[],
    result: CachedTransformResult,
    state: BackendProjectState,
  ) => {
    if (!fileSystemCacheDirectory || !backendDescriptor) return;
    try {
      writeFileSystemTransformCache(
        fileSystemCacheDirectory,
        normalizedFileId,
        source,
        {
          dependencies: [...dependencies],
          proof: createFileSystemCacheProof({
            backendFingerprint: backendDescriptor.cacheFingerprint,
            componentFile: normalizedFileId,
            configFiles: state.configFiles,
            dependencies,
            selectionFingerprint,
            trackedFiles: state.trackedFiles,
          }),
          result,
          unresolvedDependencies: [...unresolvedDependencies],
        },
      );
    } catch (error) {
      warnOnce(
        pluginContext,
        `${fileSystemCacheDirectory}:file-system-cache-write:${getErrorMessage(error)}`,
        `Failed to write the docgen file-system cache at "${fileSystemCacheDirectory}": ${getErrorMessage(error)}`,
      );
    }
  };

  const processLogicalUpdate = async ({
    file,
    kind,
    source,
    warn,
  }: {
    file: string;
    kind: UpdateKind;
    source?: string;
    warn(message: string): void;
  }): Promise<LogicalUpdateResult> => {
    const normalizedFile = normalizeBoundaryPath(cleanModuleId(file));
    const isConfigChange =
      cachedConfigFiles.has(normalizedFile) ||
      (projectState?.configFiles.includes(normalizedFile) ?? false);
    let affectedFiles = isConfigChange
      ? new Set(transformedModuleFiles)
      : getAffectedTransformedModuleFiles(normalizedFile);
    const isPotentialTypescriptFile = /\.[cm]?[jt]sx?$/.test(normalizedFile);
    const wasTracked =
      projectState?.trackedFiles.includes(normalizedFile) ?? false;
    const shouldProcess = projectState
      ? isConfigChange ||
        affectedFiles.size > 0 ||
        wasTracked ||
        (kind === "create" && isPotentialTypescriptFile) ||
        (projectState.configFiles.length === 0 && isPotentialTypescriptFile)
      : isConfigChange || isPotentialTypescriptFile;
    if (!shouldProcess) {
      return {
        affectedFiles,
        handled: false,
        invalidatesLegacyModules: false,
      };
    }

    revision += 1;
    preparedAnalyses.clear();
    if (isConfigChange) {
      pendingAffectedFiles.clear();
      transformCache.clear();
      cachedConfigFiles.clear();
      clearAllTrackedModuleDependencies();
      clearPersistentCache();
    }

    const activeBackend =
      backend ?? (kind === "create" ? await initializeBackend() : undefined);
    if (!activeBackend) {
      if (!isConfigChange) {
        deleteCachedTransforms({ warn }, affectedFiles);
      }
      return {
        affectedFiles,
        handled: affectedFiles.size > 0,
        invalidatesLegacyModules: false,
      };
    }

    const shouldMeasureUpdate = config.__benchmark?.onPhase !== undefined;
    const updateStartedAt = shouldMeasureUpdate ? performance.now() : 0;
    let update: Awaited<ReturnType<DocgenBackend["update"]>>;
    try {
      update = await activeBackend.update({
        affectedComponentFiles: [...affectedFiles],
        change:
          kind === "delete"
            ? { fileName: normalizedFile, kind, revision }
            : {
                fileName: normalizedFile,
                kind: kind === "update" ? "change" : "create",
                revision,
                source: source ?? readFileSync(normalizedFile, "utf-8"),
              },
      });
      if (shouldMeasureUpdate) {
        emitBenchmarkPhase({
          durationMs: performance.now() - updateStartedAt,
          fileCount: affectedFiles.size,
          fileName: normalizedFile,
          phase: "backend-update",
          revision,
          status: "completed",
        });
      }
    } catch (error) {
      if (shouldMeasureUpdate) {
        emitBenchmarkPhase({
          durationMs: performance.now() - updateStartedAt,
          fileCount: affectedFiles.size,
          fileName: normalizedFile,
          phase: "backend-update",
          revision,
          status: "failed",
        });
      }
      throw error;
    }

    if (update.status === "project-reset") {
      pendingAffectedFiles.clear();
      cachedConfigFiles.clear();
      projectState = undefined;
      backendInitializationPromise = undefined;
      affectedFiles = new Set(transformedModuleFiles);
      return {
        affectedFiles,
        handled: true,
        invalidatesLegacyModules: true,
      };
    }
    if (update.status === "ready") projectState = update.project;
    if (update.status === "ignored" && kind === "create") {
      projectState = await activeBackend.initialize();
    }
    if (update.status === "pending") {
      for (const affectedFile of affectedFiles) {
        pendingAffectedFiles.add(affectedFile);
      }
      const completion = await update.ready;
      if (completion.status !== "ready") {
        return {
          affectedFiles: new Set(),
          handled: false,
          invalidatesLegacyModules: false,
        };
      }
      projectState = completion.project;
      affectedFiles = new Set(pendingAffectedFiles);
      pendingAffectedFiles.clear();
    }

    if (
      kind === "create" &&
      affectedFiles.size === 0 &&
      !projectState?.trackedFiles.includes(normalizedFile)
    ) {
      return {
        affectedFiles: new Set(),
        handled: false,
        invalidatesLegacyModules: false,
      };
    }
    if (
      kind === "create" &&
      affectedFiles.size === 0 &&
      projectState?.trackedFiles.includes(normalizedFile) &&
      !fileSelection?.matchesDocgenFile(normalizedFile)
    ) {
      affectedFiles = new Set(transformedModuleFiles);
    }
    if (!isConfigChange) {
      deleteCachedTransforms({ warn }, affectedFiles);
    }
    await prepareAffectedAnalyses(activeBackend, affectedFiles);
    return {
      affectedFiles,
      handled: true,
      invalidatesLegacyModules: false,
    };
  };

  const pruneSettledFallbackEvents = () => {
    if (eventUpdates.size <= 32) return;
    for (const [eventKey, entry] of eventUpdates) {
      if (!entry.settled) continue;
      eventUpdates.delete(eventKey);
      if (eventUpdates.size <= 32) return;
    }
  };

  const processEventOnce = (
    input: Omit<Parameters<typeof processLogicalUpdate>[0], "source"> & {
      read?: () => Promise<string> | string;
      timestamp: number;
    },
  ) => {
    if (isTearingDown || didDispose) {
      return Promise.reject(new Error("Docgen plugin is shutting down"));
    }
    if (input.read) {
      const existing = eventUpdatesByRead.get(input.read);
      if (existing) return existing;
      const task = (async () => {
        const source =
          input.kind === "delete" ? undefined : await input.read?.();
        if (isTearingDown || didDispose) {
          throw new Error("Docgen plugin is shutting down");
        }
        return processLogicalUpdate({ ...input, source });
      })();
      eventUpdatesByRead.set(input.read, task);
      return task;
    }
    return (async () => {
      const source =
        input.kind === "delete" ? undefined : readFileSync(input.file, "utf-8");
      const sourceFingerprint =
        source === undefined
          ? "deleted"
          : createHash("sha256").update(source).digest("hex");
      const eventKey = `${input.kind}\0${normalizeBoundaryPath(input.file)}\0${input.timestamp}\0${sourceFingerprint}`;
      const existing = eventUpdates.get(eventKey);
      if (existing) return existing.promise;
      const task = processLogicalUpdate({ ...input, source });
      const entry: EventUpdateEntry = { promise: task, settled: false };
      eventUpdates.set(eventKey, entry);
      void task.then(
        () => {
          entry.settled = true;
          pruneSettledFallbackEvents();
        },
        () => {
          entry.settled = true;
          pruneSettledFallbackEvents();
        },
      );
      pruneSettledFallbackEvents();
      return task;
    })();
  };

  const trackHookUpdate = <T>(work: () => Promise<T>): Promise<T> => {
    if (isTearingDown || didDispose) {
      return Promise.reject(new Error("Docgen plugin is shutting down"));
    }
    const task = work();
    hookUpdateTasks.add(task);
    void task.then(
      () => hookUpdateTasks.delete(task),
      () => hookUpdateTasks.delete(task),
    );
    return task;
  };

  const sendLegacyListenerError = (server: ViteDevServer, error: unknown) => {
    if (isTearingDown || didDispose) return;
    const message = getErrorMessage(error);
    server.config.logger.error(message);
    server.ws.send({
      err: {
        message,
        stack: error instanceof Error ? (error.stack ?? message) : message,
      },
      type: "error",
    });
  };

  const runLegacyListenerUpdate = (
    server: ViteDevServer,
    fileName: string,
    kind: "create" | "delete",
  ) => {
    const task = (async () => {
      const result = await processEventOnce({
        file: fileName,
        kind,
        read:
          kind === "create" ? () => readFileSync(fileName, "utf-8") : undefined,
        timestamp: Date.now(),
        warn: (message) => server.config.logger.warn(message),
      });
      if (!result.handled) return;
      if (isTearingDown || didDispose) return;
      const modules = collectTransformedModules(
        server.moduleGraph,
        result.affectedFiles,
        [],
      );
      for (const module of new Set(modules ?? [])) {
        if (isTearingDown || didDispose) return;
        await server.reloadModule(module);
      }
    })().catch((error: unknown) => {
      sendLegacyListenerError(server, error);
    });
    legacyListenerTasks.add(task);
    void task.finally(() => {
      legacyListenerTasks.delete(task);
    });
  };

  const teardown = () => {
    teardownPromise ??= (async () => {
      if (didDispose) return;
      isTearingDown = true;
      if (devServer && legacyAddHandler && legacyUnlinkHandler) {
        devServer.watcher.off("add", legacyAddHandler);
        devServer.watcher.off("unlink", legacyUnlinkHandler);
      }
      if (devServer && dependencyUnlinkHandler) {
        devServer.watcher.off("unlink", dependencyUnlinkHandler);
      }
      dependencyUnlinkHandler = undefined;
      legacyAddHandler = undefined;
      legacyUnlinkHandler = undefined;
      devServer = undefined;
      await Promise.allSettled([...hookUpdateTasks, ...legacyListenerTasks]);
      didDispose = true;
      preparedAnalyses.clear();
      transformCache.clear();
      cachedConfigFiles.clear();
      clearAllTrackedModuleDependencies();
      transformedModuleFiles.clear();
      pendingAffectedFiles.clear();
      eventUpdates.clear();
      const activeBackend =
        backend ?? (await backendPromise?.catch(() => undefined));
      await disposeBackend(activeBackend);
      backend = undefined;
      backendPromise = undefined;
      backendInitializationPromise = undefined;
      projectState = undefined;
    })();
    return teardownPromise;
  };

  return {
    enforce: "pre",
    name: "vite:react-docgen-typescript",
    async configResolved(resolvedConfig?: ResolvedConfig) {
      const pluginContext = this as unknown as {
        warn?: (message: string) => void;
      };
      if (
        pluginContext?.warn &&
        hasOwnOption(config, "EXPERIMENTAL_useWatchProgram")
      ) {
        warnOnce(
          { warn: pluginContext.warn.bind(pluginContext) },
          "deprecated:EXPERIMENTAL_useWatchProgram",
          'EXPERIMENTAL_useWatchProgram is deprecated; use docgenMode: "project-service" instead.',
        );
      }
      if (
        pluginContext?.warn &&
        hasOwnOption(config, "EXPERIMENTAL_useProjectService")
      ) {
        warnOnce(
          { warn: pluginContext.warn.bind(pluginContext) },
          "deprecated:EXPERIMENTAL_useProjectService",
          'EXPERIMENTAL_useProjectService is deprecated; use docgenMode: "project-service" instead.',
        );
      }
      configRoot = resolvedConfig?.root ?? process.cwd();
      const { resolveFileSelection } = await import("./utils/fileSelection");
      fileSelection = resolveFileSelection(configRoot, config);
      selectionFingerprint = createFileSelectionFingerprint(fileSelection);
      backendDescriptor = backendFactory.describe({ rootDir: configRoot });
      const resolvedCache = resolveFileSystemCacheOptions(config, configRoot);
      fileSystemCacheDirectory = resolvedCache.enabled
        ? path.join(
            resolvedCache.directory,
            createFileSystemCacheNamespace(
              config,
              configRoot,
              backendDescriptor.cacheFingerprint,
            ),
          )
        : null;

      if (config.tsconfigPath) {
        const absoluteTsconfigPath = path.isAbsolute(config.tsconfigPath)
          ? config.tsconfigPath
          : path.resolve(configRoot, config.tsconfigPath);
        if (!existsSync(absoluteTsconfigPath)) {
          throw new Error(
            `Failed to read tsconfig at "${absoluteTsconfigPath}": File does not exist`,
          );
        }
      }

      if (resolvedConfig?.command === "build" && fileSelection.hasIncludes) {
        await initializeBackend();
      }
    },
    configureServer(server) {
      devServer = server;
      dependencyUnlinkHandler = (fileName) => {
        const dependency = normalizeBoundaryPath(fileName);
        const relative = path.relative(configRoot, dependency);
        if (
          !moduleFilesByDependency.has(dependency) ||
          !(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        ) {
          return;
        }
        // Re-arm only this missing file after the watcher closes its old handle.
        const task = Promise.resolve()
          .then(() => {
            if (!isTearingDown && !didDispose) {
              server.watcher.add(normalizePath(dependency));
            }
          })
          .catch((error: unknown) => sendLegacyListenerError(server, error));
        legacyListenerTasks.add(task);
        void task.finally(() => legacyListenerTasks.delete(task));
      };
      server.watcher.on("unlink", dependencyUnlinkHandler);
      if ((server as ViteDevServer & { environments?: unknown }).environments) {
        return;
      }
      legacyAddHandler = (fileName) => {
        runLegacyListenerUpdate(server, fileName, "create");
      };
      legacyUnlinkHandler = (fileName) => {
        runLegacyListenerUpdate(server, fileName, "delete");
      };
      server.watcher.on("add", legacyAddHandler);
      server.watcher.on("unlink", legacyUnlinkHandler);
    },
    transform: {
      filter: { id: TRANSFORM_HOOK_ID_FILTER },
      async handler(src, id) {
        const normalizedFileId = normalizeBoundaryPath(cleanModuleId(id));
        if (!fileSelection?.matchesDocgenFile(normalizedFileId)) return;

        const memoryCachedTransform = transformCache.get(normalizedFileId);
        if (
          !config.__benchmark?.bypassMemoryCache &&
          memoryCachedTransform?.source === src
        ) {
          backend?.recordCacheHit({
            cache: "memory",
            fileName: normalizedFileId,
          });
          return memoryCachedTransform.result;
        }

        const cacheValidationRevision = revision;
        const persistedCachedTransform = await readCachedTransform(
          this,
          normalizedFileId,
          src,
        );
        if (
          persistedCachedTransform &&
          cacheValidationRevision === revision &&
          !isTearingDown &&
          !didDispose
        ) {
          for (const fileName of persistedCachedTransform.configFiles) {
            cachedConfigFiles.add(fileName);
          }
          watchFiles(this, [
            ...persistedCachedTransform.configFiles,
            ...(persistedCachedTransform.dependencies ?? []),
            ...(persistedCachedTransform.unresolvedDependencies ?? []),
          ]);
          backend?.recordCacheHit({
            cache: "persistent",
            fileName: normalizedFileId,
          });
          transformCache.set(normalizedFileId, {
            dependencies: persistedCachedTransform.dependencies,
            result: persistedCachedTransform.result,
            source: src,
            unresolvedDependencies:
              persistedCachedTransform.unresolvedDependencies ?? [],
          });
          trackModuleDependencies(
            normalizedFileId,
            [
              ...(persistedCachedTransform.dependencies ?? []),
              ...persistedCachedTransform.configFiles,
            ],
            persistedCachedTransform.unresolvedDependencies,
          );
          return persistedCachedTransform.result;
        }

        if (isTearingDown || didDispose) {
          throw new Error("Docgen plugin is shutting down");
        }
        const activeBackend = await initializeBackend();
        if (!projectState?.docgenFiles.includes(normalizedFileId)) {
          trackModuleDependencies(normalizedFileId, undefined);
          warnOnce(
            this,
            `${normalizedFileId}:excluded-from-typescript-project`,
            projectState && projectState.configFiles.length > 0
              ? `Skipping docgen for "${normalizedFileId}" because it matches the plugin patterns but is not a member of the configured TypeScript project.`
              : `Skipping docgen for "${normalizedFileId}" because it matches the plugin patterns but is not a member of the active TypeScript project.`,
          );
          return src;
        }

        let analysisRevision = revision;
        let analysis: AnalyzeResult;
        const preparedAnalysis = preparedAnalyses.get(normalizedFileId);
        if (
          preparedAnalysis?.revision === analysisRevision &&
          preparedAnalysis.source === src
        ) {
          analysis = preparedAnalysis.result;
        } else {
          do {
            analysisRevision = revision;
            const shouldMeasureAnalysis =
              config.__benchmark?.onPhase !== undefined ||
              config.__benchmark?.onAnalysis !== undefined;
            const analysisStartedAt = shouldMeasureAnalysis
              ? performance.now()
              : 0;
            try {
              analysis = await activeBackend.analyze({
                fileName: normalizedFileId,
                revision: analysisRevision,
                source: src,
              });
              if (shouldMeasureAnalysis) {
                const durationMs = performance.now() - analysisStartedAt;
                emitBenchmarkPhase({
                  durationMs,
                  fileCount: 1,
                  fileName: normalizedFileId,
                  phase: "backend-analyze",
                  revision: analysisRevision,
                  status: "completed",
                });
                emitBenchmarkAnalysis({
                  durationMs,
                  fileName: normalizedFileId,
                  result: analysis,
                  revision: analysisRevision,
                });
              }
            } catch (error) {
              if (shouldMeasureAnalysis) {
                emitBenchmarkPhase({
                  durationMs: performance.now() - analysisStartedAt,
                  fileCount: 1,
                  fileName: normalizedFileId,
                  phase: "backend-analyze",
                  revision: analysisRevision,
                  status: "failed",
                });
              }
              throw error;
            }
          } while (analysisRevision !== revision);
        }
        projectState = analysis.project;
        const shouldMeasureDependencyDiscovery =
          config.__benchmark?.onPhase !== undefined;
        const dependencyDiscoveryStartedAt = shouldMeasureDependencyDiscovery
          ? performance.now()
          : 0;
        let unresolvedDependencies: string[];
        try {
          unresolvedDependencies = normalizeBoundaryPaths([
            ...(analysis.unresolvedDependencies ?? []),
            ...collectUnresolvedRelativeDependencies(
              normalizedFileId,
              src,
              analysis.dependencies,
            ),
          ]);
          if (shouldMeasureDependencyDiscovery) {
            emitBenchmarkPhase({
              durationMs: performance.now() - dependencyDiscoveryStartedAt,
              fileCount: 1,
              fileName: normalizedFileId,
              phase: "dependency-discovery",
              revision: analysisRevision,
              status: "completed",
            });
          }
        } catch (error) {
          if (shouldMeasureDependencyDiscovery) {
            emitBenchmarkPhase({
              durationMs: performance.now() - dependencyDiscoveryStartedAt,
              fileCount: 1,
              fileName: normalizedFileId,
              phase: "dependency-discovery",
              revision: analysisRevision,
              status: "failed",
            });
          }
          throw error;
        }
        watchFiles(this, [
          ...analysis.project.configFiles,
          ...analysis.dependencies,
          ...unresolvedDependencies,
        ]);
        if (analysis.status === "error") {
          warnOnce(
            this,
            `${normalizedFileId}:${analysis.error.message}`,
            `Failed to generate docgen for "${normalizedFileId}": ${analysis.error.message}`,
          );
          trackModuleDependencies(
            normalizedFileId,
            analysis.dependencies,
            unresolvedDependencies,
          );
          return src;
        }

        const shouldMeasureCodeGeneration =
          config.__benchmark?.onPhase !== undefined;
        const codeGenerationStartedAt = shouldMeasureCodeGeneration
          ? performance.now()
          : 0;
        let result: CachedTransformResult;
        try {
          result =
            analysis.components.length === 0
              ? null
              : generateDocgenCodeBlock({
                  componentDocs: analysis.components,
                  filename: normalizedFileId,
                  source: src,
                  ...getGenerateOptions(config),
                });
          if (shouldMeasureCodeGeneration) {
            emitBenchmarkPhase({
              durationMs: performance.now() - codeGenerationStartedAt,
              fileCount: 1,
              fileName: normalizedFileId,
              phase: "code-generation",
              revision: analysisRevision,
              status: "completed",
            });
          }
        } catch (error) {
          if (shouldMeasureCodeGeneration) {
            emitBenchmarkPhase({
              durationMs: performance.now() - codeGenerationStartedAt,
              fileCount: 1,
              fileName: normalizedFileId,
              phase: "code-generation",
              revision: analysisRevision,
              status: "failed",
            });
          }
          throw error;
        }
        const shouldMeasureTransformCommit =
          config.__benchmark?.onPhase !== undefined;
        const transformCommitStartedAt = shouldMeasureTransformCommit
          ? performance.now()
          : 0;
        try {
          transformCache.set(normalizedFileId, {
            dependencies: analysis.dependencies,
            result,
            source: src,
            unresolvedDependencies,
          });
          writeCachedTransform(
            this,
            normalizedFileId,
            src,
            analysis.dependencies,
            unresolvedDependencies,
            result,
            analysis.project,
          );
          trackModuleDependencies(
            normalizedFileId,
            analysis.dependencies,
            unresolvedDependencies,
          );
          if (shouldMeasureTransformCommit) {
            emitBenchmarkPhase({
              durationMs: performance.now() - transformCommitStartedAt,
              fileCount: 1,
              fileName: normalizedFileId,
              phase: "transform-commit",
              revision: analysisRevision,
              status: "completed",
            });
          }
        } catch (error) {
          if (shouldMeasureTransformCommit) {
            emitBenchmarkPhase({
              durationMs: performance.now() - transformCommitStartedAt,
              fileCount: 1,
              fileName: normalizedFileId,
              phase: "transform-commit",
              revision: analysisRevision,
              status: "failed",
            });
          }
          throw error;
        }
        return result;
      },
    },
    hotUpdate({ file, modules, read, timestamp, type }) {
      return trackHookUpdate(async () => {
        const result = await processEventOnce({
          file,
          kind: type,
          read,
          timestamp,
          warn: (message) => this.warn(message),
        });
        if (!result.handled) return;
        return collectTransformedModules(
          this.environment.moduleGraph,
          result.affectedFiles,
          modules,
        );
      });
    },
    handleHotUpdate({ file, modules, read, server, timestamp }) {
      if ((server as ViteDevServer & { environments?: unknown }).environments) {
        return;
      }
      return trackHookUpdate(async () => {
        const result = await processEventOnce({
          file,
          kind: "update",
          read,
          timestamp,
          warn: (message) => this.warn(message),
        });
        if (!result.handled) return;
        if (result.invalidatesLegacyModules) {
          const affectedModules = collectTransformedModules(
            server.moduleGraph,
            result.affectedFiles,
            [],
          );
          for (const module of new Set(affectedModules ?? [])) {
            server.moduleGraph.invalidateModule(
              module,
              undefined,
              timestamp,
              true,
            );
          }
          return;
        }
        return collectTransformedModules(
          server.moduleGraph,
          result.affectedFiles,
          modules,
        );
      });
    },
    async closeBundle() {
      await teardown();
    },
    async buildEnd() {
      await teardown();
    },
  };
}
