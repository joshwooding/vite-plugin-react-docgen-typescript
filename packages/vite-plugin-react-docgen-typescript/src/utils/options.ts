import type { ParserOptions } from "react-docgen-typescript";
import type { CompilerOptions } from "typescript";
import type { AnalyzeResult } from "../docgen/backend";
import type { GeneratorOptions } from "./generate";

interface LoaderOptions {
  /**
   * Automatically set the component's display name. If you want to set display
   * names yourself or are using another plugin to do this, you should disable
   * this option.
   *
   * ```
   * class MyComponent extends React.Component {
   * ...
   * }
   *
   * MyComponent.displayName = "MyComponent";
   * ```
   *
   * @default true
   */
  setDisplayName?: boolean;

  /**
   * Specify the name of the property for docgen info prop type.
   *
   * @default "type"
   */
  typePropName?: string;
}

interface TypescriptOptions {
  /**
   * Specify the location of the tsconfig.json to use. Can not be used with
   * compilerOptions.
   **/
  tsconfigPath?: string;
  /** Specify TypeScript compiler options. Can not be used with tsconfigPath. */
  compilerOptions?: CompilerOptions;
}

export interface FileSystemCacheOptions {
  /**
   * Enable the persistent file-system cache.
   *
   * @default true
   */
  enabled?: boolean;

  /**
   * Directory used to store persisted cache entries.
   *
   * @default "node_modules/.cache/vite-plugin-react-docgen-typescript"
   */
  directory?: string;
}

export type DocgenMode = "legacy" | "native" | "project-service";

export type DocGenOptions = ParserOptions & {
  /**
   * An array of string globs to exclude from docgen. Patterns resolve from the
   * configured Vite root. An explicit `exclude: []` disables the built-in
   * story-file exclusion. Runtime RegExp values are rejected.
   */
  // Default: ["**/*.stories.tsx"]
  exclude?: string[];
  /**
   * An array of string globs to include in docgen. Patterns resolve from the
   * configured Vite root; explicit parent-directory globs can select members
   * of referenced TypeScript projects. The configured root and project
   * references remain the membership boundary. An explicit `include: []`
   * disables docgen. Runtime RegExp values are rejected.
   */
  // Default: ["**/*.tsx"]
  include?: string[];
  /** Persistent transform cache stored on disk. */
  fileSystemCache?: boolean | FileSystemCacheOptions;
  /**
   * Select the TypeScript project runtime used by docgen.
   *
   * @default "legacy"
   */
  docgenMode?: DocgenMode;
  /**
   * Experimental watch mode.
   *
   * @deprecated Use `docgenMode: "project-service"` instead.
   */
  EXPERIMENTAL_useWatchProgram?: boolean;
  /**
   * Experimental ProjectService mode.
   *
   * @deprecated Use `docgenMode: "project-service"` instead.
   */
  EXPERIMENTAL_useProjectService?: boolean;
};

/** @internal Controls used only by the repository benchmark harness. */
export type InternalBenchmarkPhase =
  | "backend-analyze"
  | "backend-initialize"
  | "backend-update"
  | "code-generation"
  | "dependency-discovery"
  | "native-project-sync"
  | "transform-commit";

/** @internal Serializable timing emitted only to the repository benchmark. */
export interface InternalBenchmarkPhaseEvent {
  readonly durationMs: number;
  readonly fileCount: number;
  readonly fileName?: string;
  readonly phase: InternalBenchmarkPhase;
  readonly revision: number;
  readonly status: "completed" | "failed";
}

/** @internal Serializable analysis emitted only to the repository benchmark. */
export interface InternalBenchmarkAnalysisEvent {
  readonly durationMs: number;
  readonly fileName: string;
  readonly result: AnalyzeResult;
  readonly revision: number;
}

/** @internal Controls used only by the repository benchmark harness. */
export interface InternalBenchmarkControls {
  bypassMemoryCache?: boolean;
  collectNativeRequestProfile?: boolean;
  collectNativeTiming?: boolean;
  getNativeRequestProfile?: () => unknown;
  getNativeTimingInfo?: () => unknown;
  onAnalysis?: (event: InternalBenchmarkAnalysisEvent) => void;
  onPhase?: (event: InternalBenchmarkPhaseEvent) => void;
  resetNativeRequestProfile?: () => void;
  resetNativeTimingInfo?: () => void;
}

export type Options = LoaderOptions &
  TypescriptOptions &
  DocGenOptions & {
    /** @internal */
    __benchmark?: InternalBenchmarkControls;
  };

interface PublicComponentNameSymbol {
  readonly name: string;
  getEscapedName(): string | number;
  getName(): string;
}

