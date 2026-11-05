import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeBoundaryPath,
  normalizeBoundaryPaths,
} from "../docgen/pathIdentity";
import type { FileSystemCacheOptions, Options } from "./options";

const DEFAULT_FILE_SYSTEM_CACHE_DIRECTORY = path.join(
  "node_modules",
  ".cache",
  "vite-plugin-react-docgen-typescript",
);
const FILE_SYSTEM_CACHE_VERSION = 9;
const PACKAGE_NAME = "@joshwooding/vite-plugin-react-docgen-typescript";

type PersistedTransformResult =
  | {
      dependencies?: string[];
      kind: "code";
      code: string;
      proof: FileSystemCacheProof;
      unresolvedDependencies?: string[];
    }
  | {
      dependencies?: string[];
      kind: "null";
      proof: FileSystemCacheProof;
      unresolvedDependencies?: string[];
    };

export interface FileSystemCacheConfigProof {
  contentHash: string;
  fileName: string;
}

export interface FileSystemCacheDependencyFingerprint {
  contentHash: string;
  fileName: string;
}

export interface FileSystemCacheProof {
  backendFingerprint: string;
  componentFile: string;
  configFiles: FileSystemCacheConfigProof[];
  dependencyFingerprints: FileSystemCacheDependencyFingerprint[];
  selectionFingerprint: string;
  trackedFiles: string[];
}

export interface CacheableTransformResult {
  code: string;
  map: null;
}

export interface FileSystemTransformCacheEntry {
  dependencies: string[] | undefined;
  proof: FileSystemCacheProof;
  result: CacheableTransformResult | null;
  unresolvedDependencies?: string[];
}

export interface ResolvedFileSystemCacheOptions {
  directory: string;
  enabled: boolean;
}

const resolveTsconfigPath = (rootDir: string, tsconfigPath: string) =>
  path.isAbsolute(tsconfigPath)
    ? tsconfigPath
    : path.resolve(rootDir, tsconfigPath);

const hashValue = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const normalizeFileSystemCacheOptions = (
  fileSystemCache: Options["fileSystemCache"],
): FileSystemCacheOptions | false => {
  if (!fileSystemCache) {
    return false;
  }

  if (fileSystemCache === true) {
    return {};
  }

  return fileSystemCache;
};

const serializeCacheValue = (
  value: unknown,
  seen: WeakSet<object>,
): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "function") {
    return {
      __type: "function",
      value: value.toString(),
    };
  }

  if (value instanceof RegExp) {
    return {
      __type: "regexp",
      value: value.toString(),
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeCacheValue(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }

    seen.add(value);

    return Object.fromEntries(
      Object.entries(value)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, item]) => [key, serializeCacheValue(item, seen)]),
    );
  }

  return value;
};

const stableStringify = (value: unknown): string =>
  JSON.stringify(serializeCacheValue(value, new WeakSet()));

const getCurrentModuleDirectory = () =>
  path.dirname(fileURLToPath(import.meta.url));

const readPackageVersion = (packageJsonPath: string): string | undefined => {
  try {
    const parsedPackage = JSON.parse(
      readFileSync(packageJsonPath, "utf-8"),
    ) as {
      name?: string;
      version?: string;
    };

    return typeof parsedPackage.version === "string"
      ? parsedPackage.version
      : undefined;
  } catch {
    return undefined;
  }
};

