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
import type { FileSystemCacheOptions, Options } from "./options";

const DEFAULT_FILE_SYSTEM_CACHE_DIRECTORY = path.join(
  "node_modules",
  ".cache",
  "vite-plugin-react-docgen-typescript",
);
const FILE_SYSTEM_CACHE_VERSION = 5;
const PACKAGE_NAME = "@joshwooding/vite-plugin-react-docgen-typescript";

type PersistedTransformResult =
  | {
      dependencies?: string[];
      kind: "code";
      code: string;
    }
  | {
      dependencies?: string[];
      kind: "null";
    };

export interface CacheableTransformResult {
  code: string;
  map: null;
}

export interface FileSystemTransformCacheEntry {
  dependencies: string[] | undefined;
  result: CacheableTransformResult | null;
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
      }
    : {
        code: entry.result.code,
        dependencies: entry.dependencies,
        kind: "code",
      };

const fromPersistedTransformResult = (
  result: PersistedTransformResult,
): FileSystemTransformCacheEntry => ({
  dependencies: result.dependencies,
  result:
    result.kind === "null"
      ? null
      : {
          code: result.code,
          map: null,
        },
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
      packageVersions,
      rootDir,
      tsconfigContents,
      tsconfigPath,
      version: FILE_SYSTEM_CACHE_VERSION,
    }),
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