interface PublicSourceFile {
  readonly fileName: string;
  readonly text: string;
}

interface PublicPropItem {
  declarations?: PublicPropParent[];
  defaultValue: any;
  description: string;
  name: string;
  parent?: PublicPropParent;
  required: boolean;
  tags?: object;
  type: {
    name: string;
    raw?: string;
    value?: any;
  };
}

interface PublicPropParent {
  fileName: string;
  name: string;
}

type PublicComponentNameResolver = {
  bivarianceHack(
    symbol: PublicComponentNameSymbol,
    source: PublicSourceFile,
  ): false | null | string | undefined;
}["bivarianceHack"];

// TypeScript 7 no longer exposes its compiler object types from the package
// root. Keep legacy callbacks source-compatible without leaking those removed
// imports into the declaration consumed by native-mode users.
type PublicLegacyCompilerObject = any;

type PublicLegacyComponentNameResolver = {
  bivarianceHack(
    symbol: PublicLegacyCompilerObject,
    source: PublicLegacyCompilerObject,
  ): false | null | string | undefined;
}["bivarianceHack"];

type PublicPropFilter = {
  bivarianceHack(prop: PublicPropItem, component: { name: string }): boolean;
}["bivarianceHack"];

interface PublicStaticPropFilter {
  skipPropsWithName?: string | string[];
  skipPropsWithoutDoc?: boolean;
}

/**
 * Public plugin options consumable with both TypeScript 4-6 and TypeScript 7.
 * Compiler-specific objects are kept behind compatibility boundaries because
 * TypeScript 7 no longer exports compiler API types from the package root.
 */
interface PublicOptionsBase extends LoaderOptions {
  compilerOptions?: object;
  customComponentTypes?: string[];
  exclude?: string[];
  EXPERIMENTAL_useProjectService?: boolean;
  EXPERIMENTAL_useWatchProgram?: boolean;
  fileSystemCache?: boolean | FileSystemCacheOptions;
  include?: string[];
  propFilter?: PublicPropFilter | PublicStaticPropFilter;
  savePropValueAsString?: boolean;
  shouldExtractLiteralValuesFromEnum?: boolean;
  shouldExtractValuesFromUnion?: boolean;
  shouldIncludeExpression?: boolean;
  shouldIncludePropTagMap?: boolean;
  shouldRemoveUndefinedFromOptional?: boolean;
  skipChildrenPropWithoutDoc?: boolean;
  tsconfigPath?: string;
}

export interface PublicLegacyOptions extends PublicOptionsBase {
  componentNameResolver?: PublicLegacyComponentNameResolver;
  docgenMode?: Exclude<DocgenMode, "native">;
}

export interface PublicNativeOptions extends PublicOptionsBase {
  componentNameResolver?: PublicComponentNameResolver;
  docgenMode: "native";
}

export interface PublicDynamicModeOptions extends PublicOptionsBase {
  componentNameResolver?: PublicComponentNameResolver;
  docgenMode: DocgenMode;
}

export type PublicOptions =
  | PublicLegacyOptions
  | PublicNativeOptions
  | PublicDynamicModeOptions;

export type RuntimeMode = "default" | "native" | "projectService" | "watch";

const hasOwnOption = (options: Options, key: keyof Options): boolean =>
  Object.hasOwn(options, key);

export const resolveDocgenRuntimeMode = (options: Options): RuntimeMode => {
  if (options.docgenMode !== undefined) {
    const conflictingOptions = [
      "EXPERIMENTAL_useWatchProgram",
      "EXPERIMENTAL_useProjectService",
    ].filter((key) => hasOwnOption(options, key as keyof Options));
    if (conflictingOptions.length > 0) {
      throw new Error(
        `docgenMode cannot be combined with ${conflictingOptions.join(" or ")}`,
      );
    }
    if (options.docgenMode === "legacy") return "default";
    if (options.docgenMode === "native") return "native";
    if (options.docgenMode === "project-service") return "projectService";
    throw new Error(
      `Invalid docgenMode ${JSON.stringify(options.docgenMode)}; expected "legacy", "native", or "project-service"`,
    );
  }
  if (options.EXPERIMENTAL_useProjectService) return "projectService";
  if (options.EXPERIMENTAL_useWatchProgram) return "watch";
  return "default";
};

export function getGenerateOptions(
  options: Options,
): Pick<GeneratorOptions, "setDisplayName" | "typePropName"> {
  const { setDisplayName = true, typePropName = "type" } = options;

  return {
    setDisplayName,
    typePropName,
  };
}