const findNearestPackageJson = (
  startDir: string,
  packageName: string,
): string | undefined => {
  let currentDir = path.resolve(startDir);

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");

    if (existsSync(packageJsonPath)) {
      try {
        const parsedPackage = JSON.parse(
          readFileSync(packageJsonPath, "utf-8"),
        ) as { name?: string };

        if (parsedPackage.name === packageName) {
          return packageJsonPath;
        }
      } catch {
        // Ignore invalid package.json files while walking upwards.
      }
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
};

const findDependencyPackageJson = (
  startDir: string,
  packageName: string,
): string | undefined => {
  let currentDir = path.resolve(startDir);
  const packageSegments = packageName.split("/");

  while (true) {
    const packageJsonPath = path.join(
      currentDir,
      "node_modules",
      ...packageSegments,
      "package.json",
    );

    if (existsSync(packageJsonPath)) {
      return packageJsonPath;
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
};

const resolvePackageVersion = (
  packageName: string,
  searchRoots: string[],
): string | undefined => {
  for (const searchRoot of searchRoots) {
    const packageJsonPath = findDependencyPackageJson(searchRoot, packageName);

    if (packageJsonPath) {
      return readPackageVersion(packageJsonPath);
    }
  }

  return undefined;
};

const resolvePluginPackageVersion = (): string | undefined => {
  const packageJsonPath = findNearestPackageJson(
    getCurrentModuleDirectory(),
    PACKAGE_NAME,
  );

  return packageJsonPath ? readPackageVersion(packageJsonPath) : undefined;
};

export function createDependencyVersionFingerprint(input: {
  packageNames: readonly string[];
  rootDir: string;
  schema: string;
}): string {
  const moduleDirectory = getCurrentModuleDirectory();
  return hashValue(
    stableStringify({
      dependencies: Object.fromEntries(
        input.packageNames.map((packageName) => [
          packageName,
          resolvePackageVersion(packageName, [input.rootDir, moduleDirectory]),
        ]),
      ),
      schema: input.schema,
    }),
  );
}

const getPersistedTransformResultPath = (
  directory: string,
  normalizedFileId: string,
  source: string,
) =>
  path.join(directory, `${hashValue(`${normalizedFileId}\0${source}`)}.json`);

const toPersistedTransformResult = (
  entry: FileSystemTransformCacheEntry,
): PersistedTransformResult =>
  entry.result === null
    ? {
        dependencies: entry.dependencies,
        kind: "null",
        proof: entry.proof,
        unresolvedDependencies: entry.unresolvedDependencies,
      }
    : {
        code: entry.result.code,
        dependencies: entry.dependencies,
        kind: "code",
        proof: entry.proof,
        unresolvedDependencies: entry.unresolvedDependencies,
      };

const fromPersistedTransformResult = (
  result: PersistedTransformResult,
): FileSystemTransformCacheEntry => ({
  dependencies: result.dependencies,
  proof: result.proof,
  result:
    result.kind === "null"
      ? null
      : {
          code: result.code,
          map: null,
        },
  unresolvedDependencies: result.unresolvedDependencies,
});

export function resolveFileSystemCacheOptions(
  options: Options,
  rootDir: string,
): ResolvedFileSystemCacheOptions {
  const normalizedOptions = normalizeFileSystemCacheOptions(
    options.fileSystemCache,
  );

  if (!normalizedOptions) {
    return {
      directory: path.resolve(rootDir, DEFAULT_FILE_SYSTEM_CACHE_DIRECTORY),
      enabled: false,
    };
  }

  return {
    directory: path.resolve(
      rootDir,
      normalizedOptions.directory ?? DEFAULT_FILE_SYSTEM_CACHE_DIRECTORY,
    ),
    enabled: normalizedOptions.enabled ?? true,
  };
}

export function createFileSystemCacheNamespace(
  options: Options,
  rootDir: string,
  backendFingerprint = "legacy-unfingerprinted",
): string {
  const { fileSystemCache, ...cacheKeyOptions } = options;
  const moduleDirectory = getCurrentModuleDirectory();
  const tsconfigPath =
    !options.compilerOptions &&
    existsSync(
      resolveTsconfigPath(rootDir, options.tsconfigPath ?? "tsconfig.json"),
    )
      ? resolveTsconfigPath(rootDir, options.tsconfigPath ?? "tsconfig.json")
      : undefined;

  const tsconfigContents = tsconfigPath
    ? readFileSync(tsconfigPath, "utf-8")
    : undefined;
  const packageVersions = {
    plugin: resolvePluginPackageVersion(),
    reactDocgenTypescript: resolvePackageVersion("react-docgen-typescript", [
      rootDir,
      moduleDirectory,
    ]),
    typescript: resolvePackageVersion("typescript", [rootDir, moduleDirectory]),
  };

  return hashValue(
    stableStringify({
      cacheKeyOptions,
      backendFingerprint,
      packageVersions,
      rootDir,
      tsconfigContents,
      tsconfigPath,
      version: FILE_SYSTEM_CACHE_VERSION,
    }),
  );
}

export function createFileSelectionFingerprint(selection: {
  exclude: readonly string[];
  include: readonly string[];
}): string {
  return hashValue(
    stableStringify({
      exclude: [...selection.exclude],
      include: [...selection.include],
    }),
  );
}

export function createFileSystemCacheProof(input: {
  backendFingerprint: string;
  componentFile: string;
  configFiles: readonly string[];
  dependencies: readonly string[];
  selectionFingerprint: string;
  trackedFiles: readonly string[];
}): FileSystemCacheProof {
  const componentFile = normalizeBoundaryPath(input.componentFile);
  const hashFiles = (fileNames: readonly string[]) =>
    normalizeBoundaryPaths(fileNames).map((fileName) => ({
      contentHash: hashValue(readFileSync(fileName, "utf-8")),
      fileName,
    }));

  return {
    backendFingerprint: input.backendFingerprint,
    componentFile,
    configFiles: hashFiles(input.configFiles),
    dependencyFingerprints: hashFiles(
      input.dependencies.filter(
        (dependencyFile) =>
          normalizeBoundaryPath(dependencyFile) !== componentFile,
      ),
    ),
    selectionFingerprint: input.selectionFingerprint,
    trackedFiles: normalizeBoundaryPaths(input.trackedFiles),
  };
}

export function isFileSystemCacheProofValid(
  proof: FileSystemCacheProof | undefined,
  expected: {
    backendFingerprint: string;
    componentFile: string;
    configFiles: readonly string[];
    dependencies: readonly string[];
    selectionFingerprint: string;
    trackedFiles: readonly string[];
  },
): boolean {
  if (
    !proof ||
    typeof proof.backendFingerprint !== "string" ||
    typeof proof.componentFile !== "string" ||
    typeof proof.selectionFingerprint !== "string" ||
    proof.backendFingerprint !== expected.backendFingerprint ||
    normalizeBoundaryPath(proof.componentFile) !==
      normalizeBoundaryPath(expected.componentFile) ||
    proof.selectionFingerprint !== expected.selectionFingerprint ||
    !Array.isArray(proof.configFiles) ||
    !Array.isArray(proof.dependencyFingerprints) ||
    !Array.isArray(proof.trackedFiles) ||
    !proof.trackedFiles.every((file) => typeof file === "string")
  ) {
    return false;
  }

  const validateFiles = (
    files:
      | FileSystemCacheConfigProof[]
      | FileSystemCacheDependencyFingerprint[],
  ) => {
    if (
      !files.every(
        (file): file is FileSystemCacheConfigProof =>
          typeof file === "object" &&
          file !== null &&
          typeof file.contentHash === "string" &&
          /^[a-f0-9]{64}$/.test(file.contentHash) &&
          typeof file.fileName === "string",
      )
    ) {
      return false;
    }

    const normalizedFiles = normalizeBoundaryPaths(
      files.map(({ fileName }) => fileName),
    );
    if (
      normalizedFiles.length !== files.length ||
      normalizedFiles.some(
        (normalizedFile, index) => normalizedFile !== files[index]?.fileName,
      )
    ) {
      return false;
    }

    return files.every(({ contentHash, fileName }) => {
      try {
        return hashValue(readFileSync(fileName, "utf-8")) === contentHash;
      } catch {
        return false;
      }
    });
  };

  return (
    validateFiles(proof.configFiles) &&
    validateFiles(proof.dependencyFingerprints) &&
    JSON.stringify(
      proof.dependencyFingerprints.map(({ fileName }) => fileName),
    ) ===
      JSON.stringify(
        normalizeBoundaryPaths(expected.dependencies).filter(
          (fileName) =>
            fileName !== normalizeBoundaryPath(expected.componentFile),
        ),
      ) &&
    JSON.stringify(proof.configFiles.map(({ fileName }) => fileName)) ===
      JSON.stringify(normalizeBoundaryPaths(expected.configFiles)) &&
    JSON.stringify(proof.trackedFiles) ===
      JSON.stringify(normalizeBoundaryPaths(proof.trackedFiles)) &&
    JSON.stringify(proof.trackedFiles) ===
      JSON.stringify(normalizeBoundaryPaths(expected.trackedFiles))
  );
}

export function readFileSystemTransformCache(
  directory: string,
  normalizedFileId: string,
  source: string,
): FileSystemTransformCacheEntry | undefined {
  const cacheFilePath = getPersistedTransformResultPath(
    directory,
    normalizedFileId,
    source,
  );

  if (!existsSync(cacheFilePath)) {
    return undefined;
  }

  const parsedCacheResult = JSON.parse(
    readFileSync(cacheFilePath, "utf-8"),
  ) as PersistedTransformResult;

  return fromPersistedTransformResult(parsedCacheResult);
}

export function writeFileSystemTransformCache(
  directory: string,
  normalizedFileId: string,
  source: string,
  entry: FileSystemTransformCacheEntry,
): void {
  mkdirSync(directory, { recursive: true });

  writeFileSync(
    getPersistedTransformResultPath(directory, normalizedFileId, source),
    JSON.stringify(toPersistedTransformResult(entry)),
  );
}

export function deleteFileSystemTransformCache(
  directory: string,
  normalizedFileId: string,
  source: string,
): void {
  rmSync(getPersistedTransformResultPath(directory, normalizedFileId, source), {
    force: true,
  });
}

export function clearFileSystemTransformCache(directory: string): void {
  rmSync(directory, {
    force: true,
    recursive: true,
  });
}
