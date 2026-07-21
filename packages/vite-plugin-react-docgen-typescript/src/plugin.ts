import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ModuleNode, Plugin, ResolvedConfig, ViteDevServer } from "vite";
import { normalizePath } from "vite";
import type {
  AnalyzeResult,
  BackendDescriptor,
  BackendProjectState,
  DocgenBackend,
  DocgenBackendFactory,
} from "./docgen/backend";
import { normalizeBoundaryPath } from "./docgen/pathIdentity";
import {
  clearFileSystemTransformCache,
  createFileSelectionFingerprint,
  createFileSystemCacheNamespace,
  createFileSystemCacheProof,
  deleteFileSystemTransformCache,
  type FileSystemCacheProof,
  isFileSystemCacheProofValid,
  readFileSystemTransformCache,
  resolveFileSystemCacheOptions,
  writeFileSystemTransformCache,
} from "./utils/cache";
import type { ResolvedFileSelection } from "./utils/fileSelection";
import { generateDocgenCodeBlock } from "./utils/generate";
import { getGenerateOptions, type Options } from "./utils/options";

type Filepath = string;
type TransformResult = { code: string; map: null } | null | string;
type CachedTransformResult = { code: string; map: null } | null;
type TrackedDependencies = readonly string[] | undefined;

interface TransformCacheEntry {
  dependencies: TrackedDependencies;
  result: TransformResult;
  source: string;
}

