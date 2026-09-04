import { existsSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type {
  BindingElement,
  Node as NativeNode,
  SourceFile as NativeSourceFile,
} from "typescript7next/unstable/ast";
import type {
  API as NativeApi,
  Checker as NativeChecker,
  Program as NativeProgram,
  Project as NativeProject,
  Snapshot as NativeSnapshot,
  Symbol as NativeSymbol,
  Type as NativeType,
} from "typescript7next/unstable/sync";
import { createDependencyVersionFingerprint } from "../utils/cache";
import { defaultPropFilter } from "../utils/filter";
import type { Options } from "../utils/options";
import type {
  AnalyzeInput,
  AnalyzeResult,
  BackendDescriptor,
  BackendFileSelection,
  BackendProjectState,
  DocgenBackend,
  DocgenBackendFactory,
  FileUpdateResult,
  ResetCompletion,
} from "./backend";
import { toBackendErrorRecord } from "./backend";
import { normalizeBoundaryPath, normalizeBoundaryPaths } from "./pathIdentity";
import { isSupportedRuntimeTargetExpression } from "./runtimeTarget";
import type {
  DocgenComponent,
  DocgenJsonValue,
  DocgenParent,
  DocgenProp,
  DocgenPropType,
} from "./types";

type NativeSyncModule = typeof import("typescript7next/unstable/sync");
type NativeAstModule = typeof import("typescript7next/unstable/ast");

interface InstrumentableNativeClient {
  apiRequest(method: string, params?: unknown): unknown;
  apiRequestBinary(method: string, params?: unknown): Uint8Array | undefined;
}

interface NativeRequestProfile {
  readonly batchRequestCount: number;
  readonly batchedLogicalRequestCount: number;
  readonly logicalMethods: Readonly<Record<string, number>>;
  readonly logicalRequestCount: number;
  readonly maxBatchSize: number;
  readonly physicalMethods: Readonly<Record<string, number>>;
  readonly physicalRequestCount: number;
}

interface NativeExtractionResult {
  readonly components: readonly DocgenComponent[];
  readonly dependencies: ReadonlySet<string>;
}

export interface NativeBackendLoaders {
  loadAst(): Promise<NativeAstModule>;
  loadSync(): Promise<NativeSyncModule>;
}

const NATIVE_TYPESCRIPT_PACKAGE =
  process.env.VITE_RDT_NATIVE_TYPESCRIPT_PACKAGE ?? "typescript";
const NATIVE_AST_SPECIFIER = `${NATIVE_TYPESCRIPT_PACKAGE}/unstable/ast`;
const NATIVE_SYNC_SPECIFIER = `${NATIVE_TYPESCRIPT_PACKAGE}/unstable/sync`;
const TYPESCRIPT_FILE_PATTERN = /\.[cm]?[jt]sx?$/;
const NODE_MODULES_SEGMENT_PATTERN = /(?:^|[\\/])node_modules(?:[\\/]|$)/i;
const IDENTIFIER_PATTERN = /^[$A-Z_a-z][$\w]*$/;
const MAX_NATIVE_ANALYSIS_BATCH_SIZE = 256;

const incrementRequestCount = (counts: Map<string, number>, method: string) => {
  counts.set(method, (counts.get(method) ?? 0) + 1);
};

const toSortedRecord = (counts: ReadonlyMap<string, number>) =>
  Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );

const createNativeRequestProfiler = (api: NativeApi) => {
  const client = (
    api as unknown as { readonly client?: InstrumentableNativeClient }
  ).client;
  if (!client) {
    throw new Error(
      "TypeScript's native API client is unavailable for benchmark profiling",
    );
  }

  const logicalMethods = new Map<string, number>();
  const physicalMethods = new Map<string, number>();
  let batchRequestCount = 0;
  let batchedLogicalRequestCount = 0;
  let logicalRequestCount = 0;
  let maxBatchSize = 0;
  let physicalRequestCount = 0;

  const recordRequest = (method: string, params: unknown) => {
    physicalRequestCount += 1;
    incrementRequestCount(physicalMethods, method);
    if (
      method === "batchRequests" &&
      params !== null &&
      typeof params === "object" &&
      "requests" in params &&
      Array.isArray(params.requests)
    ) {
      batchRequestCount += 1;
      batchedLogicalRequestCount += params.requests.length;
      logicalRequestCount += params.requests.length;
      maxBatchSize = Math.max(maxBatchSize, params.requests.length);
      for (const request of params.requests) {
        if (
          request !== null &&
          typeof request === "object" &&
          "method" in request &&
          typeof request.method === "string"
        ) {
          incrementRequestCount(logicalMethods, request.method);
        }
      }
      return;
    }
    logicalRequestCount += 1;
    incrementRequestCount(logicalMethods, method);
  };

  const originalApiRequest = client.apiRequest.bind(client);
  client.apiRequest = (method, params) => {
    recordRequest(method, params);
    return originalApiRequest(method, params);
  };
  const originalApiRequestBinary = client.apiRequestBinary.bind(client);
  client.apiRequestBinary = (method, params) => {
    recordRequest(method, params);
    return originalApiRequestBinary(method, params);
  };

  const reset = () => {
    batchRequestCount = 0;
    batchedLogicalRequestCount = 0;
    logicalMethods.clear();
    logicalRequestCount = 0;
    maxBatchSize = 0;
    physicalMethods.clear();
    physicalRequestCount = 0;
  };

  return {
    reset,
    snapshot: (): NativeRequestProfile => ({
      batchRequestCount,
      batchedLogicalRequestCount,
      logicalMethods: toSortedRecord(logicalMethods),
      logicalRequestCount,
      maxBatchSize,
      physicalMethods: toSortedRecord(physicalMethods),
      physicalRequestCount,
    }),
  };
};

