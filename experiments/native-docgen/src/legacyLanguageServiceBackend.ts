import path from "node:path";
import ts from "typescript6";
import type {
  AnalyzeResult,
  BackendDescriptor,
  BackendFileSelection,
  BackendProjectState,
  DocgenBackend,
  DocgenBackendFactory,
  FileUpdateResult,
  ResetCompletion,
} from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts";
import { toBackendErrorRecord } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts";
import { normalizeBoundaryPaths } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/pathIdentity.ts";
import type {
  DocgenComponent,
  DocgenJsonValue,
  DocgenParent,
  DocgenProp,
} from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/types.ts";
import type { NativeBackendOptions } from "./nativeBackend.ts";

interface ControlOptions extends NativeBackendOptions {
  documentRegistry?: boolean;
}

export interface ControlInstrumentation {
  analyzeCalls: number;
  componentCount: number;
  languageServicesCreated: number;
  propCount: number;
  programRequests: number;
  updates: number;
}

interface ParsedProjects {
  compilerOptions: ts.CompilerOptions;
  configFiles: readonly string[];
  files: readonly string[];
}

const parseProjects = (rootConfig: string): ParsedProjects => {
  const configFiles = new Set<string>();
  const files = new Set<string>();
  const pending = [path.resolve(rootConfig)];
  let compilerOptions: ts.CompilerOptions | undefined;

  while (pending.length > 0) {
    const configFile = pending.pop();
    if (!configFile || configFiles.has(configFile)) continue;
    configFiles.add(configFile);
    const read = ts.readConfigFile(configFile, ts.sys.readFile);
    if (read.error) {
      throw new Error(
        ts.flattenDiagnosticMessageText(read.error.messageText, "\n"),
      );
    }
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      path.dirname(configFile),
      undefined,
      configFile,
    );
    compilerOptions ??= parsed.options;
    for (const fileName of parsed.fileNames) files.add(path.resolve(fileName));
    for (const reference of parsed.projectReferences ?? []) {
      const target = path.resolve(reference.path);
      pending.push(
        path.extname(target) ? target : path.join(target, "tsconfig.json"),
      );
    }
  }

  return {
    compilerOptions: compilerOptions ?? {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
    },
    configFiles: [...configFiles].sort(),
    files: [...files].sort(),
  };
};

const tagsToRecord = (
  tags: readonly ts.JSDocTagInfo[],
): Readonly<Record<string, DocgenJsonValue>> => {
  const values: Record<string, DocgenJsonValue> = {};
  for (const tag of tags) {
    const text = ts.displayPartsToString(tag.text);
    const existing = values[tag.name];
    if (existing === undefined) values[tag.name] = text;
    else if (Array.isArray(existing)) values[tag.name] = [...existing, text];
    else values[tag.name] = [existing, text];
  }
  return values;
};

const findParent = (declaration: ts.Declaration): DocgenParent | undefined => {
  let current: ts.Node | undefined = declaration.parent;
  while (current) {
    if (
      (ts.isInterfaceDeclaration(current) ||
        ts.isTypeAliasDeclaration(current) ||
        ts.isClassDeclaration(current)) &&
      current.name
    ) {
      return {
        fileName: path.resolve(current.getSourceFile().fileName),
        name: current.name.text,
      };
    }
    current = current.parent;
  }
  return undefined;
};

const defaultValueFor = (
  signature: ts.Signature,
  propName: string,
): DocgenJsonValue | null => {
  const declaration = signature.getDeclaration();
  const parameter = declaration?.parameters[0];
  if (!parameter || !ts.isObjectBindingPattern(parameter.name)) return null;
  const element = parameter.name.elements.find((candidate) => {
    const name = candidate.propertyName ?? candidate.name;
    return ts.isIdentifier(name) && name.text === propName;
  });
  if (!element?.initializer) return null;
  return {
    value: ts.isStringLiteral(element.initializer)
      ? element.initializer.text
      : element.initializer.getText(),
  };
};

