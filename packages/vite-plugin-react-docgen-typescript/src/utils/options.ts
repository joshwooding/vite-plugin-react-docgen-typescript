import type { ParserOptions } from "react-docgen-typescript";
import type { CompilerOptions } from "typescript";
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

/**
 * Options for the persistent file-system cache.
 *
 * @deprecated Remove `fileSystemCache` from configuration, or set it to `false`.
 */
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

export type DocgenMode = "legacy" | "project-service";

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
  /**
   * Persistent transform cache stored on disk.
   *
   * In-memory caching and TypeScript program reuse continue when disabled.
   *
   * @default false
   * @deprecated Remove `fileSystemCache` from configuration, or set it to `false`.
   */
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

export type Options = LoaderOptions & TypescriptOptions & DocGenOptions;

type RuntimeMode = "default" | "projectService" | "watch";

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
    if (options.docgenMode === "project-service") return "projectService";
    throw new Error(
      `Invalid docgenMode ${JSON.stringify(options.docgenMode)}; expected "legacy" or "project-service"`,
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
