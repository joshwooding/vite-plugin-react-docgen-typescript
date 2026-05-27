import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FileParser } from "react-docgen-typescript";
import type {
  CompilerOptions,
  ModuleResolutionCache,
  Program,
  ProjectReference,
  SemanticDiagnosticsBuilderProgram,
  TypeReferenceDirectiveResolutionCache,
  WatchOptions,
} from "typescript";
import type * as tss from "typescript/lib/tsserverlibrary";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";
import {
  clearFileSystemTransformCache,
  createFileSystemCacheNamespace,
  deleteFileSystemTransformCache,
  readFileSystemTransformCache,
  resolveFileSystemCacheOptions,
  writeFileSystemTransformCache,
} from "./utils/cache";
import { defaultPropFilter } from "./utils/filter";
import type { Options } from "./utils/options";
import { resolveComponentDocRuntimeTargets } from "./utils/runtimeTarget";

type Filepath = string;
type InvalidateModule = () => void;
type CloseWatch = () => void;
type WarnKey = string;
type DependencyCache = Map<Filepath, readonly string[]>;
type RuntimeMode = "default" | "projectService" | "watch";
type TransformResult = { code: string; map: null } | null | string;
type CachedTransformResult = { code: string; map: null } | null;
type ProjectServiceProject = tss.server.Project;
type ProjectServiceOpenFileState = {
  source: string;
};
type TrackedDependencies = readonly string[] | undefined;
type TransformCacheEntry = {
  dependencies: TrackedDependencies;
  result: TransformResult;
  source: string;
};

interface TypescriptProject {
  compilerOptions: CompilerOptions;
  configFiles: string[];
  projectFiles: string[];
  projectName: string;
  projectReferences?: readonly ProjectReference[];
  rootFiles: string[];
  tsconfigPath?: string;
  watchOptions?: WatchOptions;
}

type ConfiguredTypescriptProject = TypescriptProject & {
  tsconfigPath: string;
};

const DEFAULT_INCLUDE = ["**/*.tsx"];
const DEFAULT_EXCLUDE = ["**/*.stories.tsx"];
const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/;
const MAX_OPEN_PROJECT_SERVICE_FILES = 64;
const TYPESCRIPT_FILE_PATTERN = /\.[cm]?[jt]sx?$/;

const hasTsconfigPath = (
  project: TypescriptProject,
): project is ConfiguredTypescriptProject =>
  typeof project.tsconfigPath === "string";

const getDocgen = async (config: Options, compilerOptions: CompilerOptions) => {
  const docGen = await import("react-docgen-typescript");

  const {
    compilerOptions: inlineCompilerOptions,
    exclude,
    include,
    fileSystemCache,
    propFilter = defaultPropFilter,
    setDisplayName,
    shouldIncludePropTagMap,
    tsconfigPath,
    typePropName,
    EXPERIMENTAL_useProjectService,
    EXPERIMENTAL_useWatchProgram,
    ...rest
  } = config;

  const docgenOptions = {
    propFilter,
    ...rest,
    shouldIncludeExpression: true,
    shouldIncludePropTagMap: shouldIncludePropTagMap ?? true,
  };

  return docGen.withCompilerOptions(compilerOptions, docgenOptions);
};

const resolveTsconfigPath = (rootDir: string, tsconfigPath: string) =>
  path.isAbsolute(tsconfigPath)
    ? tsconfigPath
    : path.resolve(rootDir, tsconfigPath);

const resolveRootFilesFromGlobs = async (
  rootDir: string,
  includeArray: string[],
  excludeArray: string[],
) => {
  const { globSync } = await import("tinyglobby");
  const files = new Set<string>();

  for (const filePattern of includeArray) {
    for (const fileName of globSync(filePattern, {
      absolute: true,
      cwd: rootDir,
      ignore: excludeArray,
      onlyFiles: true,
    })) {
      files.add(path.resolve(fileName));
    }
  }

  return [...files].sort();
};

const resolveProjectFilesFromParsedConfig = (
  parsedConfig: import("typescript").ParsedCommandLine,
) => parsedConfig.fileNames.map((fileName) => path.resolve(fileName));

const resolveProjectConfigFiles = (
  tsconfigPath: string | undefined,
  referencedConfigFiles: readonly string[],
) =>
  tsconfigPath
    ? [
        ...new Set([path.resolve(tsconfigPath), ...referencedConfigFiles]),
      ].sort()
    : [];

const resolveReferencedProjectMetadata = (
  typescriptModule: typeof import("typescript"),
  getTSConfigFile: (
    tsconfigPath: string,
  ) => import("typescript").ParsedCommandLine,
  projectReferences?: readonly ProjectReference[],
) => {
  const referencedConfigFiles = new Set<string>();
  const referencedProjectFiles = new Set<string>();
  const pendingProjectReferences = [...(projectReferences ?? [])];

  while (pendingProjectReferences.length > 0) {
    const projectReference = pendingProjectReferences.pop();

    if (!projectReference) {
      continue;
    }

    const referencedConfigPath = path.resolve(
      typescriptModule.resolveProjectReferencePath(projectReference),
    );

    if (referencedConfigFiles.has(referencedConfigPath)) {
      continue;
    }

    referencedConfigFiles.add(referencedConfigPath);

    const parsedReferencedConfig = getTSConfigFile(referencedConfigPath);

    for (const fileName of parsedReferencedConfig.fileNames) {
      referencedProjectFiles.add(path.resolve(fileName));
    }

    pendingProjectReferences.push(
      ...(parsedReferencedConfig.projectReferences ?? []),
    );
  }

  return {
    configFiles: [...referencedConfigFiles].sort(),
    projectFiles: [...referencedProjectFiles].sort(),
  };
};