const cleanModuleId = (id: string) => id.split("?", 1)[0];
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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
  const disposedBackends = new WeakSet<DocgenBackend>();

  const pendingAffectedFiles = new Set<Filepath>();
  const moduleDependencies = new Map<Filepath, Set<Filepath>>();
  const moduleFilesByDependency = new Map<Filepath, Set<Filepath>>();
  const transformedModuleFiles = new Set<string>();
  const transformCache = new Map<Filepath, TransformCacheEntry>();
  const warnedMessages = new Set<string>();

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
  ) => {
    transformedModuleFiles.add(moduleFile);
    clearTrackedModuleDependencies(moduleFile);
    if (!dependencies || dependencies.length === 0) return;
    const normalizedDependencies = new Set(
      dependencies.map((dependencyFile) =>
        normalizeBoundaryPath(dependencyFile),
      ),
    );
    normalizedDependencies.add(moduleFile);
    moduleDependencies.set(moduleFile, normalizedDependencies);
    for (const dependencyFile of normalizedDependencies) {
      const dependentFiles =
        moduleFilesByDependency.get(dependencyFile) ?? new Set<string>();
      dependentFiles.add(moduleFile);
      moduleFilesByDependency.set(dependencyFile, dependentFiles);
    }
  };

  const clearAllTrackedModuleDependencies = () => {
    moduleDependencies.clear();
    moduleFilesByDependency.clear();
  };

  const getAffectedTransformedModuleFiles = (dependencyFile: Filepath) =>
    new Set(moduleFilesByDependency.get(dependencyFile) ?? []);

  const getBackend = async () => {
    if (didDispose) throw new Error("Docgen plugin has been disposed");
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
      const activeBackend = await getBackend();
      projectState = await activeBackend.initialize();
      return activeBackend;
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

  const invalidateTransformedModules = (
    server: ViteDevServer,
    affectedFiles: Iterable<Filepath>,
  ) => {
    for (const transformedFile of affectedFiles) {
      const affectedModules =
        server.moduleGraph.getModulesByFile(transformedFile);
      if (!affectedModules) continue;
      for (const module of affectedModules) {
        server.moduleGraph.invalidateModule(
          module,
          undefined,
          Date.now(),
          true,
        );
      }
    }
  };

  const collectTransformedModules = (
    server: ViteDevServer,
    affectedFiles: Iterable<Filepath>,
    contextModules: readonly ModuleNode[],
  ): ModuleNode[] | undefined => {
    const modules = new Set(contextModules);
    for (const transformedFile of affectedFiles) {
      const affectedModules =
        server.moduleGraph.getModulesByFile(transformedFile) ??
        server.moduleGraph.getModulesByFile(normalizePath(transformedFile));
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

  const readCachedTransform = (
    pluginContext: { warn(message: string): void },
    normalizedFileId: string,
    source: string,
  ):
    | {
        dependencies: TrackedDependencies;
        proof: FileSystemCacheProof;
        result: CachedTransformResult;
      }
    | undefined => {
    if (!fileSystemCacheDirectory || !backendDescriptor) return undefined;
    try {
      const cached = readFileSystemTransformCache(
        fileSystemCacheDirectory,
        normalizedFileId,
        source,
      );
      return cached &&
        isFileSystemCacheProofValid(cached.proof, {
          backendFingerprint: backendDescriptor.cacheFingerprint,
          componentFile: normalizedFileId,
          selectionFingerprint,
        })
        ? cached
        : undefined;
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
            selectionFingerprint,
          }),
          result,
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

  const teardown = async () => {
    if (didDispose) return;
    didDispose = true;
    transformCache.clear();
    clearAllTrackedModuleDependencies();
    transformedModuleFiles.clear();
    pendingAffectedFiles.clear();
    const activeBackend =
      backend ?? (await backendPromise?.catch(() => undefined));
    await disposeBackend(activeBackend);
    backend = undefined;
    backendPromise = undefined;
    backendInitializationPromise = undefined;
    projectState = undefined;
  };

  return {
    enforce: "pre",
    name: "vite:react-docgen-typescript",
    async configResolved(resolvedConfig?: ResolvedConfig) {
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
    async transform(src, id) {
      const normalizedFileId = normalizeBoundaryPath(cleanModuleId(id));
      if (!fileSelection?.matchesDocgenFile(normalizedFileId)) return;

      const memoryCachedTransform = transformCache.get(normalizedFileId);
      if (memoryCachedTransform?.source === src) {
        backend?.recordCacheHit({
          cache: "memory",
          fileName: normalizedFileId,
        });
        return memoryCachedTransform.result;
      }

      const persistedCachedTransform = readCachedTransform(
        this,
        normalizedFileId,
        src,
      );
      if (persistedCachedTransform) {
        backend?.recordCacheHit({
          cache: "persistent",
          fileName: normalizedFileId,
        });
        transformCache.set(normalizedFileId, {
          dependencies: persistedCachedTransform.dependencies,
          result: persistedCachedTransform.result,
          source: src,
        });
        trackModuleDependencies(
          normalizedFileId,
          persistedCachedTransform.dependencies,
        );
        return persistedCachedTransform.result;
      }

      const activeBackend = await initializeBackend();
      if (!projectState?.docgenFiles.includes(normalizedFileId)) {
        trackModuleDependencies(normalizedFileId, undefined);
        warnOnce(
          this,
          `${normalizedFileId}:excluded-from-typescript-project`,
          projectState && projectState.configFiles.length > 0
            ? `Skipping docgen for "${normalizedFileId}" because it matches the plugin patterns but is not a member of the configured TypeScript project.`
            : `Skipping docgen for "${normalizedFileId}" because it matched the plugin patterns but was not present during initial discovery; restart the Vite server to include newly created files.`,
        );
        return src;
      }

      let analysisRevision: number;
      let analysis: AnalyzeResult;
      do {
        analysisRevision = revision;
        analysis = await activeBackend.analyze({
          fileName: normalizedFileId,
          revision: analysisRevision,
          source: src,
        });
      } while (analysisRevision !== revision);
      projectState = analysis.project;
      if (analysis.status === "error") {
        warnOnce(
          this,
          `${normalizedFileId}:${analysis.error.message}`,
          `Failed to generate docgen for "${normalizedFileId}": ${analysis.error.message}`,
        );
        trackModuleDependencies(normalizedFileId, analysis.dependencies);
        return src;
      }

      const result =
        analysis.components.length === 0
          ? null
          : generateDocgenCodeBlock({
              componentDocs: analysis.components,
              filename: normalizedFileId,
              source: src,
              ...getGenerateOptions(config),
            });
      transformCache.set(normalizedFileId, {
        dependencies: analysis.dependencies,
        result,
        source: src,
      });
      writeCachedTransform(
        this,
        normalizedFileId,
        src,
        analysis.dependencies,
        result,
        analysis.project,
      );
      trackModuleDependencies(normalizedFileId, analysis.dependencies);
      return result;
    },
    async handleHotUpdate({ file, modules, server }) {
      const normalizedFile = normalizeBoundaryPath(cleanModuleId(file));
      const isConfigChange =
        projectState?.configFiles.includes(normalizedFile) ?? false;
      const affectedFiles = isConfigChange
        ? new Set(transformedModuleFiles)
        : getAffectedTransformedModuleFiles(normalizedFile);
      const isPotentialTypescriptFile = /\.[cm]?[jt]sx?$/.test(normalizedFile);
      const isTracked = projectState
        ? isConfigChange ||
          projectState.trackedFiles.includes(normalizedFile) ||
          (projectState.configFiles.length === 0 && isPotentialTypescriptFile)
        : isPotentialTypescriptFile;
      if (!isTracked) return;

      revision += 1;
      if (isConfigChange) {
        pendingAffectedFiles.clear();
        transformCache.clear();
        clearAllTrackedModuleDependencies();
        clearPersistentCache();
      } else {
        deleteCachedTransforms(this, affectedFiles);
      }

      if (!backend) {
        invalidateTransformedModules(server, affectedFiles);
        return;
      }

      const update = await backend.update({
        affectedComponentFiles: [...affectedFiles],
        change: existsSync(normalizedFile)
          ? {
              fileName: normalizedFile,
              kind: projectState?.trackedFiles.includes(normalizedFile)
                ? "change"
                : "create",
              revision,
              source: readFileSync(normalizedFile, "utf-8"),
            }
          : { fileName: normalizedFile, kind: "delete", revision },
      });

      if (update.status === "project-reset") {
        pendingAffectedFiles.clear();
        projectState = undefined;
        backendInitializationPromise = undefined;
        invalidateTransformedModules(server, transformedModuleFiles);
        return;
      }
      if (update.status === "ready") projectState = update.project;
      if (update.status === "pending") {
        for (const affectedFile of affectedFiles) {
          pendingAffectedFiles.add(affectedFile);
        }
        const completion = await update.ready;
        if (completion.status !== "ready") return;
        projectState = completion.project;
        const readyAffectedFiles = new Set(pendingAffectedFiles);
        pendingAffectedFiles.clear();
        return collectTransformedModules(server, readyAffectedFiles, modules);
      }
      return collectTransformedModules(server, affectedFiles, modules);
    },
    async closeBundle() {
      await teardown();
    },
    async buildEnd() {
      await teardown();
    },
  };
}
