import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { FileParser } from "react-docgen-typescript";
import type {
  CompilerOptions,
  ModuleResolutionCache,
  Node,
  Program,
  ProjectReference,
  SemanticDiagnosticsBuilderProgram,
  SourceFile,
  StringLiteralLike,
  System,
  TypeReferenceDirectiveResolutionCache,
  WatchOptions,
} from "typescript";
import type * as tss from "typescript/lib/tsserverlibrary";
import { createDependencyVersionFingerprint } from "../utils/cache";
import type { ResolvedFileSelection } from "../utils/fileSelection";
import { defaultPropFilter } from "../utils/filter";
import { type Options, resolveDocgenRuntimeMode } from "../utils/options";
import { resolveComponentDocRuntimeTargets } from "../utils/runtimeTarget";
import { loadTypescript } from "../utils/typescriptCompatibility";
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
} from "./backend";
import { toBackendErrorRecord } from "./backend";
import { normalizeBoundaryPath, normalizeBoundaryPaths } from "./pathIdentity";
import type {
  DocgenComponent,
  DocgenJsonValue,
  DocgenMethod,
  DocgenParent,
} from "./types";

type Filepath = string;
type CloseWatch = () => void;
type DependencyCache = Map<Filepath, readonly string[]>;
type ProgramDependencyCache = {
  direct: DependencyCache;
  moduleResolution: ModuleResolutionCache;
  sharedAmbient: readonly string[];
  typeReferenceResolution: TypeReferenceDirectiveResolutionCache;
  unresolved: DependencyCache;
};
type ProjectServiceProject = tss.server.Project;
type ProjectServiceOpenFileState = {
  source: string;
};

interface TypescriptProject {
  compilerOptions: CompilerOptions;
  configFiles: string[];
  docgenFiles: string[];
  projectFiles: string[];
  projectName: string;
  rootFiles: string[];
  tsconfigPath?: string;
  watchOptions?: WatchOptions;
}

const MAX_OPEN_PROJECT_SERVICE_FILES = 64;
const TYPESCRIPT_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const NODE_MODULES_SEGMENT_PATTERN = /(?:^|[\\/])node_modules(?:[\\/]|$)/i;

export const isNodeModulesPath = (fileName: string): boolean =>
  NODE_MODULES_SEGMENT_PATTERN.test(fileName);

export const createUnresolvedCaptureResolutionHost = (
  system: System,
  recordMissingFile: (fileName: string) => void,
): System => ({
  ...system,
  directoryExists(directoryName) {
    if (system.directoryExists?.(directoryName)) return true;
    return !isNodeModulesPath(directoryName);
  },
  fileExists(fileName) {
    const exists = system.fileExists(fileName);
    if (!exists) recordMissingFile(path.resolve(fileName));
    return exists;
  },
});