const resolveDocgenRootFiles = async (
  rootDir: string,
  includeArray: string[],
  excludeArray: string[],
  projectFiles?: string[],
) => {
  const matchedFiles = await resolveRootFilesFromGlobs(
    rootDir,
    includeArray,
    excludeArray,
  );

  if (!projectFiles) {
    return matchedFiles;
  }

  const projectFileSet = new Set(projectFiles);
  const declarationFiles = projectFiles.filter((fileName) =>
    DECLARATION_FILE_PATTERN.test(fileName),
  );

  return [
    ...new Set([
      ...matchedFiles.filter((fileName) => projectFileSet.has(fileName)),
      ...declarationFiles,
    ]),
  ].sort();
};

const resolveTypescriptProject = async (
  config: Options,
  rootDir: string,
): Promise<TypescriptProject> => {
  const { default: ts } = await import("typescript");
  const includeArray = config.include ?? DEFAULT_INCLUDE;
  const excludeArray = config.exclude ?? DEFAULT_EXCLUDE;
  let referencedProjectMetadata: {
    configFiles: string[];
    projectFiles: string[];
  } = {
    configFiles: [],
    projectFiles: [],
  };

  let parsedConfig: import("typescript").ParsedCommandLine | undefined;
  let tsconfigPath: string | undefined;

  if (!config.compilerOptions) {
    const requestedTsconfigPath = config.tsconfigPath ?? "tsconfig.json";
    const absoluteTsconfigPath = resolveTsconfigPath(
      rootDir,
      requestedTsconfigPath,
    );

    if (config.tsconfigPath || ts.sys.fileExists(absoluteTsconfigPath)) {
      const { getTSConfigFile } = await import("./utils/typescript");

      parsedConfig = getTSConfigFile(absoluteTsconfigPath);
      referencedProjectMetadata = resolveReferencedProjectMetadata(
        ts,
        getTSConfigFile,
        parsedConfig.projectReferences,
      );
      tsconfigPath = absoluteTsconfigPath;
    }
  }

  const compilerOptions: CompilerOptions = {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.Latest,
    ...parsedConfig?.options,
    ...config.compilerOptions,
  };

  const projectFiles = parsedConfig
    ? [
        ...new Set([
          ...resolveProjectFilesFromParsedConfig(parsedConfig),
          ...referencedProjectMetadata.projectFiles,
        ]),
      ].sort()
    : await resolveRootFilesFromGlobs(rootDir, includeArray, excludeArray);
  const configFiles = resolveProjectConfigFiles(
    tsconfigPath,
    referencedProjectMetadata.configFiles,
  );

  const rootFiles = parsedConfig
    ? await resolveDocgenRootFiles(
        rootDir,
        includeArray,
        excludeArray,
        projectFiles,
      )
    : projectFiles;

  return {
    compilerOptions,
    configFiles,
    projectFiles,
    projectName:
      tsconfigPath ??
      path.join(rootDir, ".react-docgen-typescript.external-project"),
    projectReferences: parsedConfig?.projectReferences,
    rootFiles,
    tsconfigPath,
    watchOptions: parsedConfig?.watchOptions,
  };
};

const createProgram = async (
  project: TypescriptProject,
  oldProgram?: SemanticDiagnosticsBuilderProgram,
) => {
  const { default: ts } = await import("typescript");
  const host = ts.createIncrementalCompilerHost(
    project.compilerOptions,
    ts.sys,
  );

  return ts.createSemanticDiagnosticsBuilderProgram(
    project.rootFiles,
    project.compilerOptions,
    host,
    oldProgram,
    undefined,
    project.projectReferences,
  );
};

const doNothing = (): void => {};
const createStubFileWatcher = (): tss.FileWatcher => ({
  close: doNothing,
});

const createProjectService = async (project: TypescriptProject) => {
  const { default: tsserver } = await import(
    "typescript/lib/tsserverlibrary.js"
  );
  const projectServiceRootFiles = project.tsconfigPath
    ? project.configFiles
    : project.rootFiles;

  const system: tss.server.ServerHost = {
    ...tsserver.sys,
    clearImmediate,
    clearTimeout,
    setImmediate,
    setTimeout,
    watchDirectory: createStubFileWatcher,
    watchFile: createStubFileWatcher,
  };

  const projectService = new tsserver.server.ProjectService({
    cancellationToken: { isCancellationRequested: (): boolean => false },
    host: system,
    jsDocParsingMode: 0,
    logger: {
      close: doNothing,
      endGroup: doNothing,
      getLogFileName: () => undefined,
      hasLevel: () => false,
      info: doNothing,
      loggingEnabled: () => false,
      msg: doNothing,
      perftrc: doNothing,
      startGroup: doNothing,
    },
    session: undefined,
    useInferredProjectPerProjectRoot: false,
    useSingleInferredProject: false,
  });
  projectService.setHostConfiguration({
    preferences: {
      lazyConfiguredProjectsFromExternalProject: true,
    },
    watchOptions: project.watchOptions,
  });

  projectService.openExternalProject({
    options:
      project.compilerOptions as tss.server.protocol.ExternalProjectCompilerOptions,
    projectFileName: project.projectName,
    rootFiles: projectServiceRootFiles.map((fileName) => ({ fileName })),
  });

  return projectService;
};

const closeProjectService = (
  projectService: tss.server.ProjectService,
  projectName: string,
) => {
  projectService.closeExternalProject(projectName);
  (
    projectService as tss.server.ProjectService & {
      close?: CloseWatch;
    }
  ).close?.();
};

const startWatch = async (
  project: TypescriptProject,
  onProgramCreatedOrUpdated: (program: Program) => void,
) => {
  const { default: ts } = await import("typescript");
  const reportWatchStatus = () => {
    /* suppress message */
  };

  const startConfiguredWatch = (
    configuredProject: ConfiguredTypescriptProject,
  ) => {
    const host = ts.createWatchCompilerHost(
      configuredProject.tsconfigPath,
      configuredProject.compilerOptions,
      ts.sys,
      ts.createSemanticDiagnosticsBuilderProgram,
      undefined,
      reportWatchStatus,
      configuredProject.watchOptions,
    );

    host.afterProgramCreate = (program) => {
      onProgramCreatedOrUpdated(program.getProgram());
    };

    const watch = ts.createWatchProgram(host);
    return [watch.getProgram().getProgram(), watch.close] as [
      Program,
      CloseWatch,
    ];
  };

  const startRootFilesWatch = () => {
    const host = ts.createWatchCompilerHost(
      project.rootFiles,
      project.compilerOptions,
      ts.sys,
      ts.createSemanticDiagnosticsBuilderProgram,
      undefined,
      reportWatchStatus,
      project.projectReferences,
      project.watchOptions,
    );

    host.afterProgramCreate = (program) => {
      onProgramCreatedOrUpdated(program.getProgram());
    };

    const watch = ts.createWatchProgram(host);
    return [watch.getProgram().getProgram(), watch.close] as [
      Program,
      CloseWatch,
    ];
  };

  return new Promise<[Program, CloseWatch]>((resolve) => {
    resolve(
      hasTsconfigPath(project)
        ? startConfiguredWatch(project)
        : startRootFilesWatch(),
    );
  });
};

