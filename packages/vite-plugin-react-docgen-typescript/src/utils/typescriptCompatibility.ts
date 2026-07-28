type TypeScriptModule = typeof import("typescript");

const PLUGIN_NAME = "@joshwooding/vite-plugin-react-docgen-typescript";
const SUPPORTED_RANGE = ">=4.3 <7";
const DOCUMENTATION_POINTER =
  "https://github.com/joshwooding/vite-plugin-react-docgen-typescript#typescript-compatibility";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const hasFunction = (value: UnknownRecord, key: string) =>
  typeof value[key] === "function";

const hasNumber = (value: UnknownRecord, key: string) =>
  typeof value[key] === "number";

const REQUIRED_FUNCTIONS = [
  "createIncrementalCompilerHost",
  "createModuleResolutionCache",
  "createSemanticDiagnosticsBuilderProgram",
  "createTypeReferenceDirectiveResolutionCache",
  "createWatchCompilerHost",
  "createWatchProgram",
  "flattenDiagnosticMessageText",
  "isClassDeclaration",
  "isExportAssignment",
  "isExportDeclaration",
  "isExportSpecifier",
  "isFunctionDeclaration",
  "isIdentifier",
  "isNamedExports",
  "isPropertyAccessExpression",
  "isVariableDeclaration",
  "isVariableStatement",
  "parseJsonConfigFileContent",
  "preProcessFile",
  "readConfigFile",
  "resolveModuleName",
  "resolveProjectReferencePath",
  "resolveTypeReferenceDirective",
] as const;

const REQUIRED_ENUM_MEMBERS = {
  JsxEmit: ["React"],
  ModuleKind: ["CommonJS"],
  ScriptTarget: ["Latest"],
  SymbolFlags: ["Alias"],
  SyntaxKind: ["DefaultKeyword", "ExportKeyword"],
} as const;

const getMissingCapabilities = (candidate: unknown): string[] => {
  if (!isRecord(candidate)) {
    return ["compiler module"];
  }

  const missing = REQUIRED_FUNCTIONS.filter(
    (functionName) => !hasFunction(candidate, functionName),
  ).map((functionName) => `${functionName}()`);
  const system = candidate.sys;

  if (!isRecord(system) || !hasFunction(system, "fileExists")) {
    missing.push("sys.fileExists()");
  }

  if (!isRecord(system) || !hasFunction(system, "readFile")) {
    missing.push("sys.readFile()");
  }

  for (const [enumName, members] of Object.entries(REQUIRED_ENUM_MEMBERS)) {
    const enumValue = candidate[enumName];

    for (const member of members) {
      if (!isRecord(enumValue) || !hasNumber(enumValue, member)) {
        missing.push(`${enumName}.${member}`);
      }
    }
  }

  return missing;
};

const getVersion = (candidate: unknown): string =>
  isRecord(candidate) && typeof candidate.version === "string"
    ? candidate.version
    : "unknown";

export const normalizeTypescriptModule = (moduleValue: unknown): unknown =>
  isRecord(moduleValue) && isRecord(moduleValue.default)
    ? moduleValue.default
    : moduleValue;

export const validateTypescriptModule = (
  moduleValue: unknown,
): TypeScriptModule => {
  const candidate = normalizeTypescriptModule(moduleValue);
  const missingCapabilities = getMissingCapabilities(candidate);

  if (missingCapabilities.length > 0) {
    throw new Error(
      `${PLUGIN_NAME} requires the TypeScript JavaScript compiler API (${SUPPORTED_RANGE}). ` +
        `Loaded TypeScript ${getVersion(candidate)}, which is missing: ${missingCapabilities.join(", ")}. ` +
        `See ${DOCUMENTATION_POINTER}.`,
    );
  }

  return candidate as TypeScriptModule;
};

export const loadTypescript = async (
  importer: () => Promise<unknown> = () => import("typescript"),
): Promise<TypeScriptModule> => {
  let moduleValue: unknown;

  try {
    moduleValue = await importer();
  } catch (cause) {
    const loadError = new Error(
      `${PLUGIN_NAME} could not load the optional TypeScript peer dependency. ` +
        `Install a supported compiler (${SUPPORTED_RANGE}) and see ${DOCUMENTATION_POINTER}.`,
    );

    loadError.cause = cause;
    throw loadError;
  }

  return validateTypescriptModule(moduleValue);
};
