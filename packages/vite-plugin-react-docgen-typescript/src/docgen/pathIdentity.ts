import path from "node:path";

const firstSuffixIndex = (value: string): number => {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");

  if (queryIndex === -1) return hashIndex;
  if (hashIndex === -1) return queryIndex;
  return Math.min(queryIndex, hashIndex);
};

export const cleanBoundaryPath = (value: string): string => {
  const suffixIndex = firstSuffixIndex(value);
  return suffixIndex === -1 ? value : value.slice(0, suffixIndex);
};

export const normalizeBoundaryPath = (value: string): string =>
  path.resolve(cleanBoundaryPath(value));

export const normalizeBoundaryPaths = (values: Iterable<string>): string[] =>
  [...new Set([...values].map(normalizeBoundaryPath))].sort((left, right) =>
    left.localeCompare(right),
  );