const cleanModuleId = (id: string) => id.split("?", 1)[0];

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const getProgramDependencyCache = (
  cacheByProgram: WeakMap<Program, DependencyCache>,
  program: Program,
) => {
  let dependencyCache = cacheByProgram.get(program);

  if (!dependencyCache) {
    dependencyCache = new Map<Filepath, readonly string[]>();
    cacheByProgram.set(program, dependencyCache);
  }

  return dependencyCache;
};

const collectDirectTrackedFileDependencies = (
  currentFileName: string,
  compilerOptions: CompilerOptions,
  directDependencyCache: DependencyCache,
  moduleResolutionCache: ModuleResolutionCache | undefined,
  program: Program,
  trackedFiles: ReadonlySet<string>,
  typeReferenceResolutionCache:
    | TypeReferenceDirectiveResolutionCache
    | undefined,
  typescriptModule: typeof import("typescript"),
) => {
  const currentFile = path.resolve(currentFileName);
  const cachedDependencies = directDependencyCache.get(currentFile);

  if (cachedDependencies) {
    return cachedDependencies;
  }

  const sourceFile = program.getSourceFile(currentFile);

  if (!sourceFile) {
    const missingFileDependencies: readonly string[] = [];
    directDependencyCache.set(currentFile, missingFileDependencies);
    return missingFileDependencies;
  }

  const { importedFiles, referencedFiles, typeReferenceDirectives } =
    typescriptModule.preProcessFile(sourceFile.text, true, true);
  const referencedDependencyFiles = new Set<string>();

  for (const importedFile of importedFiles) {
    const resolvedModule = typescriptModule.resolveModuleName(
      importedFile.fileName,
      currentFile,
      compilerOptions,
      typescriptModule.sys,
      moduleResolutionCache,
    ).resolvedModule;

    if (resolvedModule?.resolvedFileName) {
      referencedDependencyFiles.add(
        path.resolve(resolvedModule.resolvedFileName),
      );
    }
  }

  for (const referencedFile of referencedFiles) {
    referencedDependencyFiles.add(
      path.resolve(path.dirname(currentFile), referencedFile.fileName),
    );
  }

  for (const typeReferenceDirective of typeReferenceDirectives) {
    const resolvedTypeReference =
      typescriptModule.resolveTypeReferenceDirective(
        typeReferenceDirective.fileName,
        currentFile,
        compilerOptions,
        typescriptModule.sys,
        undefined,
        typeReferenceResolutionCache,
      ).resolvedTypeReferenceDirective;

    if (resolvedTypeReference?.resolvedFileName) {
      referencedDependencyFiles.add(
        path.resolve(resolvedTypeReference.resolvedFileName),
      );
    }
  }

  const directDependencies = [...referencedDependencyFiles]
    .filter((dependencyFile) => trackedFiles.has(dependencyFile))
    .sort();

  directDependencyCache.set(currentFile, directDependencies);
  return directDependencies;
};

const collectTrackedFileDependencies = (
  entryFileName: string,
  compilerOptions: CompilerOptions,
  dependencyClosureCacheByProgram: WeakMap<Program, DependencyCache>,
  directDependencyCacheByProgram: WeakMap<Program, DependencyCache>,
  moduleResolutionCache: ModuleResolutionCache | undefined,
  program: Program,
  trackedFiles: ReadonlySet<string>,
  typeReferenceResolutionCache:
    | TypeReferenceDirectiveResolutionCache
    | undefined,
  typescriptModule: typeof import("typescript"),
) => {
  const directDependencyCache = getProgramDependencyCache(
    directDependencyCacheByProgram,
    program,
  );
  const dependencyClosureCache = getProgramDependencyCache(
    dependencyClosureCacheByProgram,
    program,
  );
  const pendingFiles = new Set<string>();

  const visit = (currentFileName: string): readonly string[] => {
    const currentFile = path.resolve(currentFileName);
    const cachedDependencies = dependencyClosureCache.get(currentFile);

    if (cachedDependencies) {
      return cachedDependencies;
    }

    if (pendingFiles.has(currentFile)) {
      return [currentFile];
    }

    pendingFiles.add(currentFile);

    const dependencyFiles = new Set<string>([currentFile]);
    const directDependencies = collectDirectTrackedFileDependencies(
      currentFile,
      compilerOptions,
      directDependencyCache,
      moduleResolutionCache,
      program,
      trackedFiles,
      typeReferenceResolutionCache,
      typescriptModule,
    );

    for (const directDependency of directDependencies) {
      dependencyFiles.add(directDependency);

      for (const transitiveDependency of visit(directDependency)) {
        dependencyFiles.add(transitiveDependency);
      }
    }

    pendingFiles.delete(currentFile);

    const resolvedDependencies = [...dependencyFiles].sort();
    dependencyClosureCache.set(currentFile, resolvedDependencies);
    return resolvedDependencies;
  };

  return visit(entryFileName);
};