const findCandidates = (sourceFile: ts.SourceFile) => {
  const functions: Array<{ name: string; node: ts.Identifier }> = [];
  const variables: Array<{ name: string; node: ts.Identifier }> = [];
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      statement.name &&
      /^[A-Z]/.test(statement.name.text)
    ) {
      functions.push({ name: statement.name.text, node: statement.name });
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          /^[A-Z]/.test(declaration.name.text)
        ) {
          variables.push({
            name: declaration.name.text,
            node: declaration.name,
          });
        }
      }
    }
  }
  return [...functions, ...variables];
};

const extractComponents = ({
  checker,
  fileName,
  instrumentation,
  options,
  sourceFile,
}: {
  checker: ts.TypeChecker;
  fileName: string;
  instrumentation: ControlInstrumentation;
  options: ControlOptions;
  sourceFile: ts.SourceFile;
}): readonly DocgenComponent[] => {
  if (options.componentNameResolver !== undefined) {
    throw new Error(
      "CONTROL_UNSUPPORTED_OPTION: componentNameResolver requires a legacy callback contract",
    );
  }
  const components: DocgenComponent[] = [];

  for (const candidate of findCandidates(sourceFile)) {
    const symbol = checker.getSymbolAtLocation(candidate.node);
    if (!symbol) continue;
    const type = checker.getTypeOfSymbolAtLocation(symbol, candidate.node);
    const signature = type.getCallSignatures()[0];
    if (!signature) continue;
    const props: Record<string, DocgenProp> = {};
    const parameter = signature.getParameters()[0];
    const parameterDeclaration =
      parameter?.valueDeclaration ?? parameter?.declarations?.[0];

    if (parameter && parameterDeclaration) {
      const propsType = checker.getTypeOfSymbolAtLocation(
        parameter,
        parameterDeclaration,
      );
      for (const property of checker.getPropertiesOfType(propsType)) {
        const declaration =
          property.valueDeclaration ?? property.declarations?.[0];
        if (!declaration) continue;
        const propertyType = checker.getTypeOfSymbolAtLocation(
          property,
          declaration,
        );
        const raw = checker.typeToString(propertyType);
        const isUnion = propertyType.isUnion();
        const parent = findParent(declaration);
        const description = ts.displayPartsToString(
          property.getDocumentationComment(checker),
        );
        const prop: DocgenProp = {
          ...(parent ? { declarations: [parent], parent } : {}),
          defaultValue: defaultValueFor(signature, property.name),
          description,
          name: property.name,
          required: (property.flags & ts.SymbolFlags.Optional) === 0,
          tags: tagsToRecord(property.getJsDocTags(checker)),
          type:
            options.shouldExtractValuesFromUnion && isUnion
              ? {
                  name: "enum",
                  raw,
                  value: propertyType.types.map((member) => ({
                    value: checker.typeToString(member),
                  })),
                }
              : { name: raw },
        };
        if (options.skipPropsWithoutDoc && !description) continue;
        if (
          options.propFilter &&
          !options.propFilter({ componentName: candidate.name, prop })
        ) {
          continue;
        }
        props[property.name] = prop;
        instrumentation.propCount += 1;
      }
    }

    components.push({
      description: ts.displayPartsToString(
        symbol.getDocumentationComment(checker),
      ),
      displayName: candidate.name,
      filePath: path.resolve(fileName),
      methods: [],
      props,
      tags: tagsToRecord(symbol.getJsDocTags(checker)),
      targetExpression: candidate.name,
    });
    instrumentation.componentCount += 1;
  }
  return components;
};