const toTypeScriptPath = (fileName: string) => fileName.replaceAll("\\", "/");

const trimDeclarationFileName = (fileName: string) => {
  const normalizedFileName = path.normalize(fileName);
  const root = path.parse(process.cwd()).root;
  let parent = process.cwd();

  do {
    if (normalizedFileName.startsWith(parent)) {
      return toTypeScriptPath(
        path.relative(path.dirname(parent), normalizedFileName),
      );
    }
    parent = path.dirname(parent);
  } while (parent !== root);

  return toTypeScriptPath(fileName);
};

const getDefaultComponentName = (fileName: string) => {
  const baseName = path.basename(fileName, path.extname(fileName));
  const candidate =
    baseName === "index" ? path.basename(path.dirname(fileName)) : baseName;
  return (
    candidate.replace(/^[^A-Z]*/gi, "").replace(/[^A-Z0-9]*/gi, "") ||
    "DefaultName"
  );
};

const defaultLoaders: NativeBackendLoaders = {
  async loadAst() {
    return (await import(NATIVE_AST_SPECIFIER)) as NativeAstModule;
  },
  async loadSync() {
    return (await import(NATIVE_SYNC_SPECIFIER)) as NativeSyncModule;
  },
};

const assertNativeCapabilities = (sync: NativeSyncModule) => {
  const missing = [
    typeof sync.API === "function" ? undefined : "API",
    typeof sync.Checker === "function" ? undefined : "Checker",
    typeof sync.Program === "function" ? undefined : "Program",
    typeof sync.SymbolFlags === "object" ? undefined : "SymbolFlags",
    typeof sync.TypeFlags === "object" ? undefined : "TypeFlags",
  ].filter((name): name is string => name !== undefined);

  if (missing.length > 0) {
    throw new Error(
      `TypeScript's native API is missing required capabilities: ${missing.join(", ")}. ` +
        'Install a current TypeScript 7.1 prerelease and use docgenMode: "native".',
    );
  }

  const apiPrototype = sync.API.prototype;
  const hasApiMethod = (name: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(apiPrototype, name);
    return (
      typeof descriptor?.get === "function" ||
      typeof descriptor?.value === "function"
    );
  };
  const missingApiMethods = [
    typeof apiPrototype.batch === "function" ? undefined : "API.batch()",
    hasApiMethod("createProgram") ? undefined : "API.createProgram()",
    hasApiMethod("runWithTemporaryFileUpdate")
      ? undefined
      : "API.runWithTemporaryFileUpdate()",
    hasApiMethod("updateSnapshot") ? undefined : "API.updateSnapshot()",
  ].filter((name): name is string => name !== undefined);

  if (missingApiMethods.length > 0) {
    throw new Error(
      `TypeScript's native API is too old; missing ${missingApiMethods.join(", ")}. ` +
        "Install a current TypeScript 7.1 prerelease.",
    );
  }
};

const loadNativeModules = async (loaders: NativeBackendLoaders) => {
  try {
    const [sync, ast] = await Promise.all([
      loaders.loadSync(),
      loaders.loadAst(),
    ]);
    assertNativeCapabilities(sync);
    return { ast, sync };
  } catch (cause) {
    const error = new Error(
      "Native docgen mode requires TypeScript 7.1's experimental JavaScript API " +
        'at "typescript/unstable/sync". Install typescript@next or select a non-native docgen mode.',
    );
    error.cause = cause;
    throw error;
  }
};

const resolveTsconfigPath = (rootDir: string, tsconfigPath: string) =>
  path.isAbsolute(tsconfigPath)
    ? normalizeBoundaryPath(tsconfigPath)
    : normalizeBoundaryPath(path.resolve(rootDir, tsconfigPath));

const discoverReferencedConfigs = (
  api: NativeApi,
  rootConfigPath: string,
): readonly string[] => {
  const discovered: string[] = [];
  const pending = [rootConfigPath];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const configPath = normalizeBoundaryPath(pending.pop() as string);
    if (visited.has(configPath)) continue;
    visited.add(configPath);
    discovered.push(configPath);

    const parsed = api.parseConfigFile(configPath);
    for (const reference of parsed.projectReferences ?? []) {
      const referencedConfig = normalizeBoundaryPath(
        reference.path.toLowerCase().endsWith(".json")
          ? reference.path
          : path.join(reference.path, "tsconfig.json"),
      );
      if (!visited.has(referencedConfig)) pending.push(referencedConfig);
    }
  }

  return discovered;
};

const discoverDocgenFiles = async (
  rootDir: string,
  selection: BackendFileSelection,
) => {
  if (!selection.hasIncludes) return [];
  const { globSync } = await import("glob");
  const files = new Set<string>();

  for (const pattern of selection.include) {
    for (const fileName of globSync(pattern, {
      absolute: true,
      cwd: rootDir,
      nodir: true,
    })) {
      const normalizedFileName = normalizeBoundaryPath(fileName);
      if (selection.matchesDocgenFile(normalizedFileName)) {
        files.add(normalizedFileName);
      }
    }
  }

  return [...files].sort();
};

const tagsToRecord = (
  tags: readonly { readonly name: string; readonly text?: string }[],
): Readonly<Record<string, DocgenJsonValue>> => {
  const result: Record<string, DocgenJsonValue> = {};
  for (const tag of tags) {
    const value = tag.text?.trim() ?? "";
    const previous = result[tag.name];
    result[tag.name] =
      typeof previous === "string" && previous.length > 0
        ? `${previous}\n${value}`
        : value;
  }
  return result;
};

const getNodeName = (node: NativeNode | undefined): string | undefined => {
  if (!node || !("name" in node)) return undefined;
  const name = node.name;
  return name && typeof name === "object" && "getText" in name
    ? (name as NativeNode).getText()
    : undefined;
};

