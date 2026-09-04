import { realpathSync } from "node:fs";
import path from "node:path";

const MAX_PHYSICAL_PATH_CACHE_ENTRIES = 16_384;
const physicalPathCache = new Map<string, string>();

const cachePhysicalPath = (input: string, physicalPath: string) => {
  if (physicalPathCache.size >= MAX_PHYSICAL_PATH_CACHE_ENTRIES) {
    physicalPathCache.clear();
  }
  physicalPathCache.set(input, physicalPath);
  return physicalPath;
};

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
  const cached = physicalPathCache.get(absolutePath);
  if (cached) return cached;

  const missingSegments: string[] = [];
  let candidate = absolutePath;

  while (true) {
    const cachedCandidate = physicalPathCache.get(candidate);
    if (cachedCandidate) {
      return cachePhysicalPath(
        absolutePath,
        path.join(cachedCandidate, ...missingSegments),
      );
    }
    try {
      const physicalCandidate = cachePhysicalPath(
        candidate,
        realpathSync.native(candidate),
      );
      return cachePhysicalPath(
        absolutePath,
        path.join(physicalCandidate, ...missingSegments),
      );
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) {
        return cachePhysicalPath(absolutePath, absolutePath);
      }
      missingSegments.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
};

export const normalizeBoundaryPath = (value: string): string =>
  resolvePhysicalPath(path.resolve(cleanBoundaryPath(value)));

export const normalizeBoundaryPaths = (values: Iterable<string>): string[] =>
  [...new Set([...values].map(normalizeBoundaryPath))].sort();