const collectDependencies = (
  entryFile: string,
  program: ts.Program,
): readonly string[] => {
  const options = program.getCompilerOptions();
  const cache = ts.createModuleResolutionCache(
    program.getCurrentDirectory(),
    (value) => value,
    options,
  );
  const tracked = new Map(
    program
      .getSourceFiles()
      .filter((sourceFile) => !program.isSourceFileDefaultLibrary(sourceFile))
      .map((sourceFile) => [
        path.resolve(sourceFile.fileName).toLowerCase(),
        path.resolve(sourceFile.fileName),
      ]),
  );
  const visited = new Set<string>();
  const pending = [path.resolve(entryFile)];

  while (pending.length > 0) {
    const fileName = pending.pop();
    if (!fileName || visited.has(fileName)) continue;
    const sourceFile = program.getSourceFile(fileName);
    if (!sourceFile || program.isSourceFileDefaultLibrary(sourceFile)) continue;
    visited.add(fileName);
    const preprocessed = ts.preProcessFile(sourceFile.text, true, true);
    for (const imported of preprocessed.importedFiles) {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        fileName,
        options,
        ts.sys,
        cache,
      ).resolvedModule?.resolvedFileName;
      const dependency = resolved
        ? tracked.get(path.resolve(resolved).toLowerCase())
        : undefined;
      if (dependency) pending.push(dependency);
    }
    for (const reference of preprocessed.referencedFiles) {
      const dependency = tracked.get(
        path.resolve(path.dirname(fileName), reference.fileName).toLowerCase(),
      );
      if (dependency) pending.push(dependency);
    }
  }
  return normalizeBoundaryPaths(visited);
};

export class Typescript6ControlBackend implements DocgenBackend {
  readonly instrumentation: ControlInstrumentation = {
    analyzeCalls: 0,
    componentCount: 0,
    languageServicesCreated: 0,
    propCount: 0,
    programRequests: 0,
    updates: 0,
  };

  private readonly options: ControlOptions;
  private readonly parsed: ParsedProjects;
  private readonly rootDir: string;
  private readonly selection: BackendFileSelection;
  private readonly versions = new Map<string, number>();
  private readonly overlay = new Map<string, string | null>();
  private disposed = false;
  private generation = 0;
  private languageService: ts.LanguageService | undefined;
  private rootFiles: Set<string>;

  constructor({
    options,
    rootDir,
    selection,
  }: {
    options: ControlOptions;
    rootDir: string;
    selection: BackendFileSelection;
  }) {
    this.options = options;
    this.rootDir = path.resolve(rootDir);
    this.selection = selection;
    const configFile = path.resolve(
      rootDir,
      options.tsconfigPath ?? "tsconfig.json",
    );
    this.parsed = parseProjects(configFile);
    this.rootFiles = new Set(this.parsed.files);
  }

  private state(): BackendProjectState {
    const trackedFiles = [...this.rootFiles].sort();
    return {
      configFiles: [...this.parsed.configFiles],
      docgenFiles: trackedFiles.filter((fileName) =>
        this.selection.matchesDocgenFile(fileName),
      ),
      generation: this.generation,
      trackedFiles,
    };
  }

  private ensureLanguageService(): ts.LanguageService {
    if (this.disposed) throw new Error("TypeScript 6 control is disposed");
    if (this.languageService) return this.languageService;
    const host: ts.LanguageServiceHost = {
      directoryExists: ts.sys.directoryExists,
      fileExists: (fileName) => {
        const normalized = path.resolve(fileName);
        const value = this.overlay.get(normalized);
        return value === null
          ? false
          : value === undefined
            ? ts.sys.fileExists(normalized)
            : true;
      },
      getCompilationSettings: () => this.parsed.compilerOptions,
      getCurrentDirectory: () => this.rootDir,
      getDefaultLibFileName: ts.getDefaultLibFilePath,
      getDirectories: ts.sys.getDirectories,
      getProjectVersion: () => String(this.generation),
      getScriptFileNames: () => [...this.rootFiles],
      getScriptSnapshot: (fileName) => {
        const normalized = path.resolve(fileName);
        const value = this.overlay.get(normalized);
        if (value === null) return undefined;
        const source = value ?? ts.sys.readFile(normalized);
        return source === undefined
          ? undefined
          : ts.ScriptSnapshot.fromString(source);
      },
      getScriptVersion: (fileName) =>
        String(this.versions.get(path.resolve(fileName)) ?? 0),
      readDirectory: ts.sys.readDirectory,
      readFile: (fileName) => {
        const normalized = path.resolve(fileName);
        const value = this.overlay.get(normalized);
        return value === null
          ? undefined
          : value === undefined
            ? ts.sys.readFile(normalized)
            : value;
      },
      realpath: ts.sys.realpath,
    };
    this.languageService = ts.createLanguageService(
      host,
      this.options.documentRegistry === false
        ? undefined
        : ts.createDocumentRegistry(true, this.rootDir),
    );
    this.instrumentation.languageServicesCreated += 1;
    return this.languageService;
  }

