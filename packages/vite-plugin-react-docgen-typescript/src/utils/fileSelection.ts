import { createFilter } from "vite";
import { normalizeBoundaryPath } from "../docgen/pathIdentity";

export const DEFAULT_INCLUDE = ["**/*.tsx"] as const;
export const DEFAULT_EXCLUDE = ["**/*.stories.tsx"] as const;

const DECLARATION_FILE_PATTERN = /\.d\.[cm]?ts$/;

export interface ResolvedFileSelection {
  readonly exclude: readonly string[];
  readonly hasIncludes: boolean;
  readonly include: readonly string[];
  matchesDocgenFile(absolutePath: string): boolean;
}

const describeReceivedType = (value: unknown): string => {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (value instanceof RegExp) {
    return "RegExp";
  }

  return typeof value;
};

const resolvePatterns = (
  optionName: "exclude" | "include",
  value: unknown,
  defaults: readonly string[],
): readonly string[] => {
  const patterns = value === undefined ? defaults : value;

  if (!Array.isArray(patterns)) {
    throw new TypeError(
      `The "${optionName}" option must be an array of string globs; received ${describeReceivedType(patterns)}.`,
    );
  }

  for (let index = 0; index < patterns.length; index += 1) {
    const pattern = patterns[index];

    if (typeof pattern !== "string") {
      throw new TypeError(
        `The "${optionName}" option at index ${index} must be a string glob; received ${describeReceivedType(pattern)}.`,
      );
    }
  }

  return Object.freeze([...new Set(patterns)]);
};

export const resolveFileSelection = (
  configRoot: string,
  options: {
    exclude?: unknown;
    include?: unknown;
  },
): ResolvedFileSelection => {
  const include = resolvePatterns("include", options.include, DEFAULT_INCLUDE);
  const exclude = resolvePatterns("exclude", options.exclude, DEFAULT_EXCLUDE);
  const hasIncludes = include.length > 0;
  const normalizedConfigRoot = normalizeBoundaryPath(configRoot);
  const filter = hasIncludes
    ? createFilter([...include], [...exclude], {
        resolve: normalizedConfigRoot,
      })
    : undefined;

  return Object.freeze({
    exclude,
    hasIncludes,
    include,
    matchesDocgenFile(absolutePath: string): boolean {
      if (!filter) {
        return false;
      }

      const queryIndex = absolutePath.indexOf("?");
      const queryFreePath =
        queryIndex === -1 ? absolutePath : absolutePath.slice(0, queryIndex);
      const normalizedPath = normalizeBoundaryPath(queryFreePath);

      return (
        !DECLARATION_FILE_PATTERN.test(normalizedPath) && filter(normalizedPath)
      );
    },
  });
};
