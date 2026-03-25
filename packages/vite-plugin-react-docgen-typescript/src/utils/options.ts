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

export type DocGenOptions = ParserOptions & {
  /** Glob patterns to ignore */
  exclude?: string[];
  /** Glob patterns to include. defaults to ts|tsx */
  include?: string[];
  /** Persistent transform cache stored on disk. */
  fileSystemCache?: boolean | FileSystemCacheOptions;
  /** experimental watch mode */
  EXPERIMENTAL_useWatchProgram?: boolean;
  /** experimental project service */
  EXPERIMENTAL_useProjectService?: boolean;
};

export type Options = LoaderOptions & TypescriptOptions & DocGenOptions;

export function getGenerateOptions(
  options: Options,
): Pick<GeneratorOptions, "setDisplayName" | "typePropName"> {
  const { setDisplayName = true, typePropName = "type" } = options;

  return {
    setDisplayName,
    typePropName,
  };
}