export const getReactDocgenParserOptions = (config: Options) => {
  const {
    compilerOptions: inlineCompilerOptions,
    exclude,
    include,
    fileSystemCache,
    docgenMode,
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

  return docgenOptions;
};

const getDocgen = async (config: Options, compilerOptions: CompilerOptions) => {
  const docGen = await import("react-docgen-typescript");
  return docGen.withCompilerOptions(
    compilerOptions,
    getReactDocgenParserOptions(config),
  );
};

const resolveTsconfigPath = (rootDir: string, tsconfigPath: string) =>
  path.isAbsolute(tsconfigPath)
    ? tsconfigPath
    : path.resolve(rootDir, tsconfigPath);

const discoverDocgenFilesFromGlobs = async (
  rootDir: string,
  fileSelection: ResolvedFileSelection,
) => {
  if (!fileSelection.hasIncludes) {
    return [];
  }

  const { globSync } = await import("glob");
  const files = new Set<string>();

  for (const filePattern of fileSelection.include) {
    for (const fileName of globSync(filePattern, {
      absolute: true,
      cwd: rootDir,
      nodir: true,
    })) {
      const normalizedFileName = path.resolve(fileName);

      if (fileSelection.matchesDocgenFile(normalizedFileName)) {
        files.add(normalizedFileName);
      }
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
    typescriptModule: typeof import("typescript"),
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

    const parsedReferencedConfig = getTSConfigFile(
      typescriptModule,
      referencedConfigPath,
    );

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

const resolveTypescriptProject = async (
  config: Options,
  rootDir: string,
  ts: typeof import("typescript"),
  fileSelection: ResolvedFileSelection,
): Promise<TypescriptProject> => {
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
      const { getTSConfigFile } = await import("../utils/typescript");

      parsedConfig = getTSConfigFile(ts, absoluteTsconfigPath);
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
    : await discoverDocgenFilesFromGlobs(rootDir, fileSelection);
  const configFiles = resolveProjectConfigFiles(
    tsconfigPath,
    referencedProjectMetadata.configFiles,
  );

  const docgenFiles = parsedConfig
    ? projectFiles.filter((fileName) =>
        fileSelection.matchesDocgenFile(fileName),
      )
    : projectFiles;
  const rootFiles = parsedConfig ? projectFiles : docgenFiles;

  return {
    compilerOptions,
    configFiles,
    docgenFiles,
    projectFiles,
    projectName:
      tsconfigPath ??
      path.join(rootDir, ".react-docgen-typescript.external-project"),
    rootFiles,
    tsconfigPath,
    watchOptions: parsedConfig?.watchOptions,
  };
};

const createProgram = async (
  project: TypescriptProject,
  ts: typeof import("typescript"),
  oldProgram?: SemanticDiagnosticsBuilderProgram,
) => {
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
    undefined,
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
  ts: typeof import("typescript"),
  onProgramCreatedOrUpdated: (program: Program) => void,
) => {
  const reportWatchStatus = () => {
    /* suppress message */
  };

  const startRootFilesWatch = () => {
    let closed = false;
    const trackedWatchers = new Set<tss.FileWatcher>();
    const trackWatcher = (watcher: tss.FileWatcher): tss.FileWatcher => {
      if (closed) {
        watcher.close();
        return createStubFileWatcher();
      }
      const trackedWatcher = {
        close() {
          if (!trackedWatchers.delete(trackedWatcher)) return;
          watcher.close();
        },
      };
      trackedWatchers.add(trackedWatcher);
      return trackedWatcher;
    };
    const systemWatchDirectory = ts.sys.watchDirectory;
    const systemWatchFile = ts.sys.watchFile;
    const watchSystem: typeof ts.sys = {
      ...ts.sys,
      watchDirectory: (...arguments_) =>
        closed || !systemWatchDirectory
          ? createStubFileWatcher()
          : trackWatcher(systemWatchDirectory(...arguments_)),
      watchFile: (...arguments_) =>
        closed || !systemWatchFile
          ? createStubFileWatcher()
          : trackWatcher(systemWatchFile(...arguments_)),
    };
    const host = ts.createWatchCompilerHost(
      project.rootFiles,
      project.compilerOptions,
      watchSystem,
      ts.createSemanticDiagnosticsBuilderProgram,
      undefined,
      reportWatchStatus,
      undefined,
      project.watchOptions,
    );

    host.afterProgramCreate = (program) => {
      onProgramCreatedOrUpdated(program.getProgram());
    };

    const watch = ts.createWatchProgram(host);
    const close = () => {
      if (closed) return;
      closed = true;
      watch.close();
      for (const watcher of [...trackedWatchers]) watcher.close();
    };
    return [watch.getProgram().getProgram(), close] as [Program, CloseWatch];
  };

  return new Promise<[Program, CloseWatch]>((resolve) => {
    resolve(startRootFilesWatch());
  });
};

const isSharedAmbientSourceFile = (
  sourceFile: SourceFile,
  program: Program,
  typescriptModule: typeof import("typescript"),
) => {
  if (!typescriptModule.isExternalModule(sourceFile)) {
    if (sourceFile.flags & typescriptModule.NodeFlags.JavaScriptFile) {
      const checker = program.getTypeChecker();
      // isExternalModule excludes CommonJS. This optional current public API
      // also exists at runtime in 4.3; without it, retain the input conservatively.
      if (
        typeof checker.resolveName === "function" &&
        checker
          .resolveName(
            "exports",
            sourceFile,
            typescriptModule.SymbolFlags.ValueModule,
            true,
          )
          ?.declarations?.includes(sourceFile)
      ) {
        return false;
      }
    }
    return true;
  }
  return sourceFile.statements.some(
    (statement) =>
      typescriptModule.isNamespaceExportDeclaration(statement) ||
      (typescriptModule.isModuleDeclaration(statement) &&
        ((statement.flags & typescriptModule.NodeFlags.GlobalAugmentation) !==
          0 ||
          typescriptModule.isStringLiteral(statement.name))),
  );
};

const getProgramDependencyCache = (
  cacheByProgram: WeakMap<Program, ProgramDependencyCache>,
  program: Program,
  typescriptModule: typeof import("typescript"),
) => {
  let dependencyCache = cacheByProgram.get(program);

  if (!dependencyCache) {
    const canonicalFileName = typescriptModule.sys.useCaseSensitiveFileNames
      ? (fileName: string) => fileName
      : (fileName: string) => fileName.toLowerCase();
    dependencyCache = {
      direct: new Map(),
      moduleResolution: typescriptModule.createModuleResolutionCache(
        program.getCurrentDirectory(),
        canonicalFileName,
        program.getCompilerOptions(),
      ),
      sharedAmbient: program
        .getSourceFiles()
        .filter(
          (sourceFile) =>
            !program.isSourceFileDefaultLibrary(sourceFile) &&
            isSharedAmbientSourceFile(sourceFile, program, typescriptModule),
        )
        .map((sourceFile) => path.resolve(sourceFile.fileName)),
      typeReferenceResolution:
        typescriptModule.createTypeReferenceDirectiveResolutionCache(
          program.getCurrentDirectory(),
          canonicalFileName,
          program.getCompilerOptions(),
        ),
      unresolved: new Map(),
    };
    cacheByProgram.set(program, dependencyCache);
  }

  return dependencyCache;
};

const collectModuleSpecifiers = (
  sourceFile: SourceFile,
  typescriptModule: typeof import("typescript"),
) => {
  const specifiers: StringLiteralLike[] = [];
  const add = (node: Node | undefined) => {
    if (node && typescriptModule.isStringLiteralLike(node))
      specifiers.push(node);
  };
  const visit = (node: Node) => {
    if (
      typescriptModule.isImportDeclaration(node) ||
      typescriptModule.isExportDeclaration(node)
    ) {
      add(node.moduleSpecifier);
    } else if (
      typescriptModule.isImportEqualsDeclaration(node) &&
      typescriptModule.isExternalModuleReference(node.moduleReference)
    ) {
      add(node.moduleReference.expression);
    } else if (
      typescriptModule.isImportTypeNode(node) &&
      typescriptModule.isLiteralTypeNode(node.argument)
    ) {
      add(node.argument.literal);
    } else if (
      typescriptModule.isModuleDeclaration(node) &&
      typescriptModule.isExternalModule(sourceFile)
    ) {
      add(node.name);
    } else if (typescriptModule.isCallExpression(node)) {
      if (
        node.expression.kind === typescriptModule.SyntaxKind.ImportKeyword ||
        (typescriptModule.isIdentifier(node.expression) &&
          node.expression.text === "require")
      ) {
        add(node.arguments[0]);
      } else if (
        typescriptModule.isIdentifier(node.expression) &&
        node.expression.text === "define"
      ) {
        const dependencyArray =
          node.arguments[
            node.arguments[0] &&
            typescriptModule.isStringLiteralLike(node.arguments[0])
              ? 1
              : 0
          ];
        if (
          dependencyArray &&
          typescriptModule.isArrayLiteralExpression(dependencyArray)
        ) {
          for (const dependency of dependencyArray.elements) add(dependency);
        }
      }
    }
    typescriptModule.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

const getImportResolutionMode = (
  program: Program,
  sourceFile: SourceFile,
  specifier: StringLiteralLike,
  typescriptModule: typeof import("typescript"),
) => {
  if (typeof program.getModeForUsageLocation === "function") {
    return program.getModeForUsageLocation(sourceFile, specifier);
  }
  // Older supported compilers may expose only the module-level helper, or
  // predate conditional import/require resolution entirely.
  return typeof typescriptModule.getModeForUsageLocation === "function"
    ? typescriptModule.getModeForUsageLocation(
        sourceFile,
        specifier,
        program.getCompilerOptions(),
      )
    : undefined;
};

const getResolvedModuleFiles = (
  program: Program,
  specifier: StringLiteralLike,
) =>
  program
    .getTypeChecker()
    .getSymbolAtLocation(specifier)
    ?.declarations?.map(
      (declaration) => declaration.getSourceFile().fileName,
    ) ?? [];

const collectDirectTrackedFileDependencies = (
  currentFileName: string,
  dependencyCache: ProgramDependencyCache,
  program: Program,
  trackedFiles: ReadonlySet<string>,
  typescriptModule: typeof import("typescript"),
) => {
  const currentFile = path.resolve(currentFileName);
  const directDependencyCache = dependencyCache.direct;
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

  const compilerOptions = program.getCompilerOptions();
  const { referencedFiles, typeReferenceDirectives } = sourceFile;
  const referencedDependencyFiles = new Set<string>();

  for (const specifier of collectModuleSpecifiers(
    sourceFile,
    typescriptModule,
  )) {
    const resolvedFiles = getResolvedModuleFiles(program, specifier);
    if (resolvedFiles.length > 0) {
      for (const resolvedFile of resolvedFiles) {
        referencedDependencyFiles.add(path.resolve(resolvedFile));
      }
      continue;
    }
    const resolvedModule = typescriptModule.resolveModuleName(
      specifier.text,
      currentFile,
      compilerOptions,
      typescriptModule.sys,
      dependencyCache.moduleResolution,
      undefined,
      getImportResolutionMode(program, sourceFile, specifier, typescriptModule),
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
        dependencyCache.typeReferenceResolution,
        typeReferenceDirective.resolutionMode ?? sourceFile.impliedNodeFormat,
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
  cacheByProgram: WeakMap<Program, ProgramDependencyCache>,
  program: Program,
  trackedFiles: ReadonlySet<string>,
  typescriptModule: typeof import("typescript"),
) => {
  const dependencyCache = getProgramDependencyCache(
    cacheByProgram,
    program,
    typescriptModule,
  );
  const pendingFiles = [
    path.resolve(entryFileName),
    ...dependencyCache.sharedAmbient.filter((fileName) =>
      trackedFiles.has(fileName),
    ),
  ];
  const dependencyFiles = new Set<string>();

  while (pendingFiles.length > 0) {
    const currentFile = pendingFiles.pop();
    if (currentFile === undefined || dependencyFiles.has(currentFile)) {
      continue;
    }

    dependencyFiles.add(currentFile);
    const directDependencies = collectDirectTrackedFileDependencies(
      currentFile,
      dependencyCache,
      program,
      trackedFiles,
      typescriptModule,
    );

    for (const directDependency of directDependencies) {
      pendingFiles.push(directDependency);
    }
  }

  return [...dependencyFiles].sort();
};

const collectUnresolvedModuleDependencies = (
  dependencyFiles: readonly string[],
  cacheByProgram: WeakMap<Program, ProgramDependencyCache>,
  program: Program,
  typescriptModule: typeof import("typescript"),
) => {
  const dependencyCache = getProgramDependencyCache(
    cacheByProgram,
    program,
    typescriptModule,
  );
  const directUnresolvedDependencyCache = dependencyCache.unresolved;
  const compilerOptions = program.getCompilerOptions();
  const unresolvedDependencies = new Set<string>();

  for (const dependencyFile of dependencyFiles) {
    const resolvedDependencyFile = path.resolve(dependencyFile);
    const cachedDependencies = directUnresolvedDependencyCache.get(
      resolvedDependencyFile,
    );
    if (cachedDependencies) {
      for (const cachedDependency of cachedDependencies) {
        unresolvedDependencies.add(cachedDependency);
      }
      continue;
    }
    const directUnresolvedDependencies = new Set<string>();
    const sourceFile = program.getSourceFile(resolvedDependencyFile);
    if (!sourceFile) {
      directUnresolvedDependencyCache.set(resolvedDependencyFile, []);
      continue;
    }
    for (const specifier of collectModuleSpecifiers(
      sourceFile,
      typescriptModule,
    )) {
      if (getResolvedModuleFiles(program, specifier).length > 0) continue;
      const resolutionMode = getImportResolutionMode(
        program,
        sourceFile,
        specifier,
        typescriptModule,
      );
      const cachedResolution = typescriptModule.resolveModuleName(
        specifier.text,
        sourceFile.fileName,
        compilerOptions,
        typescriptModule.sys,
        dependencyCache.moduleResolution,
        undefined,
        resolutionMode,
      );
      if (cachedResolution.resolvedModule) continue;
      const failedCandidates = new Set<string>();
      const resolutionHost = createUnresolvedCaptureResolutionHost(
        typescriptModule.sys,
        (fileName) => failedCandidates.add(fileName),
      );
      const resolution = typescriptModule.resolveModuleName(
        specifier.text,
        sourceFile.fileName,
        compilerOptions,
        resolutionHost,
        undefined,
        undefined,
        resolutionMode,
      );
      if (resolution.resolvedModule) continue;
      for (const failedCandidate of failedCandidates) {
        const normalizedCandidate = normalizeBoundaryPath(failedCandidate);
        if (
          TYPESCRIPT_FILE_PATTERN.test(normalizedCandidate) &&
          !isNodeModulesPath(normalizedCandidate)
        ) {
          directUnresolvedDependencies.add(normalizedCandidate);
        }
      }
    }
    const directDependencies = [...directUnresolvedDependencies].sort();
    directUnresolvedDependencyCache.set(
      resolvedDependencyFile,
      directDependencies,
    );
    for (const directDependency of directDependencies) {
      unresolvedDependencies.add(directDependency);
    }
  }

  return [...unresolvedDependencies].sort();
};

const describeLegacyBackend = (
  _config: Options,
  rootDir: string,
): BackendDescriptor => {
  return Object.freeze({
    cacheFingerprint: createDependencyVersionFingerprint({
      packageNames: ["react-docgen-typescript", "typescript"],
      rootDir,
      schema: "legacy-backend-1",
    }),
    id: "react-docgen-typescript/legacy",
  });
};

const collectConfigProvenance = (
  configFiles: Iterable<string>,
  typescriptModule: typeof import("typescript"),
): string[] => {
  const discovered = new Set<string>();
  for (const configFile of normalizeBoundaryPaths(configFiles)) {
    discovered.add(configFile);
    const parsedConfig = typescriptModule.getParsedCommandLineOfConfigFile(
      configFile,
      {},
      {
        ...typescriptModule.sys,
        onUnRecoverableConfigFileDiagnostic() {},
      },
    );
    const configSourceFile = parsedConfig?.options.configFile;
    const extendedSourceFiles =
      configSourceFile &&
      typeof configSourceFile === "object" &&
      "extendedSourceFiles" in configSourceFile
        ? configSourceFile.extendedSourceFiles
        : undefined;
    for (const extendedConfig of extendedSourceFiles ?? []) {
      discovered.add(extendedConfig);
    }
  }
  return normalizeBoundaryPaths(discovered);
};

const cloneJsonValue = (value: DocgenJsonValue): DocgenJsonValue => {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        cloneJsonValue(nestedValue),
      ]),
    );
  }
  return value;
};

const cloneJsonRecord = (value: object) =>
  Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      cloneJsonValue(nestedValue as DocgenJsonValue),
    ]),
  );

const cloneParent = (parent: DocgenParent): DocgenParent => ({
  fileName: parent.fileName,
  name: parent.name,
});

const cloneMethod = (method: DocgenMethod): DocgenMethod => ({
  description: method.description,
  docblock: method.docblock,
  modifiers: [...method.modifiers],
  name: method.name,
  params: method.params.map((parameter) => ({
    ...(parameter.description !== undefined
      ? { description: parameter.description }
      : {}),
    name: parameter.name,
    type: { name: parameter.type.name },
  })),
  ...(method.returns !== undefined
    ? {
        returns:
          method.returns === null
            ? null
            : {
                ...(method.returns.description !== undefined
                  ? { description: method.returns.description }
                  : {}),
                ...(method.returns.type !== undefined
                  ? { type: method.returns.type }
                  : {}),
              },
      }
    : {}),
});

const toNeutralComponent = (
  component: ReturnType<typeof resolveComponentDocRuntimeTargets>[number],
): DocgenComponent => ({
  description: component.description,
  displayName: component.displayName,
  filePath: component.filePath,
  methods: component.methods.map(cloneMethod),
  props: Object.fromEntries(
    Object.entries(component.props).map(([name, prop]) => [
      name,
      {
        ...(prop.declarations
          ? { declarations: prop.declarations.map(cloneParent) }
          : {}),
        defaultValue: prop.defaultValue ?? null,
        description: prop.description,
        name: prop.name,
        ...(prop.parent ? { parent: cloneParent(prop.parent) } : {}),
        required: prop.required,
        ...(prop.tags ? { tags: cloneJsonRecord(prop.tags) } : {}),
        type: {
          name: prop.type.name,
          ...(prop.type.raw !== undefined ? { raw: prop.type.raw } : {}),
          ...(prop.type.value !== undefined
            ? {
                value: cloneJsonValue(prop.type.value as DocgenJsonValue),
              }
            : {}),
        },
      },
    ]),
  ),
  ...(component.tags ? { tags: cloneJsonRecord(component.tags) } : {}),
  targetExpression: component.targetExpression,
});

const createLegacyBackend = async (
  config: Options,
  rootDir: string,
  fileSelection: BackendFileSelection,
): Promise<DocgenBackend> => {
  const runtimeMode = resolveDocgenRuntimeMode(config);
  let project: TypescriptProject | undefined;
  let projectGeneration = 0;
  let initializationPromise: Promise<void> | null = null;
  let tsProgram: Program | undefined;
  let reusableTsBuilderProgram: SemanticDiagnosticsBuilderProgram | undefined;
  let typescriptModule: typeof import("typescript") | null = null;
  let docGenParser: FileParser | undefined;
  let dependencyCacheByProgram = new WeakMap<Program, ProgramDependencyCache>();
  const projectConfigFiles = new Set<string>();
  const projectDocgenFiles = new Set<string>();
  const projectTrackedFiles = new Set<string>();
  let syncedProjectFilesProgram: Program | undefined;
  let closeWatch: CloseWatch | undefined;
  let projectService: tss.server.ProjectService | null = null;
  const openProjectServiceFiles = new Map<
    Filepath,
    ProjectServiceOpenFileState
  >();
  const projectServiceProjectsByFile = new Map<
    Filepath,
    ProjectServiceProject
  >();
  let disposed = false;
  let latestRevision = 0;
  let lifecycleToken = 0;
  let pendingWatchUpdate:
    | {
        affectedFiles: Set<string>;
        changedFiles: Set<string>;
        promise: Promise<UpdateCompletion>;
        resolve(result: UpdateCompletion): void;
        revision: number;
      }
    | undefined;

  const clearDependencyAnalysisCache = () => {
    dependencyCacheByProgram = new WeakMap<Program, ProgramDependencyCache>();
  };

  const syncFiles = (target: Set<string>, fileNames: Iterable<string>) => {
    target.clear();
    for (const fileName of normalizeBoundaryPaths(fileNames))
      target.add(fileName);
  };

  const getProjectState = (): BackendProjectState => ({
    configFiles: normalizeBoundaryPaths(projectConfigFiles),
    docgenFiles: normalizeBoundaryPaths(projectDocgenFiles),
    generation: projectGeneration,
    trackedFiles: normalizeBoundaryPaths(projectTrackedFiles),
  });

  const collectProjectConfigFilesFromProgram = (
    nextProject: TypescriptProject,
    program: Program,
  ) => {
    const nextConfigFiles = new Set([
      ...projectConfigFiles,
      ...nextProject.configFiles,
    ]);
    const pendingReferences = [
      ...(program.getResolvedProjectReferences() ?? []),
    ];
    while (pendingReferences.length > 0) {
      const reference = pendingReferences.pop();
      if (!reference) continue;
      nextConfigFiles.add(reference.sourceFile.fileName);
      pendingReferences.push(...(reference.references ?? []));
    }
    return normalizeBoundaryPaths(nextConfigFiles);
  };

  const collectTrackedProjectFilesFromProgram = (
    nextProject: TypescriptProject,
    program: Program,
  ) => {
    const nextTrackedFiles = new Set(nextProject.projectFiles);
    for (const sourceFile of program.getSourceFiles()) {
      if (!program.isSourceFileDefaultLibrary(sourceFile)) {
        nextTrackedFiles.add(sourceFile.fileName);
      }
    }
    const pendingReferences = [
      ...(program.getResolvedProjectReferences() ?? []),
    ];
    while (pendingReferences.length > 0) {
      const reference = pendingReferences.pop();
      if (!reference) continue;
      for (const fileName of reference.commandLine.fileNames) {
        nextTrackedFiles.add(fileName);
      }
      pendingReferences.push(...(reference.references ?? []));
    }
    return normalizeBoundaryPaths(nextTrackedFiles);
  };

  const syncProjectFilesFromProgram = (
    nextProject: TypescriptProject,
    program: Program,
  ) => {
    if (syncedProjectFilesProgram === program) return;
    syncedProjectFilesProgram = program;
    syncFiles(
      projectConfigFiles,
      collectProjectConfigFilesFromProgram(nextProject, program),
    );
    syncFiles(
      projectTrackedFiles,
      collectTrackedProjectFilesFromProgram(nextProject, program),
    );
  };

  const syncInitialProjectFiles = (nextProject: TypescriptProject) => {
    syncedProjectFilesProgram = undefined;
    syncFiles(
      projectConfigFiles,
      typescriptModule
        ? collectConfigProvenance(nextProject.configFiles, typescriptModule)
        : nextProject.configFiles,
    );
    syncFiles(projectDocgenFiles, nextProject.docgenFiles);
    syncFiles(projectTrackedFiles, nextProject.projectFiles);
  };

  const settlePendingWatchUpdate = (result: UpdateCompletion) => {
    const pending = pendingWatchUpdate;
    pendingWatchUpdate = undefined;
    pending?.resolve(result);
  };

  const isPendingWatchUpdateReady = (program: Program) => {
    if (!pendingWatchUpdate) return true;
    for (const changedFile of pendingWatchUpdate.changedFiles) {
      if (!existsSync(changedFile)) continue;
      const sourceFile = program.getSourceFile(changedFile);
      if (
        !sourceFile ||
        sourceFile.text !== readFileSync(changedFile, "utf-8")
      ) {
        return false;
      }
    }
    return true;
  };

  const closeProjectServiceClientFile = (fileName: Filepath) => {
    if (!openProjectServiceFiles.has(fileName)) return;
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
    if (!currentState) return;
    openProjectServiceFiles.delete(fileName);
    openProjectServiceFiles.set(fileName, currentState);
  };

  const pruneProjectServiceOpenFiles = (preserveFile?: Filepath) => {
    while (openProjectServiceFiles.size > MAX_OPEN_PROJECT_SERVICE_FILES) {
      const fileToClose = [...openProjectServiceFiles.keys()].find(
        (fileName) => fileName !== preserveFile,
      );
      if (!fileToClose) return;
      closeProjectServiceClientFile(fileToClose);
    }
  };

  const openProjectServiceClientFile = (fileName: Filepath, source: string) => {
    if (!projectService) {
      throw new Error("Internal error: project service was not initialized");
    }
    const currentState = openProjectServiceFiles.get(fileName);
    if (currentState?.source !== source) {
      projectService.openClientFile(fileName, source, undefined, rootDir);
      projectServiceProjectsByFile.delete(fileName);
    }
    openProjectServiceFiles.delete(fileName);
    openProjectServiceFiles.set(fileName, { source });
    pruneProjectServiceOpenFiles(fileName);
  };

  const syncProjectServiceFileFromDisk = (fileName: Filepath) => {
    if (!projectService) return false;
    if (!existsSync(fileName)) {
      closeProjectServiceClientFile(fileName);
      return false;
    }
    const source = readFileSync(fileName, "utf-8");
    const wasAlreadyOpen = openProjectServiceFiles.has(fileName);
    projectService.openClientFile(fileName, source, undefined, rootDir);
    projectServiceProjectsByFile.delete(fileName);
    if (wasAlreadyOpen) {
      openProjectServiceFiles.delete(fileName);
      openProjectServiceFiles.set(fileName, { source });
      pruneProjectServiceOpenFiles(fileName);
    }
    return !wasAlreadyOpen;
  };

  const reloadProjectService = () => {
    projectServiceProjectsByFile.clear();
    projectService?.reloadProjects();
  };

  const refreshProjectServiceProjects = (
    changedFile: Filepath,
    affectedFiles: Iterable<Filepath>,
  ) => {
    if (!projectService) return;
    const affectedProjects = new Set<ProjectServiceProject>();
    const addProject = (candidate: ProjectServiceProject | undefined) => {
      if (candidate && !candidate.isClosed()) affectedProjects.add(candidate);
    };
    addProject(projectServiceProjectsByFile.get(changedFile));
    for (const fileName of affectedFiles) {
      addProject(projectServiceProjectsByFile.get(fileName));
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
      for (const [fileName, cachedProject] of projectServiceProjectsByFile) {
        if (fileName === changedFile || affectedProjects.has(cachedProject)) {
          projectServiceProjectsByFile.delete(fileName);
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
    if (!projectService) return undefined;
    openProjectServiceClientFile(fileName, source);
    const scriptInfo = projectService.getScriptInfo(fileName);
    if (!scriptInfo?.fileName) return undefined;
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
    if (!nextProject) return undefined;
    projectServiceProjectsByFile.set(fileName, nextProject);
    touchProjectServiceOpenFile(fileName);
    return nextProject.getLanguageService(true).getProgram();
  };

  const closeRuntimeState = ({
    preserveReusableProgram = false,
  }: {
    preserveReusableProgram?: boolean;
  } = {}) => {
    closeWatch?.();
    closeWatch = undefined;
    if (projectService && project) {
      closeAllProjectServiceClientFiles();
      projectServiceProjectsByFile.clear();
      closeProjectService(projectService, project.projectName);
    }
    projectService = null;
    if (!preserveReusableProgram) reusableTsBuilderProgram = undefined;
    syncedProjectFilesProgram = undefined;
    tsProgram = undefined;
  };

  const clearProjectContext = () => {
    project = undefined;
    docGenParser = undefined;
    clearDependencyAnalysisCache();
    syncedProjectFilesProgram = undefined;
    projectConfigFiles.clear();
    projectDocgenFiles.clear();
    projectTrackedFiles.clear();
    reusableTsBuilderProgram = undefined;
  };

  const hasRuntimeState = () =>
    runtimeMode === "projectService"
      ? projectService !== null
      : runtimeMode === "watch"
        ? tsProgram !== undefined && closeWatch !== undefined
        : tsProgram !== undefined;

  const isObsoleteLifecycle = (token: number) =>
    disposed || token !== lifecycleToken;

  const clearBackendState = () => {
    closeRuntimeState();
    clearProjectContext();
  };

  const ensureInitialized = async (): Promise<void> => {
    if (disposed) throw new Error("Docgen backend has been disposed");
    if (project && docGenParser && hasRuntimeState()) return;
    if (initializationPromise) return initializationPromise;
    const token = lifecycleToken;
    const pendingInitialization = (async () => {
      typescriptModule ??= await loadTypescript();
      const activeTypescriptModule = typescriptModule;
      if (isObsoleteLifecycle(token)) return;
      if (!project || !docGenParser) {
        const nextProject = await resolveTypescriptProject(
          config,
          rootDir,
          activeTypescriptModule,
          fileSelection as ResolvedFileSelection,
        );
        if (isObsoleteLifecycle(token)) return;
        const nextDocgenParser = await getDocgen(
          config,
          nextProject.compilerOptions,
        );
        if (isObsoleteLifecycle(token)) return;
        project = nextProject;
        docGenParser = nextDocgenParser;
        projectGeneration += 1;
        clearDependencyAnalysisCache();
        syncInitialProjectFiles(nextProject);
      }
      const activeProject = project;
      if (!activeProject || isObsoleteLifecycle(token)) return;
      if (runtimeMode === "projectService") {
        if (!projectService) {
          const nextProjectService = await createProjectService(activeProject);
          if (isObsoleteLifecycle(token)) {
            closeProjectService(nextProjectService, activeProject.projectName);
            return;
          }
          projectService = nextProjectService;
        }
      } else if (runtimeMode === "watch") {
        if (!tsProgram || !closeWatch) {
          const [nextProgram, nextCloseWatch] = await startWatch(
            activeProject,
            activeTypescriptModule,
            (program) => {
              if (isObsoleteLifecycle(token)) return;
              clearDependencyAnalysisCache();
              reusableTsBuilderProgram = undefined;
              tsProgram = program;
              syncProjectFilesFromProgram(activeProject, program);
              if (pendingWatchUpdate && isPendingWatchUpdateReady(program)) {
                settlePendingWatchUpdate({
                  project: getProjectState(),
                  revision: pendingWatchUpdate.revision,
                  status: "ready",
                });
              }
            },
          );
          if (isObsoleteLifecycle(token)) {
            nextCloseWatch();
            return;
          }
          tsProgram = nextProgram;
          closeWatch = nextCloseWatch;
          syncProjectFilesFromProgram(activeProject, nextProgram);
        }
      } else if (!tsProgram) {
        const nextBuilderProgram = await createProgram(
          activeProject,
          activeTypescriptModule,
          reusableTsBuilderProgram,
        );
        if (isObsoleteLifecycle(token)) return;
        reusableTsBuilderProgram = nextBuilderProgram;
        tsProgram = nextBuilderProgram.getProgram();
        syncProjectFilesFromProgram(activeProject, tsProgram);
      }
    })();
    initializationPromise = pendingInitialization;
    try {
      await pendingInitialization;
    } finally {
      if (initializationPromise === pendingInitialization) {
        initializationPromise = null;
      }
    }
  };

  const initialize = async (): Promise<BackendProjectState> => {
    await ensureInitialized();
    return getProjectState();
  };

  const analyze = async ({
    fileName,
    revision,
    source,
  }: {
    fileName: string;
    revision: number;
    source: string;
  }): Promise<AnalyzeResult> => {
    latestRevision = Math.max(latestRevision, revision);
    const normalizedFileName = normalizeBoundaryPath(fileName);
    while (pendingWatchUpdate?.affectedFiles.has(normalizedFileName)) {
      const pending = pendingWatchUpdate;
      const completion = await pending.promise;
      if (completion.status !== "superseded") break;
    }
    await ensureInitialized();
    let activeProgram: Program | undefined;
    const collectDependencies = () =>
      activeProgram && project && typescriptModule
        ? collectTrackedFileDependencies(
            normalizedFileName,
            dependencyCacheByProgram,
            activeProgram,
            projectTrackedFiles,
            typescriptModule,
          )
        : [];

    try {
      if (!docGenParser) {
        throw new Error("Internal error: docgen parser was not initialized");
      }
      const componentDocs = docGenParser.parseWithProgramProvider(
        normalizedFileName,
        () => {
          if (tsProgram) {
            activeProgram = tsProgram;
            return tsProgram;
          }
          const languageServiceProgram = getProjectServiceProgram(
            normalizedFileName,
            source,
          );
          if (languageServiceProgram) {
            activeProgram = languageServiceProgram;
            return languageServiceProgram;
          }
          throw new Error("Internal error: no TypeScript program available");
        },
      );
      if (activeProgram && project)
        syncProjectFilesFromProgram(project, activeProgram);
      const dependencies = normalizeBoundaryPaths(collectDependencies());
      const unresolvedDependencies =
        activeProgram && project && typescriptModule
          ? collectUnresolvedModuleDependencies(
              dependencies,
              dependencyCacheByProgram,
              activeProgram,
              typescriptModule,
            )
          : [];
      const components =
        activeProgram && typescriptModule
          ? resolveComponentDocRuntimeTargets(
              componentDocs,
              activeProgram.getTypeChecker(),
              activeProgram.getSourceFile(normalizedFileName) ??
                (() => {
                  throw new Error(
                    `Internal error: source file "${normalizedFileName}" was not found in the active TypeScript program`,
                  );
                })(),
              typescriptModule,
            ).map(toNeutralComponent)
          : componentDocs.map((component) =>
              toNeutralComponent({ ...component, targetExpression: null }),
            );
      return {
        components,
        dependencies,
        project: getProjectState(),
        revision,
        status: "ok",
        unresolvedDependencies,
      };
    } catch (error) {
      const dependencies = normalizeBoundaryPaths(collectDependencies());
      return {
        dependencies,
        error: toBackendErrorRecord(error),
        project: getProjectState(),
        revision,
        status: "error",
        unresolvedDependencies:
          activeProgram && project && typescriptModule
            ? collectUnresolvedModuleDependencies(
                dependencies,
                dependencyCacheByProgram,
                activeProgram,
                typescriptModule,
              )
            : [],
      };
    }
  };

  const reset = async ({
    revision,
  }: {
    revision: number;
  }): Promise<ResetCompletion> => {
    if (revision < latestRevision) {
      return {
        revision,
        status: "superseded",
        supersededBy: latestRevision,
      };
    }
    latestRevision = Math.max(latestRevision, revision);
    const pendingInitialization = initializationPromise;
    lifecycleToken += 1;
    if (pendingWatchUpdate) {
      settlePendingWatchUpdate({
        revision: pendingWatchUpdate.revision,
        status: "superseded",
        supersededBy: revision,
      });
    }
    clearBackendState();
    await pendingInitialization?.catch(() => undefined);
    if (initializationPromise === pendingInitialization) {
      initializationPromise = null;
    }
    clearBackendState();
    return disposed
      ? { revision, status: "disposed" }
      : { revision, status: "reset" };
  };

  const update = async ({
    affectedComponentFiles,
    change,
  }: Parameters<DocgenBackend["update"]>[0]): Promise<FileUpdateResult> => {
    if (change.revision < latestRevision) {
      return { revision: change.revision, status: "ignored" };
    }
    latestRevision = Math.max(latestRevision, change.revision);
    const changedFile = normalizeBoundaryPath(change.fileName);
    const affectedFiles = normalizeBoundaryPaths(affectedComponentFiles);
    if (disposed) return { revision: change.revision, status: "ignored" };
    if (projectConfigFiles.has(changedFile)) {
      await reset({ revision: change.revision });
      return { revision: change.revision, status: "project-reset" };
    }
    const isPotentialTypescriptFile = TYPESCRIPT_FILE_PATTERN.test(changedFile);
    if (change.kind === "delete" && isPotentialTypescriptFile) {
      await reset({ revision: change.revision });
      if (disposed) {
        return { revision: change.revision, status: "ignored" };
      }
      await ensureInitialized();
      return {
        project: getProjectState(),
        revision: change.revision,
        status: "ready",
      };
    }
    if (change.kind === "create" && isPotentialTypescriptFile) {
      typescriptModule ??= await loadTypescript();
      const candidateProject = await resolveTypescriptProject(
        config,
        rootDir,
        typescriptModule,
        fileSelection as ResolvedFileSelection,
      );
      let isCandidateProjectMember =
        candidateProject.projectFiles.includes(changedFile);
      if (!isCandidateProjectMember) {
        const candidateProgram = await createProgram(
          candidateProject,
          typescriptModule,
        );
        isCandidateProjectMember = collectTrackedProjectFilesFromProgram(
          candidateProject,
          candidateProgram.getProgram(),
        ).includes(changedFile);
      }
      if (!isCandidateProjectMember) {
        return { revision: change.revision, status: "ignored" };
      }
      await reset({ revision: change.revision });
      if (disposed) {
        return { revision: change.revision, status: "ignored" };
      }
      await ensureInitialized();
      const refreshedProject = getProjectState();
      return projectTrackedFiles.has(changedFile)
        ? {
            project: refreshedProject,
            revision: change.revision,
            status: "ready",
          }
        : { revision: change.revision, status: "ignored" };
    }
    const isTracked = project
      ? projectTrackedFiles.has(changedFile) ||
        (!project.tsconfigPath && isPotentialTypescriptFile)
      : isPotentialTypescriptFile;
    if (!isTracked) return { revision: change.revision, status: "ignored" };
    clearDependencyAnalysisCache();
    if (runtimeMode === "watch") {
      if (!project || !hasRuntimeState()) {
        return { revision: change.revision, status: "ignored" };
      }
      const carriedAffectedFiles = pendingWatchUpdate
        ? [...pendingWatchUpdate.affectedFiles]
        : [];
      const carriedChangedFiles = pendingWatchUpdate
        ? [...pendingWatchUpdate.changedFiles]
        : [];
      if (pendingWatchUpdate) {
        settlePendingWatchUpdate({
          revision: pendingWatchUpdate.revision,
          status: "superseded",
          supersededBy: change.revision,
        });
      }
      let resolvePending: ((result: UpdateCompletion) => void) | undefined;
      const promise = new Promise<UpdateCompletion>((resolve) => {
        resolvePending = resolve;
      });
      pendingWatchUpdate = {
        affectedFiles: new Set([...carriedAffectedFiles, ...affectedFiles]),
        changedFiles: new Set([...carriedChangedFiles, changedFile]),
        promise,
        resolve: (result) => resolvePending?.(result),
        revision: change.revision,
      };
      return { ready: promise, revision: change.revision, status: "pending" };
    }
    if (runtimeMode === "projectService") {
      if (projectService) {
        const closeTemporaryFile = syncProjectServiceFileFromDisk(changedFile);
        try {
          refreshProjectServiceProjects(changedFile, affectedFiles);
        } finally {
          if (closeTemporaryFile) projectService.closeClientFile(changedFile);
        }
      }
    } else {
      closeRuntimeState({ preserveReusableProgram: true });
    }
    return {
      project: getProjectState(),
      revision: change.revision,
      status: "ready",
    };
  };

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    const pendingInitialization = initializationPromise;
    lifecycleToken += 1;
    if (pendingWatchUpdate) {
      settlePendingWatchUpdate({
        revision: pendingWatchUpdate.revision,
        status: "disposed",
      });
    }
    clearBackendState();
    await pendingInitialization?.catch(() => undefined);
    if (initializationPromise === pendingInitialization) {
      initializationPromise = null;
    }
    clearBackendState();
  };

  return {
    analyze,
    dispose,
    initialize,
    recordCacheHit({ fileName }) {
      if (runtimeMode === "projectService") {
        touchProjectServiceOpenFile(normalizeBoundaryPath(fileName));
      }
    },
    reset,
    update,
  };
};

export function createLegacyBackendFactory(
  config: Options = {},
): DocgenBackendFactory {
  resolveDocgenRuntimeMode(config);
  return {
    async create({ rootDir, selection }) {
      return createLegacyBackend(
        config,
        normalizeBoundaryPath(rootDir),
        selection,
      );
    },
    describe({ rootDir }) {
      return describeLegacyBackend(config, rootDir);
    },
  };
}