  async initialize(): Promise<BackendProjectState> {
    this.ensureLanguageService();
    return this.state();
  }

  async analyze({
    fileName,
    revision,
    source,
  }: Parameters<DocgenBackend["analyze"]>[0]): Promise<AnalyzeResult> {
    const normalized = path.resolve(fileName);
    if (this.overlay.get(normalized) !== source) {
      this.overlay.set(normalized, source);
      this.rootFiles.add(normalized);
      this.versions.set(normalized, (this.versions.get(normalized) ?? 0) + 1);
      this.generation = Math.max(this.generation, revision);
    }
    this.instrumentation.analyzeCalls += 1;
    this.instrumentation.programRequests += 1;
    const project = this.state();

    try {
      const program = this.ensureLanguageService().getProgram();
      const sourceFile = program?.getSourceFile(normalized);
      if (!program || !sourceFile)
        throw new Error(`Control project does not contain ${normalized}`);
      const components = extractComponents({
        checker: program.getTypeChecker(),
        fileName: normalized,
        instrumentation: this.instrumentation,
        options: this.options,
        sourceFile,
      });
      return {
        components,
        dependencies: collectDependencies(normalized, program),
        project,
        revision,
        status: "ok",
      };
    } catch (error) {
      return {
        dependencies: [normalized],
        error: toBackendErrorRecord(error),
        project,
        revision,
        status: "error",
      };
    }
  }

  async update({
    change,
  }: Parameters<DocgenBackend["update"]>[0]): Promise<FileUpdateResult> {
    this.instrumentation.updates += 1;
    const fileName = path.resolve(change.fileName);
    if (this.parsed.configFiles.includes(fileName)) {
      await this.reset({ revision: change.revision });
      return { revision: change.revision, status: "project-reset" };
    }
    this.overlay.set(fileName, change.kind === "delete" ? null : change.source);
    if (change.kind === "delete") this.rootFiles.delete(fileName);
    else this.rootFiles.add(fileName);
    this.versions.set(fileName, (this.versions.get(fileName) ?? 0) + 1);
    this.generation = Math.max(this.generation, change.revision);
    return {
      project: this.state(),
      revision: change.revision,
      status: "ready",
    };
  }

  recordCacheHit(): void {}

  async reset({ revision }: { revision: number }): Promise<ResetCompletion> {
    if (this.disposed) return { revision, status: "disposed" };
    this.languageService?.dispose();
    this.languageService = undefined;
    this.generation = revision;
    return { revision, status: "reset" };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.languageService?.dispose();
    this.languageService = undefined;
  }
}

export const createTypescript6ControlFactory = (
  options: ControlOptions,
): DocgenBackendFactory => ({
  create: async ({ rootDir, selection }) =>
    new Typescript6ControlBackend({ options, rootDir, selection }),
  describe({ rootDir }): BackendDescriptor {
    return {
      cacheFingerprint: JSON.stringify({
        documentRegistry: options.documentRegistry !== false,
        extractorSchema: 1,
        rootDir: path.resolve(rootDir),
        version: ts.version,
      }),
      id: "typescript6-direct-control",
    };
  },
});