export default function reactDocgenTypescript(config: Options = {}): Plugin {
  const runtimeMode: RuntimeMode = config.EXPERIMENTAL_useProjectService
    ? "projectService"
    : config.EXPERIMENTAL_useWatchProgram
      ? "watch"
      : "default";
  let configRoot = process.cwd();
  let project: TypescriptProject | undefined;
  let shouldEagerInitialize = false;
  let initializationPromise: Promise<void> | null = null;
  let tsProgram: Program | undefined;
  let reusableTsBuilderProgram: SemanticDiagnosticsBuilderProgram | undefined;
  let moduleResolutionCache: ModuleResolutionCache | undefined;
  let typeReferenceResolutionCache:
    | TypeReferenceDirectiveResolutionCache
    | undefined;
  let typescriptModule: typeof import("typescript") | null = null;
  let docGenParser: FileParser | undefined;
  // biome-ignore format: prevent trailing commas being added.
  let generateDocgenCodeBlock: typeof import(
    "./utils/generate"
  )["generateDocgenCodeBlock"];
  let generateOptions: ReturnType<
    typeof import("./utils/options")["getGenerateOptions"]
  >;
  let filter: ReturnType<typeof import("vite")["createFilter"]>;
  let fileSystemCacheDirectory: string | null = null;
  const moduleInvalidationQueue = new Map<Filepath, InvalidateModule>();
  const moduleDependencies = new Map<Filepath, Set<Filepath>>();
  const moduleFilesByDependency = new Map<Filepath, Set<Filepath>>();
  let pendingWatchProgramUpdate:
    | {
        affectedModuleFiles: Set<Filepath>;
        changedFiles: Set<Filepath>;
        promise: Promise<void>;
        resolve: () => void;
      }
    | undefined;
  let dependencyClosureCacheByProgram = new WeakMap<Program, DependencyCache>();
  let directDependencyCacheByProgram = new WeakMap<Program, DependencyCache>();
  const projectConfigFiles = new Set<string>();
  const projectRootFiles = new Set<string>();
  const projectTrackedFiles = new Set<string>();
  let syncedProjectFilesProgram: Program | undefined;
  const transformedModuleFiles = new Set<string>();
  const transformCache = new Map<Filepath, TransformCacheEntry>();
  const warnedMessages = new Set<WarnKey>();
  let closeWatch: CloseWatch | undefined;
  let didDispose = false;

  let projectService: tss.server.ProjectService | null = null;
  const openProjectServiceFiles = new Map<
    Filepath,
    ProjectServiceOpenFileState
  >();
  const projectServiceProjectsByFile = new Map<
    Filepath,
    ProjectServiceProject
  >();

  const clearTransformCache = () => {
    transformCache.clear();
  };

  const clearDependencyAnalysisCache = () => {
    dependencyClosureCacheByProgram = new WeakMap<Program, DependencyCache>();
    directDependencyCacheByProgram = new WeakMap<Program, DependencyCache>();
  };

  const clearTrackedModuleDependencies = (moduleFile: Filepath) => {
    const trackedDependencies = moduleDependencies.get(moduleFile);

    if (!trackedDependencies) {
      return;
    }

    for (const dependencyFile of trackedDependencies) {
      const dependentModuleFiles = moduleFilesByDependency.get(dependencyFile);

      dependentModuleFiles?.delete(moduleFile);

      if (dependentModuleFiles?.size === 0) {
        moduleFilesByDependency.delete(dependencyFile);
      }
    }

    moduleDependencies.delete(moduleFile);
  };

  const clearAllTrackedModuleDependencies = () => {
    moduleDependencies.clear();
    moduleFilesByDependency.clear();
  };

  const trackModuleDependencies = (
    moduleFile: Filepath,
    dependencies: TrackedDependencies,
  ) => {
    transformedModuleFiles.add(moduleFile);
    clearTrackedModuleDependencies(moduleFile);

    if (!dependencies || dependencies.length === 0) {
      return;
    }

    const normalizedDependencies = new Set<string>(
      dependencies.map((dependencyFile) => path.resolve(dependencyFile)),
    );

    normalizedDependencies.add(moduleFile);
    moduleDependencies.set(moduleFile, normalizedDependencies);

    for (const dependencyFile of normalizedDependencies) {
      const dependentModuleFiles =
        moduleFilesByDependency.get(dependencyFile) ?? new Set<string>();

      dependentModuleFiles.add(moduleFile);
      moduleFilesByDependency.set(dependencyFile, dependentModuleFiles);
    }
  };

  const getAffectedTransformedModuleFiles = (dependencyFile: Filepath) =>
    new Set(moduleFilesByDependency.get(dependencyFile) ?? []);

  const clearPendingWatchProgramUpdate = () => {
    pendingWatchProgramUpdate?.resolve();
    pendingWatchProgramUpdate = undefined;
  };

  const queuePendingWatchProgramUpdate = (
    affectedModuleFiles: Iterable<Filepath>,
    changedFile: Filepath,
  ) => {
    if (!pendingWatchProgramUpdate) {
      let resolvePendingWatchProgramUpdate: (() => void) | undefined;
      const promise = new Promise<void>((resolve) => {
        resolvePendingWatchProgramUpdate = resolve;
      });

      pendingWatchProgramUpdate = {
        affectedModuleFiles: new Set<Filepath>(),
        changedFiles: new Set<Filepath>(),
        promise,
        resolve: () => {
          resolvePendingWatchProgramUpdate?.();
        },
      };
    }

    for (const affectedModuleFile of affectedModuleFiles) {
      pendingWatchProgramUpdate.affectedModuleFiles.add(affectedModuleFile);
    }

    pendingWatchProgramUpdate.changedFiles.add(changedFile);
  };

  const waitForPendingWatchProgramUpdate = async (fileName: Filepath) => {
    if (!pendingWatchProgramUpdate?.affectedModuleFiles.has(fileName)) {
      return;
    }

    await pendingWatchProgramUpdate.promise;
  };

  const isPendingWatchProgramUpdateReady = (program: Program) => {
    if (!pendingWatchProgramUpdate) {
      return true;
    }

    for (const changedFile of pendingWatchProgramUpdate.changedFiles) {
      if (!existsSync(changedFile)) {
        continue;
      }

      const sourceFile = program.getSourceFile(changedFile);

      if (!sourceFile) {
        return false;
      }

      if (sourceFile.text !== readFileSync(changedFile, "utf-8")) {
        return false;
      }
    }

    return true;
  };

  const clearPersistentCache = () => {
    if (!fileSystemCacheDirectory) {
      return;
    }

    try {
      clearFileSystemTransformCache(fileSystemCacheDirectory);
    } catch {
      // Best-effort cleanup only. Cache failures should not break transforms.
    }
  };

  const clearProjectServiceProjectCache = () => {
    projectServiceProjectsByFile.clear();
  };

  const closeProjectServiceClientFile = (fileName: Filepath) => {
    if (!openProjectServiceFiles.has(fileName)) {
      return;
    }

    projectService?.closeClientFile(fileName);
    openProjectServiceFiles.delete(fileName);
    projectServiceProjectsByFile.delete(fileName);
  };

  const closeAllProjectServiceClientFiles = () => {
    for (const fileName of [...openProjectServiceFiles.keys()]) {
      closeProjectServiceClientFile(fileName);
    }
  };

  const touchProjectServiceOpenFile = (fileName: Filepath) => {
    const currentState = openProjectServiceFiles.get(fileName);

    if (!currentState) {
      return;
    }

    openProjectServiceFiles.delete(fileName);
    openProjectServiceFiles.set(fileName, currentState);
  };

  const pruneProjectServiceOpenFiles = (preserveFile?: Filepath) => {
    while (openProjectServiceFiles.size > MAX_OPEN_PROJECT_SERVICE_FILES) {
      let fileToClose: Filepath | undefined;

      for (const openFileName of openProjectServiceFiles.keys()) {
        if (openFileName !== preserveFile) {
          fileToClose = openFileName;
          break;
        }
      }

      if (!fileToClose) {
        return;
      }

      closeProjectServiceClientFile(fileToClose);
    }
  };

  const openProjectServiceClientFile = (fileName: Filepath, source: string) => {
    if (!projectService) {
      throw new Error("Internal error: project service was not initialized");
    }

    const currentState = openProjectServiceFiles.get(fileName);

    if (currentState?.source !== source) {
      projectService.openClientFile(
        fileName,
        source,
        /* scriptKind */ undefined,
        configRoot,
      );
      projectServiceProjectsByFile.delete(fileName);
    }

    openProjectServiceFiles.delete(fileName);
    openProjectServiceFiles.set(fileName, { source });
    pruneProjectServiceOpenFiles(fileName);
  };

  const syncProjectServiceFileFromDisk = (fileName: Filepath) => {
    if (!projectService) {
      return false;
    }

    if (!existsSync(fileName)) {
      closeProjectServiceClientFile(fileName);
      return false;
    }

    const source = readFileSync(fileName, "utf-8");
    const wasAlreadyOpen = openProjectServiceFiles.has(fileName);

    projectService.openClientFile(
      fileName,
      source,
      /* scriptKind */ undefined,
      configRoot,
    );
    projectServiceProjectsByFile.delete(fileName);

    if (wasAlreadyOpen) {
      openProjectServiceFiles.delete(fileName);
      openProjectServiceFiles.set(fileName, { source });
      pruneProjectServiceOpenFiles(fileName);
    }

    return !wasAlreadyOpen;
  };

  const reloadProjectService = () => {
    if (!projectService) {
      return;
    }

    clearProjectServiceProjectCache();
    projectService.reloadProjects();
  };

  const refreshProjectServiceProjects = (
    changedFile: Filepath,
    affectedModuleFiles: Iterable<Filepath>,
  ) => {
    if (!projectService) {
      return;
    }

    const affectedProjects = new Set<ProjectServiceProject>();
    const addProject = (nextProject: ProjectServiceProject | undefined) => {
      if (nextProject && !nextProject.isClosed()) {
        affectedProjects.add(nextProject);
      }
    };

    addProject(projectServiceProjectsByFile.get(changedFile));

    for (const affectedModuleFile of affectedModuleFiles) {
      addProject(projectServiceProjectsByFile.get(affectedModuleFile));
    }

    if (affectedProjects.size === 0) {
      const scriptInfo = projectService.getScriptInfo(changedFile);

      if (scriptInfo?.fileName) {
        addProject(
          projectService.getDefaultProjectForFile(scriptInfo.fileName, true),
        );
      }
    }

    if (affectedProjects.size === 0) {
      reloadProjectService();
      return;
    }

    try {
      for (const [
        cachedFileName,
        cachedProject,
      ] of projectServiceProjectsByFile) {
        if (
          cachedFileName === changedFile ||
          affectedProjects.has(cachedProject)
        ) {
          projectServiceProjectsByFile.delete(cachedFileName);
        }
      }

      for (const affectedProject of affectedProjects) {
        affectedProject.registerFileUpdate(changedFile);
        affectedProject.updateGraph();
      }
    } catch {
      reloadProjectService();
    }
  };

  const getProjectServiceProgram = (
    fileName: Filepath,
    source: string,
  ): Program | undefined => {
    if (!projectService) {
      return undefined;
    }

    openProjectServiceClientFile(fileName, source);

    const scriptInfo = projectService.getScriptInfo(fileName);

    if (!scriptInfo?.fileName) {
      return undefined;
    }

    const cachedProject = projectServiceProjectsByFile.get(fileName);

    if (
      cachedProject &&
      !cachedProject.isClosed() &&
      cachedProject.containsScriptInfo(scriptInfo)
    ) {
      const cachedProgram = cachedProject.getLanguageService(true).getProgram();

      if (cachedProgram) {
        touchProjectServiceOpenFile(fileName);
        return cachedProgram;
      }
    }

    const nextProject = projectService.getDefaultProjectForFile(
      scriptInfo.fileName,
      true,
    );

    if (!nextProject) {
      return undefined;
    }

    projectServiceProjectsByFile.set(fileName, nextProject);
    touchProjectServiceOpenFile(fileName);
    return nextProject.getLanguageService(true).getProgram();
  };

  const hasRuntimeState = () =>
    runtimeMode === "projectService"
      ? projectService !== null
      : runtimeMode === "watch"
        ? tsProgram !== undefined && closeWatch !== undefined
        : tsProgram !== undefined;

  const syncProjectFiles = (
    target: Set<string>,
    fileNames: Iterable<string>,
  ) => {
    target.clear();

    for (const fileName of fileNames) {
      target.add(path.resolve(fileName));
    }
  };

  const collectProjectConfigFilesFromProgram = (
    nextProject: TypescriptProject,
    program: Program,
  ) => {
    const nextConfigFiles = new Set(
      nextProject.configFiles.map((fileName) => path.resolve(fileName)),
    );
    const pendingProjectReferences = [
      ...(program.getResolvedProjectReferences() ?? []),
    ];

    while (pendingProjectReferences.length > 0) {
      const resolvedProjectReference = pendingProjectReferences.pop();

      if (!resolvedProjectReference) {
        continue;
      }

      nextConfigFiles.add(
        path.resolve(resolvedProjectReference.sourceFile.fileName),
      );
      pendingProjectReferences.push(
        ...(resolvedProjectReference.references ?? []),
      );
    }

    return [...nextConfigFiles].sort();
  };

  const collectTrackedProjectFilesFromProgram = (
    nextProject: TypescriptProject,
    program: Program,
  ) => {
    const nextTrackedFiles = new Set(
      nextProject.projectFiles.map((fileName) => path.resolve(fileName)),
    );

    for (const sourceFile of program.getSourceFiles()) {
      if (program.isSourceFileDefaultLibrary(sourceFile)) {
        continue;
      }

      nextTrackedFiles.add(path.resolve(sourceFile.fileName));
    }

    const pendingProjectReferences = [
      ...(program.getResolvedProjectReferences() ?? []),
    ];

    while (pendingProjectReferences.length > 0) {
      const resolvedProjectReference = pendingProjectReferences.pop();

      if (!resolvedProjectReference) {
        continue;
      }

      for (const fileName of resolvedProjectReference.commandLine.fileNames) {
        nextTrackedFiles.add(path.resolve(fileName));
      }

      pendingProjectReferences.push(
        ...(resolvedProjectReference.references ?? []),
      );
    }

    return [...nextTrackedFiles].sort();
  };

  const syncTrackedProjectFiles = (nextProject: TypescriptProject) => {
    syncedProjectFilesProgram = undefined;
    syncProjectFiles(projectConfigFiles, nextProject.configFiles);
    projectRootFiles.clear();
    syncProjectFiles(projectRootFiles, nextProject.rootFiles);
    syncProjectFiles(projectTrackedFiles, nextProject.projectFiles);
  };

  const syncProjectFilesFromProgram = (
    nextProject: TypescriptProject,
    program: Program,
  ) => {
    if (syncedProjectFilesProgram === program) {
      return;
    }

    syncedProjectFilesProgram = program;
    syncProjectFiles(
      projectConfigFiles,
      collectProjectConfigFilesFromProgram(nextProject, program),
    );
    syncProjectFiles(
      projectTrackedFiles,
      collectTrackedProjectFilesFromProgram(nextProject, program),
    );
  };

  const closeRuntimeState = ({
    preserveReusableProgram = false,
  }: {
    preserveReusableProgram?: boolean;
  } = {}) => {
    clearPendingWatchProgramUpdate();
    closeWatch?.();
    closeWatch = undefined;

    if (projectService && project) {
      closeAllProjectServiceClientFiles();
      clearProjectServiceProjectCache();
      closeProjectService(projectService, project.projectName);
    }
    projectService = null;

    if (!preserveReusableProgram) {
      reusableTsBuilderProgram = undefined;
    }

    syncedProjectFilesProgram = undefined;
    tsProgram = undefined;
  };

  const clearProjectContext = () => {
    project = undefined;
    docGenParser = undefined;
    clearDependencyAnalysisCache();
    clearAllTrackedModuleDependencies();
    clearProjectServiceProjectCache();
    moduleResolutionCache = undefined;
    openProjectServiceFiles.clear();
    syncedProjectFilesProgram = undefined;
    projectConfigFiles.clear();
    projectRootFiles.clear();
    projectTrackedFiles.clear();
    reusableTsBuilderProgram = undefined;
    typeReferenceResolutionCache = undefined;
  };

  const invalidateTransformedModules = (
    server: ViteDevServer,
    affectedTransformedModuleFiles: Iterable<Filepath>,
    queueInvalidation = false,
  ) => {
    for (const transformedModuleFile of affectedTransformedModuleFiles) {
      const affectedModules = server.moduleGraph.getModulesByFile(
        transformedModuleFile,
      );

      if (!affectedModules) {
        continue;
      }

      for (const module of affectedModules) {
        const key = module.id ?? module.url;
        const invalidateModule = () => {
          server.moduleGraph.invalidateModule(
            module,
            undefined,
            Date.now(),
            true,
          );
        };

        if (queueInvalidation) {
          moduleInvalidationQueue.set(key, invalidateModule);
        } else {
          invalidateModule();
        }
      }
    }
  };

  const flushQueuedModuleInvalidations = () => {
    for (const [
      filepath,
      invalidateModule,
    ] of moduleInvalidationQueue.entries()) {
      invalidateModule();
      moduleInvalidationQueue.delete(filepath);
    }
  };

  const deleteCachedTransforms = (
    pluginContext: { warn(message: string): void },
    affectedModuleFiles: Iterable<Filepath>,
  ) => {
    for (const affectedModuleFile of affectedModuleFiles) {
      const cachedTransform = transformCache.get(affectedModuleFile);

      if (fileSystemCacheDirectory && cachedTransform) {
        try {
          deleteFileSystemTransformCache(
            fileSystemCacheDirectory,
            affectedModuleFile,
            cachedTransform.source,
          );
        } catch (error) {
          warnOnce(
            pluginContext,
            `${fileSystemCacheDirectory}:file-system-cache-delete:${affectedModuleFile}:${getErrorMessage(error)}`,
            `Failed to delete the docgen file-system cache entry for "${affectedModuleFile}" at "${fileSystemCacheDirectory}": ${getErrorMessage(error)}`,
          );
        }
      }

      transformCache.delete(affectedModuleFile);
    }
  };

  const ensureInitialized = async () => {
    if (project && docGenParser && hasRuntimeState()) {
      return;
    }

    if (initializationPromise) {
      await initializationPromise;
      return;
    }

    initializationPromise = (async () => {
      typescriptModule ??= (await import("typescript")).default;
      if (!project || !docGenParser) {
        project = await resolveTypescriptProject(config, configRoot);
        docGenParser = await getDocgen(config, project.compilerOptions);
        moduleResolutionCache = typescriptModule.createModuleResolutionCache(
          configRoot,
          typescriptModule.sys.useCaseSensitiveFileNames
            ? (fileName) => fileName
            : (fileName) => fileName.toLowerCase(),
          project.compilerOptions,
        );
        typeReferenceResolutionCache =
          typescriptModule.createTypeReferenceDirectiveResolutionCache(
            configRoot,
            typescriptModule.sys.useCaseSensitiveFileNames
              ? (fileName) => fileName
              : (fileName) => fileName.toLowerCase(),
            project.compilerOptions,
          );
        clearDependencyAnalysisCache();
        syncTrackedProjectFiles(project);
        clearTransformCache();
      }

      const activeProject = project;

      if (runtimeMode === "projectService") {
        if (!projectService) {
          projectService = await createProjectService(activeProject);
        }
      } else if (runtimeMode === "watch") {
        if (!tsProgram || !closeWatch) {
          [tsProgram, closeWatch] = await startWatch(
            activeProject,
            (program) => {
              clearDependencyAnalysisCache();
              reusableTsBuilderProgram = undefined;
              tsProgram = program;
              syncProjectFilesFromProgram(activeProject, program);
              if (isPendingWatchProgramUpdateReady(program)) {
                flushQueuedModuleInvalidations();
                clearPendingWatchProgramUpdate();
              }
            },
          );
          syncProjectFilesFromProgram(activeProject, tsProgram);
        }
      } else if (!tsProgram) {
        reusableTsBuilderProgram = await createProgram(
          activeProject,
          reusableTsBuilderProgram,
        );
        tsProgram = reusableTsBuilderProgram.getProgram();
        syncProjectFilesFromProgram(activeProject, tsProgram);
      }
    })();

    try {
      await initializationPromise;
    } finally {
      initializationPromise = null;
    }
  };

  const teardown = () => {
    if (didDispose) {
      return;
    }

    didDispose = true;
    initializationPromise = null;
    clearDependencyAnalysisCache();
    clearTransformCache();
    clearAllTrackedModuleDependencies();
    transformedModuleFiles.clear();
    moduleInvalidationQueue.clear();
    closeRuntimeState();
    clearProjectContext();
  };

  const warnOnce = (
    pluginContext: { warn(message: string): void },
    key: WarnKey,
    message: string,
  ) => {
    if (warnedMessages.has(key)) {
      return;
    }

    warnedMessages.add(key);
    pluginContext.warn(message);
  };

  const readCachedTransform = (
    pluginContext: { warn(message: string): void },
    normalizedFileId: string,
    source: string,
  ):
    | { dependencies: TrackedDependencies; result: CachedTransformResult }
    | undefined => {
    if (!fileSystemCacheDirectory) {
      return undefined;
    }

    try {
      const cachedTransform = readFileSystemTransformCache(
        fileSystemCacheDirectory,
        normalizedFileId,
        source,
      );

      return cachedTransform
        ? {
            dependencies: cachedTransform.dependencies,
            result: cachedTransform.result,
          }
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
    dependencies: TrackedDependencies,
    result: CachedTransformResult,
  ) => {
    if (!fileSystemCacheDirectory) {
      return;
    }

    try {
      writeFileSystemTransformCache(
        fileSystemCacheDirectory,
        normalizedFileId,
        source,
        {
          dependencies: dependencies ? [...dependencies] : undefined,
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

  return {
    name: "vite:react-docgen-typescript",
    async configResolved(resolvedConfig?: ResolvedConfig) {
      const { getGenerateOptions } = await import("./utils/options");
      generateDocgenCodeBlock = (await import("./utils/generate"))
        .generateDocgenCodeBlock;
      const { createFilter } = await import("vite");

      configRoot = resolvedConfig?.root ?? process.cwd();
      shouldEagerInitialize = resolvedConfig?.command === "build";
      generateOptions = getGenerateOptions(config);
      const resolvedFileSystemCache = resolveFileSystemCacheOptions(
        config,
        configRoot,
      );

      fileSystemCacheDirectory = resolvedFileSystemCache.enabled
        ? path.join(
            resolvedFileSystemCache.directory,
            createFileSystemCacheNamespace(config, configRoot),
          )
        : null;

      if (config.tsconfigPath) {
        const absoluteTsconfigPath = resolveTsconfigPath(
          configRoot,
          config.tsconfigPath,
        );

        if (!existsSync(absoluteTsconfigPath)) {
          throw new Error(
            `Failed to read tsconfig at "${absoluteTsconfigPath}": File does not exist`,
          );
        }
      }

      const includeArray = config.include ?? DEFAULT_INCLUDE;
      const excludeArray = config.exclude ?? DEFAULT_EXCLUDE;

      filter = createFilter(includeArray, excludeArray);

      if (shouldEagerInitialize) {
        await ensureInitialized();
      }
    },
    async transform(src, id) {
      const fileId = cleanModuleId(id);

      if (!filter(fileId)) {
        return;
      }

      const normalizedFileId = path.resolve(fileId);
      await waitForPendingWatchProgramUpdate(normalizedFileId);
      const cachedTransform = transformCache.get(normalizedFileId);
      if (cachedTransform?.source === src) {
        touchProjectServiceOpenFile(normalizedFileId);
        trackModuleDependencies(normalizedFileId, cachedTransform.dependencies);
        return cachedTransform.result;
      }

      const persistedCachedTransform = readCachedTransform(
        this,
        normalizedFileId,
        src,
      );
      if (persistedCachedTransform !== undefined) {
        touchProjectServiceOpenFile(normalizedFileId);
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

      await ensureInitialized();
      const activeDocGenParser = docGenParser;

      if (!projectRootFiles.has(normalizedFileId)) {
        trackModuleDependencies(normalizedFileId, undefined);
        warnOnce(
          this,
          `${normalizedFileId}:excluded-from-typescript-project`,
          `Skipping docgen for "${normalizedFileId}" because it is not included in the active TypeScript project.`,
        );
        return src;
      }

      let activeProgram: Program | undefined;

      try {
        if (!activeDocGenParser) {
          throw new Error("Internal error: docgen parser was not initialized");
        }

        const componentDocs = activeDocGenParser.parseWithProgramProvider(
          normalizedFileId,
          () => {
            if (tsProgram) {
              activeProgram = tsProgram;
              return tsProgram;
            }

            if (projectService) {
              const languageServiceProgram = getProjectServiceProgram(
                normalizedFileId,
                src,
              );

              if (languageServiceProgram) {
                activeProgram = languageServiceProgram;
                return languageServiceProgram;
              }
            }

            throw new Error("Internal error: no TypeScript program available");
          },
        );
        if (activeProgram && project) {
          syncProjectFilesFromProgram(project, activeProgram);
        }
        const trackedDependencies =
          activeProgram && project && typescriptModule
            ? collectTrackedFileDependencies(
                normalizedFileId,
                project.compilerOptions,
                dependencyClosureCacheByProgram,
                directDependencyCacheByProgram,
                moduleResolutionCache,
                activeProgram,
                projectTrackedFiles,
                typeReferenceResolutionCache,
                typescriptModule,
              )
            : undefined;

        if (!componentDocs.length) {
          const result = null;

          transformCache.set(normalizedFileId, {
            dependencies: trackedDependencies,
            result,
            source: src,
          });
          trackModuleDependencies(normalizedFileId, trackedDependencies);
          writeCachedTransform(
            this,
            normalizedFileId,
            src,
            trackedDependencies,
            result,
          );
          return null;
        }

        const componentDocsWithTargets =
          activeProgram && typescriptModule
            ? resolveComponentDocRuntimeTargets(
                componentDocs,
                activeProgram.getTypeChecker(),
                activeProgram.getSourceFile(normalizedFileId) ??
                  (() => {
                    throw new Error(
                      `Internal error: source file "${normalizedFileId}" was not found in the active TypeScript program`,
                    );
                  })(),
                typescriptModule,
              )
            : componentDocs.map((componentDoc) => ({
                ...componentDoc,
                targetExpression: null,
              }));

        const result = generateDocgenCodeBlock({
          filename: normalizedFileId,
          source: src,
          componentDocs: componentDocsWithTargets,
          ...generateOptions,
        });
        transformCache.set(normalizedFileId, {
          dependencies: trackedDependencies,
          result,
          source: src,
        });
        trackModuleDependencies(normalizedFileId, trackedDependencies);
        writeCachedTransform(
          this,
          normalizedFileId,
          src,
          trackedDependencies,
          result,
        );
        return result;
      } catch (error) {
        const trackedDependencies =
          activeProgram && project && typescriptModule
            ? collectTrackedFileDependencies(
                normalizedFileId,
                project.compilerOptions,
                dependencyClosureCacheByProgram,
                directDependencyCacheByProgram,
                moduleResolutionCache,
                activeProgram,
                projectTrackedFiles,
                typeReferenceResolutionCache,
                typescriptModule,
              )
            : undefined;

        warnOnce(
          this,
          `${normalizedFileId}:${getErrorMessage(error)}`,
          `Failed to generate docgen for "${normalizedFileId}": ${getErrorMessage(error)}`,
        );
        trackModuleDependencies(normalizedFileId, trackedDependencies);
        return src;
      }
    },
    async handleHotUpdate({ file, server }) {
      const normalizedFile = path.resolve(cleanModuleId(file));
      const isPotentialTypescriptFile =
        TYPESCRIPT_FILE_PATTERN.test(normalizedFile);
      const isTsconfigChange = projectConfigFiles.has(normalizedFile);
      const isTrackedTypescriptFile = project
        ? isTsconfigChange ||
          projectTrackedFiles.has(normalizedFile) ||
          (!project.tsconfigPath && isPotentialTypescriptFile)
        : isPotentialTypescriptFile;
      const affectedTransformedModuleFiles = isTsconfigChange
        ? new Set(transformedModuleFiles)
        : getAffectedTransformedModuleFiles(normalizedFile);

      if (!isTrackedTypescriptFile) return;
      if (isTsconfigChange) {
        clearDependencyAnalysisCache();
        clearTransformCache();
        clearPersistentCache();
        closeRuntimeState();
        clearProjectContext();
        invalidateTransformedModules(server, transformedModuleFiles);
        return;
      }

      clearDependencyAnalysisCache();
      deleteCachedTransforms(this, affectedTransformedModuleFiles);

      if (runtimeMode === "watch") {
        if (!project || !hasRuntimeState()) return;
        queuePendingWatchProgramUpdate(
          affectedTransformedModuleFiles,
          normalizedFile,
        );
        invalidateTransformedModules(
          server,
          affectedTransformedModuleFiles,
          true,
        );
        return;
      }

      if (runtimeMode === "projectService") {
        if (projectService) {
          const shouldCloseTemporaryClientFile =
            syncProjectServiceFileFromDisk(normalizedFile);

          try {
            refreshProjectServiceProjects(
              normalizedFile,
              affectedTransformedModuleFiles,
            );
          } finally {
            if (shouldCloseTemporaryClientFile) {
              projectService.closeClientFile(normalizedFile);
            }
          }
        }
      } else {
        closeRuntimeState({ preserveReusableProgram: true });
      }

      invalidateTransformedModules(server, affectedTransformedModuleFiles);
    },
    closeBundle() {
      teardown();
    },
    buildEnd() {
      teardown();
    },
  };
}
