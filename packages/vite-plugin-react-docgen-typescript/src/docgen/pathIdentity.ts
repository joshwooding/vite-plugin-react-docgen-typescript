import { realpathSync } from "node:fs";
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

const resolvePhysicalPath = (absolutePath: string): string => {
  const missingSegments: string[] = [];
  let candidate = absolutePath;

  while (true) {
    try {
      return path.join(realpathSync.native(candidate), ...missingSegments);
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) return absolutePath;
      missingSegments.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
};

export const normalizeBoundaryPath = (value: string): string =>
  resolvePhysicalPath(path.resolve(cleanBoundaryPath(value)));

export const normalizeBoundaryPaths = (values: Iterable<string>): string[] =>
  [...new Set([...values].map(normalizeBoundaryPath))].sort();