const resolveDeclaration = (
  symbol: NativeSymbol,
  project: NativeProject,
): NativeNode | undefined =>
  symbol.valueDeclaration?.resolve(project) ??
  symbol.declarations[0]?.resolve(project);

const resolveExportSymbol = (
  symbol: NativeSymbol,
  checker: NativeChecker,
  symbolFlags: NativeSyncModule["SymbolFlags"],
) => {
  if ((symbol.flags & symbolFlags.Alias) === 0) return symbol;
  try {
    return checker.getAliasedSymbol(symbol);
  } catch {
    return symbol;
  }
};

const getDeclarationParents = (
  symbol: NativeSymbol,
  project: NativeProject,
  fallbackName: string,
): readonly DocgenParent[] => {
  const parents = new Map<string, DocgenParent>();

  for (const declaration of symbol.declarations) {
    const node = declaration.resolve(project);
    const fileName = trimDeclarationFileName(
      node?.getSourceFile().fileName ?? declaration.path,
    );
    const name = getNodeName(node?.parent) ?? fallbackName;
    parents.set(`${fileName}\0${name}`, { fileName, name });
  }

  return [...parents.values()];
};

const getTypeDeclarationText = (
  type: NativeType,
  symbol: NativeSymbol,
  project: NativeProject,
): string | undefined => {
  const declaration = resolveDeclaration(symbol, project);
  if (declaration && "type" in declaration) {
    const typeNode = declaration.type;
    if (typeNode && typeof typeNode === "object" && "getText" in typeNode) {
      const text = (typeNode as NativeNode).getText();
      if (text.includes("|") || !type.getAliasSymbol()) return text;
    }
  }

  const aliasSymbol = type.getAliasSymbol();
  const aliasDeclaration = aliasSymbol
    ? resolveDeclaration(aliasSymbol, project)
    : undefined;
  if (aliasDeclaration && "type" in aliasDeclaration) {
    const typeNode = aliasDeclaration.type;
    if (typeNode && typeof typeNode === "object" && "getText" in typeNode) {
      return (typeNode as NativeNode).getText();
    }
  }

  return undefined;
};

const formatLiteralType = (
  type: NativeType,
  sync: NativeSyncModule,
): string | undefined => {
  if ((type.flags & sync.TypeFlags.Undefined) !== 0) return "undefined";
  if ((type.flags & sync.TypeFlags.Null) !== 0) return "null";
  if (type.isStringLiteralType()) return JSON.stringify(type.value);
  if (type.isNumberLiteralType()) return String(type.value);
  if (type.isBooleanLiteralType()) return String(type.value);
  return undefined;
};

const splitUnionText = (value: string): string[] =>
  value
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

const getDocgenType = ({
  config,
  formatted,
  isRequired,
  project,
  symbol,
  sync,
  type,
  unionTypes,
}: {
  config: Options;
  formatted: string;
  isRequired: boolean;
  project: NativeProject;
  symbol: NativeSymbol;
  sync: NativeSyncModule;
  type: NativeType;
  unionTypes: readonly NativeType[];
}): DocgenPropType => {
  if (config.shouldExtractValuesFromUnion && formatted === "boolean") {
    return {
      name: "enum",
      raw: "boolean",
      value: [{ value: "false" }, { value: "true" }],
    };
  }
  const literalValues = unionTypes.map((member) =>
    formatLiteralType(member, sync),
  );
  const shouldExtractUnion =
    (config.shouldExtractValuesFromUnion ||
      config.shouldExtractLiteralValuesFromEnum) &&
    unionTypes.length > 0 &&
    literalValues.every((value) => value !== undefined);

  if (!shouldExtractUnion) return { name: formatted };

  let raw = getTypeDeclarationText(type, symbol, project) ?? formatted;
  const hasUndefined = literalValues.includes("undefined");
  if (hasUndefined && !splitUnionText(raw).includes("undefined")) {
    raw = `${raw} | undefined`;
  }

  const resolvedValues = literalValues.filter(
    (value, index, all): value is string =>
      value !== undefined && all.indexOf(value) === index,
  );
  const sourceValues = splitUnionText(raw);
  const preservesResolvedValues =
    sourceValues.length === resolvedValues.length &&
    sourceValues.every((value) => resolvedValues.includes(value));
  const values = preservesResolvedValues
    ? [
        ...sourceValues.filter((value) => value === "undefined"),
        ...sourceValues.filter((value) => value !== "undefined"),
      ]
    : resolvedValues;
  const filteredValues =
    !isRequired && config.shouldRemoveUndefinedFromOptional
      ? values.filter((value) => value !== "undefined")
      : values;

  return {
    name: "enum",
    raw:
      !isRequired && config.shouldRemoveUndefinedFromOptional
        ? splitUnionText(raw)
            .filter((value) => value !== "undefined")
            .join(" | ")
        : raw,
    value: filteredValues.map((value) => ({ value })),
  };
};

const parseDefaultValue = (
  value: string | undefined,
  saveAsString: boolean,
): DocgenJsonValue | null => {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (saveAsString) return trimmed;
  if (/^(?:true|false)$/.test(trimmed)) return trimmed === "true";
  if (trimmed === "null") return null;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const normalizeDocumentation = (value: string) =>
  value.replace(/\r\n?/g, "\n").replace(/^[\t ]+$/gm, "");

const findFunctionNode = (
  node: NativeNode | undefined,
  ast: NativeAstModule,
): NativeNode | undefined => {
  if (!node) return undefined;
  if (
    ast.isArrowFunction(node) ||
    ast.isFunctionDeclaration(node) ||
    ast.isFunctionExpression(node)
  ) {
    return node;
  }
  if (ast.isVariableDeclaration(node)) {
    return findFunctionNode(node.initializer, ast);
  }
  if (ast.isCallExpression(node)) {
    for (const argument of node.arguments) {
      const candidate = findFunctionNode(argument, ast);
      if (candidate) return candidate;
    }
  }
  return undefined;
};

const getBindingDefaults = (
  componentDeclaration: NativeNode | undefined,
  ast: NativeAstModule,
) => {
  const defaults = new Map<string, string>();
  const functionNode = findFunctionNode(componentDeclaration, ast);
  if (!functionNode || !("parameters" in functionNode)) return defaults;
  const parameter = (
    functionNode as NativeNode & {
      readonly parameters: readonly {
        readonly name: NativeNode;
      }[];
    }
  ).parameters[0];
  if (!parameter || !ast.isObjectBindingPattern(parameter.name))
    return defaults;

  for (const element of parameter.name.elements) {
    const binding = element as BindingElement;
    if (!binding.initializer) continue;
    const name = binding.propertyName?.getText() ?? binding.name?.getText();
    if (name)
      defaults.set(
        name.replace(/^['"]|['"]$/g, ""),
        binding.initializer.getText(),
      );
  }
  return defaults;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const getAssignedString = (
  source: string,
  target: string,
  property: string,
) => {
  const match = new RegExp(
    `(?:^|\\n)\\s*${escapeRegExp(target)}\\.${property}\\s*=\\s*(["'])(.*?)\\1`,
    "m",
  ).exec(source);
  return match?.[2];
};

const getObjectDefaults = (source: string, target: string) => {
  const defaults = new Map<string, string>();
  const match = new RegExp(
    `${escapeRegExp(target)}\\.defaultProps\\s*=\\s*\\{([\\s\\S]*?)\\}`,
    "m",
  ).exec(source);
  if (!match?.[1]) return defaults;

  for (const property of match[1].split(",")) {
    const separator = property.indexOf(":");
    if (separator === -1) continue;
    const name = property
      .slice(0, separator)
      .trim()
      .replace(/^['"]|['"]$/g, "");
    const value = property.slice(separator + 1).trim();
    if (name && value) defaults.set(name, value);
  }
  return defaults;
};

const shouldIncludeProp = (
  config: Options,
  prop: DocgenProp,
  componentName: string,
) => {
  const filter = config.propFilter ?? defaultPropFilter;
  if (typeof filter === "function") {
    return filter(prop as never, { name: componentName });
  }
  const skippedNames = Array.isArray(filter.skipPropsWithName)
    ? filter.skipPropsWithName
    : filter.skipPropsWithName
      ? [filter.skipPropsWithName]
      : [];
  if (skippedNames.includes(prop.name)) return false;
  return !(filter.skipPropsWithoutDoc && !prop.description);
};

const addSymbolDependencies = (
  symbol: NativeSymbol | undefined,
  dependencies: Set<string>,
  trackedFiles: ReadonlySet<string>,
) => {
  if (!symbol) return;
  for (const declaration of symbol.declarations) {
    const declarationPath = normalizeBoundaryPath(declaration.path);
    if (trackedFiles.has(declarationPath)) dependencies.add(declarationPath);
  }
};

const addTypeDependencies = function* (
  initialTypes: readonly NativeType[],
  checker: NativeChecker,
  compoundTypesById: Map<number, readonly NativeType[]>,
  dependencies: Set<string>,
  seenTypes: Set<number>,
  sync: NativeSyncModule,
  trackedFiles: ReadonlySet<string>,
) {
  let pendingTypes = [...initialTypes];

  while (pendingTypes.length > 0) {
    const types: NativeType[] = [];
    for (const type of pendingTypes) {
      if (seenTypes.has(type.id)) continue;
      seenTypes.add(type.id);
      types.push(type);
    }
    if (types.length === 0) break;

    const compoundTypes = types.filter(
      (type) => type.isUnionType() || type.isIntersectionType(),
    );
    const typeReferences = types.filter((type) => type.isTypeReference());
    const classOrInterfaceTypes = types.filter((type) =>
      type.isClassOrInterface(),
    );
    const batchResults = yield* sync.all(
      ...types.map((type) => type.getSymbol.gen()),
      ...types.map((type) => type.getAliasSymbol.gen()),
      ...types.map((type) => type.getAliasTypeArguments.gen()),
      ...compoundTypes.map((type) => type.getTypes.gen()),
      ...typeReferences.map((type) => checker.getTypeArguments.gen(type)),
      ...classOrInterfaceTypes.map((type) => type.getBaseTypes.gen()),
    );
    let resultOffset = 0;
    const takeResults = (count: number) => {
      const results = batchResults.slice(resultOffset, resultOffset + count);
      resultOffset += count;
      return results;
    };
    const symbols = takeResults(types.length) as readonly (
      | NativeSymbol
      | undefined
    )[];
    const aliasSymbols = takeResults(types.length) as readonly (
      | NativeSymbol
      | undefined
    )[];
    const aliasTypeArguments = takeResults(
      types.length,
    ) as readonly (readonly NativeType[])[];
    const compoundTypeArguments = takeResults(
      compoundTypes.length,
    ) as readonly (readonly NativeType[] | undefined)[];
    const referenceTypeArguments = takeResults(
      typeReferences.length,
    ) as readonly (readonly NativeType[])[];
    const baseTypes = takeResults(classOrInterfaceTypes.length) as readonly (
      | readonly NativeType[]
      | undefined
    )[];

    for (const [index, type] of compoundTypes.entries()) {
      compoundTypesById.set(type.id, compoundTypeArguments[index] ?? []);
    }

    for (const symbol of symbols) {
      addSymbolDependencies(symbol, dependencies, trackedFiles);
    }
    for (const symbol of aliasSymbols) {
      addSymbolDependencies(symbol, dependencies, trackedFiles);
    }

    pendingTypes = [
      ...aliasTypeArguments.flat(),
      ...compoundTypeArguments.flatMap((arguments_) => arguments_ ?? []),
      ...referenceTypeArguments.flat(),
      ...baseTypes.flatMap((arguments_) => arguments_ ?? []),
    ];
  }
};

const extractNativeComponents = function* ({
  ast,
  config,
  fileName,
  project,
  sourceFile,
  sync,
  trackedFiles,
}: {
  ast: NativeAstModule;
  config: Options;
  fileName: string;
  project: NativeProject;
  sourceFile: NativeSourceFile;
  sync: NativeSyncModule;
  trackedFiles: ReadonlySet<string>;
}) {
  const checker = project.checker;
  const compoundTypesById = new Map<number, readonly NativeType[]>();
  const dependencies = new Set<string>([normalizeBoundaryPath(fileName)]);
  const seenDependencyTypes = new Set<number>();
  const moduleSymbol = yield* checker.getSymbolOfSourceFile.gen(fileName);
  if (!moduleSymbol) return { components: [], dependencies };
  const exports = yield* checker.getExportsOfModule.gen(moduleSymbol);
  const components: {
    component: DocgenComponent;
    declarationPosition: number;
    functionDeclaration: boolean;
  }[] = [];

  for (const exportSymbol of exports) {
    const componentSymbol = resolveExportSymbol(
      exportSymbol,
      checker,
      sync.SymbolFlags,
    );
    const declaration = resolveDeclaration(componentSymbol, project);
    if (!declaration) continue;
    const targetExpression =
      exportSymbol.name === "default"
        ? componentSymbol.name
        : exportSymbol.name;
    if (
      !IDENTIFIER_PATTERN.test(targetExpression) ||
      !isSupportedRuntimeTargetExpression(targetExpression) ||
      !/^[A-Z]/.test(targetExpression)
    ) {
      continue;
    }

    const [componentType, componentTagInfo, componentDocumentation] =
      yield* sync.all(
        checker.getTypeOfSymbolAtLocation.gen(componentSymbol, declaration),
        componentSymbol.getJsDocTags.gen(checker),
        componentSymbol.getDocumentationComment.gen(checker),
      );
    const signature = (yield* componentType.getCallSignatures.gen())[0];
    if (!signature) continue;
    addSymbolDependencies(componentSymbol, dependencies, trackedFiles);

    const componentTags = tagsToRecord(componentTagInfo);
    const resolvedDisplayName = config.componentNameResolver?.(
      {
        getEscapedName: () => componentSymbol.escapedName,
        getName: () => componentSymbol.name,
        name: componentSymbol.name,
      } as never,
      sourceFile as never,
    );
    const visibleName = componentTags.visibleName;
    const displayName =
      resolvedDisplayName ||
      (typeof visibleName === "string" && visibleName) ||
      getAssignedString(sourceFile.text, targetExpression, "displayName") ||
      (exportSymbol.name === "default"
        ? getDefaultComponentName(sourceFile.fileName)
        : componentSymbol.name);
    const bindingDefaults = getBindingDefaults(declaration, ast);
    const objectDefaults = getObjectDefaults(sourceFile.text, targetExpression);
    const props: Record<string, DocgenProp> = {};
    const parameters = yield* signature.getParameters.gen();

    if (parameters[0]) {
      const propsType = yield* checker.getParameterType.gen(signature, 0);
      const [propsAliasSymbol, propsSymbol] = yield* sync.all(
        propsType.getAliasSymbol.gen(),
        propsType.getSymbol.gen(),
      );
      const propsParentName =
        propsAliasSymbol?.name ?? propsSymbol?.name ?? parameters[0].name;
      const propEntries = (yield* checker.getPropertiesOfType.gen(propsType))
        .map((symbol) => ({
          declaration: resolveDeclaration(symbol, project),
          symbol,
        }))
        .filter(
          (entry): entry is { declaration: NativeNode; symbol: NativeSymbol } =>
            entry.declaration !== undefined,
        );
      const propEntryCount = propEntries.length;
      const propMetadata =
        propEntryCount > 0
          ? yield* sync.all(
              ...propEntries.map(({ declaration, symbol }) =>
                checker.getTypeOfSymbolAtLocation.gen(symbol, declaration),
              ),
              ...propEntries.map(({ symbol }) =>
                symbol.getJsDocTags.gen(checker),
              ),
              ...propEntries.map(({ symbol }) =>
                symbol.getDocumentationComment.gen(checker),
              ),
            )
          : [];
      const propTypes = propMetadata.slice(
        0,
        propEntryCount,
      ) as readonly NativeType[];
      const propTags = propMetadata.slice(
        propEntryCount,
        propEntryCount * 2,
      ) as readonly (readonly {
        readonly name: string;
        readonly text?: string;
      }[])[];
      const propDocumentation = propMetadata.slice(
        propEntryCount * 2,
      ) as readonly string[];
      const formattedPropTypes =
        propEntries.length > 0
          ? yield* sync.all(
              ...propEntries.map(({ declaration }, index) =>
                checker.typeToString.gen(propTypes[index], declaration),
              ),
            )
          : [];
      yield* addTypeDependencies(
        [propsType, ...propTypes],
        checker,
        compoundTypesById,
        dependencies,
        seenDependencyTypes,
        sync,
        trackedFiles,
      );

      for (const [index, { symbol: propSymbol }] of propEntries.entries()) {
        const propType = propTypes[index];
        addSymbolDependencies(propSymbol, dependencies, trackedFiles);
        const parents = getDeclarationParents(
          propSymbol,
          project,
          propsParentName,
        );
        const tags = tagsToRecord(propTags[index]);
        const isRequired = (propSymbol.flags & sync.SymbolFlags.Optional) === 0;
        const runtimeDefaultSource =
          objectDefaults.get(propSymbol.name) ??
          bindingDefaults.get(propSymbol.name);
        const defaultSource =
          runtimeDefaultSource ??
          (typeof tags.default === "string" ? tags.default : undefined);
        const defaultValue = parseDefaultValue(
          defaultSource,
          config.savePropValueAsString ?? false,
        );
        const prop: DocgenProp = {
          ...(parents.length > 0 ? { declarations: parents } : {}),
          defaultValue:
            defaultSource === undefined ? null : { value: defaultValue },
          description: normalizeDocumentation(propDocumentation[index]),
          name: propSymbol.name,
          ...(parents[0] ? { parent: parents[0] } : {}),
          required: isRequired && runtimeDefaultSource === undefined,
          ...(config.shouldIncludePropTagMap === false ? {} : { tags }),
          type: getDocgenType({
            config,
            formatted: formattedPropTypes[index],
            isRequired,
            project,
            symbol: propSymbol,
            sync,
            type: propType,
            unionTypes: propType.isUnionType()
              ? (compoundTypesById.get(propType.id) ?? [])
              : [],
          }),
        };

        if (
          !(
            config.skipChildrenPropWithoutDoc &&
            prop.name === "children" &&
            !prop.description
          ) &&
          shouldIncludeProp(config, prop, componentSymbol.name)
        ) {
          props[prop.name] = prop;
        }
      }
    }

    components.push({
      component: {
        description: normalizeDocumentation(componentDocumentation),
        displayName,
        filePath: toTypeScriptPath(sourceFile.fileName),
        methods: [],
        props,
        tags: componentTags,
        targetExpression,
      },
      declarationPosition: declaration.pos,
      functionDeclaration: ast.isFunctionDeclaration(declaration),
    });
  }

  components.sort(
    (left, right) =>
      Number(right.functionDeclaration) - Number(left.functionDeclaration) ||
      left.declarationPosition - right.declarationPosition,
  );

  return {
    components: components.map(({ component }) => component),
    dependencies,
  };
};

const describeNativeBackend = (rootDir: string): BackendDescriptor =>
  Object.freeze({
    cacheFingerprint: createDependencyVersionFingerprint({
      packageNames: ["typescript"],
      rootDir,
      schema: "native-backend-1",
    }),
    id: "typescript/native",
  });

const createNativeBackend = async (
  config: Options,
  rootDir: string,
  selection: BackendFileSelection,
  loaders: NativeBackendLoaders,
): Promise<DocgenBackend> => {
  const { ast, sync } = await loadNativeModules(loaders);
  let api: NativeApi | undefined;
  let requestProfiler:
    | ReturnType<typeof createNativeRequestProfiler>
    | undefined;
  let snapshot: NativeSnapshot | undefined;
  let standaloneProgram: NativeProgram | undefined;
  let projects: readonly NativeProject[] = [];
  let rootFiles: readonly string[] = [];
  let openProjectPaths: readonly string[] = [];
  let configPath: string | undefined;
  let generation = 0;
  let latestRevision = 0;
  let disposed = false;
  const configFiles = new Set<string>();
  const docgenFiles = new Set<string>();
  const trackedFiles = new Set<string>();
  const sourceFileClassifications = new Map<string, boolean>();
  const projectByFile = new Map<string, NativeProject>();
  let cachedProjectState: BackendProjectState = {
    configFiles: [],
    docgenFiles: [],
    generation,
    trackedFiles: [],
  };

  const refreshCachedProjectState = () => {
    cachedProjectState = {
      configFiles: [...configFiles].sort(),
      docgenFiles: [...docgenFiles].sort(),
      generation,
      trackedFiles: [...trackedFiles].sort(),
    };
  };

  const getProjectState = (): BackendProjectState => cachedProjectState;

  const disposeProgramState = () => {
    standaloneProgram?.dispose();
    standaloneProgram = undefined;
    if (snapshot && api && openProjectPaths.length > 0) {
      const previousSnapshot = snapshot;
      const closingSnapshot = api.updateSnapshot({
        closeProjects: openProjectPaths,
      });
      previousSnapshot.dispose();
      closingSnapshot.dispose();
    } else {
      snapshot?.dispose();
    }
    snapshot = undefined;
    openProjectPaths = [];
    projects = [];
    projectByFile.clear();
    sourceFileClassifications.clear();
  };

  const synchronizeProjectStateCore = () => {
    if (!api) throw new Error("No TypeScript native API is available");
    configFiles.clear();
    docgenFiles.clear();
    trackedFiles.clear();
    projectByFile.clear();
    if (configPath) configFiles.add(configPath);
    const seenSourceFiles = new Set<string>();

    for (const project of projects) {
      const [projectConfigs, projectFiles] = api.batch(
        project.program.getConfigFileNames.gen(),
        project.program.getSourceFileNames.gen(),
      );
      for (const projectConfig of projectConfigs) {
        configFiles.add(normalizeBoundaryPath(projectConfig));
      }
      const unclassifiedFiles: {
        normalizedFile: string;
        projectFile: string;
      }[] = [];
      for (const projectFile of projectFiles) {
        const normalizedFile = normalizeBoundaryPath(projectFile);
        seenSourceFiles.add(normalizedFile);
        if (!projectByFile.has(normalizedFile)) {
          projectByFile.set(normalizedFile, project);
        }
        if (NODE_MODULES_SEGMENT_PATTERN.test(normalizedFile)) {
          sourceFileClassifications.set(normalizedFile, false);
          continue;
        }
        const existingClassification =
          sourceFileClassifications.get(normalizedFile);
        if (existingClassification !== undefined) {
          if (existingClassification) trackedFiles.add(normalizedFile);
          continue;
        }
        unclassifiedFiles.push({ normalizedFile, projectFile });
      }

      const metadata =
        unclassifiedFiles.length > 0
          ? api.batch(
              ...unclassifiedFiles.map(({ projectFile }) =>
                project.program.getSourceFileMetadata.gen(projectFile),
              ),
            )
          : [];
      for (const [index, { normalizedFile }] of unclassifiedFiles.entries()) {
        const isTracked = !(
          metadata[index]?.isDefaultLibrary ||
          metadata[index]?.isFromExternalLibrary
        );
        sourceFileClassifications.set(normalizedFile, isTracked);
        if (isTracked) trackedFiles.add(normalizedFile);
      }
    }

    for (const fileName of sourceFileClassifications.keys()) {
      if (!seenSourceFiles.has(fileName)) {
        sourceFileClassifications.delete(fileName);
      }
    }

    for (const fileName of trackedFiles) {
      if (selection.matchesDocgenFile(fileName)) docgenFiles.add(fileName);
    }
    refreshCachedProjectState();
  };

  const synchronizeProjectState = () => {
    const shouldMeasure = config.__benchmark?.onPhase !== undefined;
    if (!shouldMeasure) {
      synchronizeProjectStateCore();
      return;
    }
    const startedAt = performance.now();
    try {
      synchronizeProjectStateCore();
      try {
        config.__benchmark?.onPhase?.({
          durationMs: performance.now() - startedAt,
          fileCount: trackedFiles.size,
          phase: "native-project-sync",
          revision: latestRevision,
          status: "completed",
        });
      } catch {
        // Benchmark instrumentation is observational.
      }
    } catch (error) {
      try {
        config.__benchmark?.onPhase?.({
          durationMs: performance.now() - startedAt,
          fileCount: trackedFiles.size,
          phase: "native-project-sync",
          revision: latestRevision,
          status: "failed",
        });
      } catch {
        // Benchmark instrumentation is observational.
      }
      throw error;
    }
  };

  const initializeProgramState = async () => {
    if (disposed) throw new Error("Native docgen backend has been disposed");
    if (projects.length > 0) return;
    api ??= new sync.API({
      collectTiming: config.__benchmark?.collectNativeTiming ?? false,
      cwd: rootDir,
    });
    if (config.__benchmark?.collectNativeRequestProfile && !requestProfiler) {
      requestProfiler = createNativeRequestProfiler(api);
      config.__benchmark.getNativeRequestProfile = () =>
        requestProfiler?.snapshot();
      config.__benchmark.resetNativeRequestProfile = () =>
        requestProfiler?.reset();
    }
    if (config.__benchmark?.collectNativeTiming) {
      config.__benchmark.getNativeTimingInfo = () => api?.getTimingInfo();
      config.__benchmark.resetNativeTimingInfo = () => api?.resetTimingInfo();
    }
    rootFiles = await discoverDocgenFiles(rootDir, selection);
    const requestedConfig = config.tsconfigPath ?? "tsconfig.json";
    const candidateConfig = resolveTsconfigPath(rootDir, requestedConfig);
    configPath =
      !config.compilerOptions &&
      (config.tsconfigPath !== undefined || existsSync(candidateConfig))
        ? candidateConfig
        : undefined;

    if (configPath) {
      openProjectPaths = discoverReferencedConfigs(api, configPath);
      snapshot = api.updateSnapshot({
        openProjects: openProjectPaths,
      });
      projects = snapshot.getProjects();
    } else {
      standaloneProgram = api.createProgram(rootFiles, {
        compilerOptions: {
          jsx: sync.JsxEmit.React,
          module: sync.ModuleKind.CommonJS,
          target: ast.ScriptTarget.Latest,
          ...(config.compilerOptions as unknown as Record<string, unknown>),
        },
      });
      projects = [standaloneProgram.getProject()];
    }
    generation += 1;
    synchronizeProjectState();
  };

  const findProject = (
    fileName: string,
    candidates: readonly NativeProject[] = projects,
  ) =>
    (candidates === projects ? projectByFile.get(fileName) : undefined) ??
    candidates.find((project) => project.program.getSourceFile(fileName)) ??
    candidates[0];

  const analyzeWithProject = function* (
    project: NativeProject,
    fileName: string,
    knownSourceFile?: NativeSourceFile,
  ) {
    const sourceFile =
      knownSourceFile ?? (yield* project.program.getSourceFile.gen(fileName));
    if (!sourceFile) {
      throw new Error(
        `Source file "${fileName}" was not found in the TypeScript native project`,
      );
    }
    return yield* extractNativeComponents({
      ast,
      config,
      fileName,
      project,
      sourceFile,
      sync,
      trackedFiles,
    });
  };

  const createAnalysisGenerator = function* ({
    fileName,
    revision,
    source,
  }: AnalyzeInput) {
    const normalizedFile = normalizeBoundaryPath(fileName);
    try {
      const project = findProject(normalizedFile);
      if (!project)
        throw new Error("No TypeScript native project is available");
      let result: NativeExtractionResult | undefined;
      const sourceFile =
        yield* project.program.getSourceFile.gen(normalizedFile);

      if (snapshot && api && sourceFile?.text !== source) {
        yield* api.runWithTemporaryFileUpdate.gen(
          snapshot,
          normalizedFile,
          source,
          function* analyzeTemporarySnapshot(
            temporarySnapshot: NativeSnapshot,
          ) {
            const temporaryProjects = temporarySnapshot.getProjects();
            const temporaryProject =
              temporaryProjects.find(({ id }) => id === project.id) ??
              temporaryProjects[0];
            if (!temporaryProject) {
              throw new Error(
                "No temporary TypeScript native project is available",
              );
            }
            result = yield* analyzeWithProject(
              temporaryProject,
              normalizedFile,
            );
          } as never,
        );
      } else {
        result = yield* analyzeWithProject(project, normalizedFile, sourceFile);
      }

      if (!result)
        throw new Error("TypeScript native analysis did not complete");
      const dependencies = normalizeBoundaryPaths(result.dependencies).filter(
        (dependency) => trackedFiles.has(dependency),
      );
      return {
        components: result.components,
        dependencies,
        project: getProjectState(),
        revision,
        status: "ok",
        unresolvedDependencies: [],
      };
    } catch (error) {
      return {
        dependencies: trackedFiles.has(normalizedFile) ? [normalizedFile] : [],
        error: toBackendErrorRecord(error),
        project: getProjectState(),
        revision,
        status: "error",
        unresolvedDependencies: [],
      };
    }
  };

  const analyzeMany = async (
    inputs: readonly AnalyzeInput[],
  ): Promise<readonly AnalyzeResult[]> => {
    if (inputs.length === 0) return [];
    latestRevision = Math.max(
      latestRevision,
      ...inputs.map(({ revision }) => revision),
    );
    try {
      await initializeProgramState();
      if (!api) throw new Error("No TypeScript native API is available");
      const results: AnalyzeResult[] = [];
      for (
        let offset = 0;
        offset < inputs.length;
        offset += MAX_NATIVE_ANALYSIS_BATCH_SIZE
      ) {
        results.push(
          ...(api.batch(
            ...inputs
              .slice(offset, offset + MAX_NATIVE_ANALYSIS_BATCH_SIZE)
              .map((input) => createAnalysisGenerator(input)),
          ) as readonly AnalyzeResult[]),
        );
      }
      return results;
    } catch (error) {
      const backendError = toBackendErrorRecord(error);
      return inputs.map(({ fileName, revision }) => {
        const normalizedFile = normalizeBoundaryPath(fileName);
        return {
          dependencies: trackedFiles.has(normalizedFile)
            ? [normalizedFile]
            : [],
          error: backendError,
          project: getProjectState(),
          revision,
          status: "error" as const,
          unresolvedDependencies: [],
        };
      });
    }
  };

  const analyze = async (input: AnalyzeInput): Promise<AnalyzeResult> =>
    (await analyzeMany([input]))[0] as AnalyzeResult;

  const reset = async ({
    revision,
  }: Parameters<DocgenBackend["reset"]>[0]): Promise<ResetCompletion> => {
    if (revision < latestRevision) {
      return { revision, status: "superseded", supersededBy: latestRevision };
    }
    latestRevision = revision;
    disposeProgramState();
    configFiles.clear();
    docgenFiles.clear();
    trackedFiles.clear();
    refreshCachedProjectState();
    return disposed
      ? { revision, status: "disposed" }
      : { revision, status: "reset" };
  };

  const update = async ({
    change,
  }: Parameters<DocgenBackend["update"]>[0]): Promise<FileUpdateResult> => {
    if (change.revision < latestRevision || disposed) {
      return { revision: change.revision, status: "ignored" };
    }
    latestRevision = change.revision;
    const changedFile = normalizeBoundaryPath(change.fileName);
    if (configFiles.has(changedFile)) {
      await reset({ revision: change.revision });
      return { revision: change.revision, status: "project-reset" };
    }
    if (!TYPESCRIPT_FILE_PATTERN.test(changedFile)) {
      return { revision: change.revision, status: "ignored" };
    }
    await initializeProgramState();
    if (!api) return { revision: change.revision, status: "ignored" };
    const fileChanges = {
      [change.kind === "change" ? "changed" : `${change.kind}d`]: [changedFile],
    } as {
      changed?: string[];
      created?: string[];
      deleted?: string[];
    };

    if (snapshot) {
      const previousSnapshot = snapshot;
      snapshot = api.updateSnapshot({ fileChanges });
      projects = snapshot.getProjects();
      previousSnapshot.dispose();
    } else if (standaloneProgram) {
      const nextRootFiles = await discoverDocgenFiles(rootDir, selection);
      const previousProgram = standaloneProgram;
      standaloneProgram = api.createProgram(
        nextRootFiles,
        {
          compilerOptions: previousProgram.getCompilerOptions(),
        },
        previousProgram,
        fileChanges,
      );
      rootFiles = nextRootFiles;
      projects = [standaloneProgram.getProject()];
      previousProgram.dispose();
    }
    synchronizeProjectState();

    return trackedFiles.has(changedFile) || change.kind === "delete"
      ? {
          project: getProjectState(),
          revision: change.revision,
          status: "ready",
        }
      : { revision: change.revision, status: "ignored" };
  };

  return {
    analyze,
    analyzeMany,
    async dispose() {
      if (disposed) return;
      disposed = true;
      disposeProgramState();
      api?.close();
      api = undefined;
      requestProfiler = undefined;
      if (config.__benchmark) {
        config.__benchmark.getNativeRequestProfile = undefined;
        config.__benchmark.getNativeTimingInfo = undefined;
        config.__benchmark.resetNativeRequestProfile = undefined;
        config.__benchmark.resetNativeTimingInfo = undefined;
      }
    },
    async initialize() {
      await initializeProgramState();
      return getProjectState();
    },
    recordCacheHit() {},
    reset,
    update,
  };
};

export function createNativeBackendFactory(
  config: Options = {},
  loaders: NativeBackendLoaders = defaultLoaders,
): DocgenBackendFactory {
  if (config.docgenMode !== "native") {
    throw new Error('Native backend requires docgenMode: "native"');
  }

  return {
    async create({ rootDir, selection }) {
      return createNativeBackend(
        config,
        normalizeBoundaryPath(rootDir),
        selection,
        loaders,
      );
    },
    describe({ rootDir }) {
      return describeNativeBackend(rootDir);
    },
  };
}
