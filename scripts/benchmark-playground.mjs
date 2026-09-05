import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const benchmarksRoot = path.join(repoRoot, "benchmarks", "fixtures");
const packageRoot = path.join(
  repoRoot,
  "packages",
  "vite-plugin-react-docgen-typescript",
);
const distEntry = path.join(packageRoot, "dist", "index.mjs");
const require = createRequire(distEntry);
const execFileAsync = promisify(execFile);
const REPORT_SCHEMA_VERSION = 2;
const CACHE_MODES = ["off", "populate", "restart"];

const DEFAULT_ITERATIONS = 5;
const DEFAULT_MODES = ["default", "watch", "projectService"];
const DEFAULT_SCENARIO = "playground";
const HMR_POLL_INTERVAL_MS = 25;
const HMR_TIMEOUT_MS = 10_000;
const SCENARIOS = {
  "react-typing": {
    changedFileRelativePath: path.join("src", "components", "Button.tsx"),
    createScaleCopies(workspaceRoot, scale) {
      for (let copyIndex = 1; copyIndex < scale; copyIndex += 1) {
        const copyRoot = path.join(
          workspaceRoot,
          "src",
          "generated",
          `set-${copyIndex}`,
        );
        mkdirSync(copyRoot, { recursive: true });
        cpSync(
          path.join(workspaceRoot, "src", "components"),
          path.join(copyRoot, "components"),
          { recursive: true },
        );
        cpSync(
          path.join(workspaceRoot, "src", "shared.ts"),
          path.join(copyRoot, "shared.ts"),
        );
      }
    },
    fixtureRoot: path.join(benchmarksRoot, "react-typing"),
    markerText: "Native button with shared action styling.",
    name: "react-typing",
    sourceRootRelativePath: "src",
    updatedMarkerText: "Updated native button with shared action styling.",
    workspaceDirectoryName: "react-typing",
  },
  playground: {
    changedFileRelativePath: path.join("stories", "Button.tsx"),
    createScaleCopies(workspaceRoot, scale) {
      const workspaceStoriesRoot = path.join(workspaceRoot, "stories");
      const filesToClone = [
        "Button.tsx",
        "Header.tsx",
        "Page.tsx",
        "button.css",
        "header.css",
        "page.css",
      ];

      for (let copyIndex = 1; copyIndex < scale; copyIndex += 1) {
        const copyRoot = path.join(
          workspaceStoriesRoot,
          "generated",
          `set-${String(copyIndex).padStart(2, "0")}`,
        );

        mkdirSync(copyRoot, { recursive: true });

        for (const fileName of filesToClone) {
          cpSync(
            path.join(workspaceStoriesRoot, fileName),
            path.join(copyRoot, fileName),
          );
        }
      }
    },
    fixtureRoot: path.join(repoRoot, "playground"),
    markerText: "Primary UI component for user interaction",
    name: "playground",
    sourceRootRelativePath: "stories",
    updatedMarkerText: "Updated primary UI component for user interaction",
    workspaceDirectoryName: "playground",
  },
  "large-project": {
    changedFileRelativePath: path.join(
      "src",
      "components",
      "actions",
      "ActionButton.tsx",
    ),
    createScaleCopies(workspaceRoot, scale) {
      const referenceFeatureRoot = path.join(
        workspaceRoot,
        "src",
        "features",
        "reference",
      );
      const generatedFeaturesRoot = path.join(
        workspaceRoot,
        "src",
        "features",
        "generated",
      );

      mkdirSync(generatedFeaturesRoot, { recursive: true });

      for (let copyIndex = 1; copyIndex < scale; copyIndex += 1) {
        cpSync(
          referenceFeatureRoot,
          path.join(
            generatedFeaturesRoot,
            `pack-${String(copyIndex).padStart(2, "0")}`,
          ),
          { recursive: true },
        );
      }
    },
    fixtureRoot: path.join(benchmarksRoot, "large-project"),
    markerText: "Action trigger used across feature entry points.",
    name: "large-project",
    sourceRootRelativePath: "src",
    updatedMarkerText:
      "Updated action trigger used across feature entry points.",
    workspaceDirectoryName: "large-project",
  },
  "large-design-system": {
    changedFileRelativePath: path.join("src", "primitives", "Text.tsx"),
    createScaleCopies(workspaceRoot, scale) {
      const referenceRecipeRoot = path.join(
        workspaceRoot,
        "src",
        "recipes",
        "reference",
      );
      const generatedRecipesRoot = path.join(
        workspaceRoot,
        "src",
        "recipes",
        "generated",
      );

      mkdirSync(generatedRecipesRoot, { recursive: true });

      for (let copyIndex = 1; copyIndex < scale; copyIndex += 1) {
        cpSync(
          referenceRecipeRoot,
          path.join(
            generatedRecipesRoot,
            `kit-${String(copyIndex).padStart(2, "0")}`,
          ),
          { recursive: true },
        );
      }
    },
    fixtureRoot: path.join(benchmarksRoot, "large-design-system"),
    markerText:
      "Foundational typography primitive shared across published components.",
    name: "large-design-system",
    sourceRootRelativePath: "src",
    updatedMarkerText:
      "Updated foundational typography primitive shared across published components.",
    workspaceDirectoryName: "large-design-system",
  },
};
const HELP_TEXT = `Usage: node ./scripts/benchmark-playground.mjs [options]

Options:
  --scenario <name>       Benchmark fixture to run. Default: ${DEFAULT_SCENARIO}
  --iterations <number>   Number of measured runs per mode. Default: ${DEFAULT_ITERATIONS}
  --modes <list>          Comma-separated modes: default,watch,projectService
  --scale <number>        Number of scenario expansions to benchmark. Default: 1
  --cache <state>         Persistent cache: off,populate,restart. Default: off
  --output <file>         Write JSON results to a file
  --baseline <file>       Compare results against a previous JSON output
  --keep-temp             Keep the temporary benchmark workspace
  --help                  Show this message

Scenarios:
  ${Object.keys(SCENARIOS).join(", ")}
`;

export function parseArgs(argv) {
  const options = {
    baseline: null,
    cache: "off",
    internalSeed: null,
    internalValidate: null,
    iterations: DEFAULT_ITERATIONS,
    keepTemp: false,
    modes: [...DEFAULT_MODES],
    output: null,
    scenario: DEFAULT_SCENARIO,
    scale: 1,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    switch (argument) {
      case "--cache":
        options.cache = argv[++index];
        break;
      case "--internal-seed":
        options.internalSeed = argv[++index];
        break;
      case "--internal-validate":
        options.internalValidate = argv[++index];
        break;
      case "--scenario":
        options.scenario = argv[++index];
        break;
      case "--iterations":
        options.iterations = Number(argv[++index]);
        break;
      case "--modes":
        {
          const modeArguments = [];

          while (index + 1 < argv.length && !argv[index + 1].startsWith("--")) {
            modeArguments.push(argv[++index]);
          }

          if (modeArguments.length === 0) {
            throw new Error("--modes requires at least one mode");
          }

          options.modes = modeArguments
            .flatMap((modeArgument) => modeArgument.split(/[,\s]+/))
            .map((mode) => mode.trim())
            .filter(Boolean);
        }
        break;
      case "--scale":
        options.scale = Number(argv[++index]);
        break;
      case "--output":
        options.output = argv[++index];
        break;
      case "--baseline":
        options.baseline = argv[++index];
        break;
      case "--keep-temp":
        options.keepTemp = true;
        break;
      case "--help":
        console.log(HELP_TEXT);
        process.exit(0);
        return options;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!Number.isInteger(options.iterations) || options.iterations <= 0) {
    throw new Error("--iterations must be a positive integer");
  }

  if (!Number.isInteger(options.scale) || options.scale <= 0) {
    throw new Error("--scale must be a positive integer");
  }
  if (!CACHE_MODES.includes(options.cache)) {
    throw new Error(
      `Unsupported cache state: ${options.cache}. Expected: ${CACHE_MODES.join(", ")}`,
    );
  }

  if (!(options.scenario in SCENARIOS)) {
    throw new Error(
      `Unsupported scenario: ${options.scenario}. Expected: ${Object.keys(SCENARIOS).join(", ")}`,
    );
  }

  const invalidModes = options.modes.filter(
    (mode) => !DEFAULT_MODES.includes(mode),
  );

  if (invalidModes.length > 0) {
    throw new Error(
      `Unsupported mode(s): ${invalidModes.join(", ")}. Expected: ${DEFAULT_MODES.join(", ")}`,
    );
  }

  return options;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function summarizeRuns(runs) {
  const statuses = runs.map((run) => run.componentHmr.status);
  const hmrStatus = statuses.every((status) => status === "updated")
    ? "updated"
    : statuses.some((status) => status === "stale")
      ? "stale"
      : "unsupported";

  return {
    componentHmr: {
      affectedModuleCount: median(
        runs.map((run) => run.componentHmr.affectedModuleCount),
      ),
      invalidatedModuleCount: median(
        runs.map((run) => run.componentHmr.invalidatedModuleCount),
      ),
      status: hmrStatus,
      totalCycleMs: median(runs.map((run) => run.componentHmr.totalCycleMs)),
    },
    coldBatchMs: median(runs.map((run) => run.coldBatchMs)),
    configResolvedMs: median(runs.map((run) => run.configResolvedMs)),
    fileCount: runs[0].fileCount,
    firstBatchMs: median(runs.map((run) => run.firstBatchMs)),
    sessionTotalMs: median(runs.map((run) => run.sessionTotalMs)),
    warmBatchMs: median(runs.map((run) => run.warmBatchMs)),
  };
}

function collectComponentFiles(rootDirectory) {
  const files = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();

    if (!currentDirectory) {
      continue;
    }

    for (const entry of readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const entryPath = path.join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }

      if (
        entry.isFile() &&
        entry.name.endsWith(".tsx") &&
        !entry.name.endsWith(".stories.tsx")
      ) {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function createWorkspace(scenarioName, scale) {
  const scenario = SCENARIOS[scenarioName];
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), "vite-plugin-react-docgen-benchmark-"),
  );
  const workspaceRoot = path.join(
    temporaryRoot,
    scenario.workspaceDirectoryName,
  );
  const sourceRoot = path.join(workspaceRoot, scenario.sourceRootRelativePath);

  try {
    cpSync(scenario.fixtureRoot, workspaceRoot, {
      filter(source) {
        return path.basename(source) !== "node_modules";
      },
      recursive: true,
    });

    scenario.createScaleCopies(workspaceRoot, scale);
    if (scenarioName === "react-typing") {
      const dependencies = path.dirname(
        path.dirname(require.resolve("react/package.json")),
      );
      symlinkSync(
        dependencies,
        path.join(workspaceRoot, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
    }
    const files = collectComponentFiles(sourceRoot);

    return {
      changedFile: path.join(workspaceRoot, scenario.changedFileRelativePath),
      cacheDirectory: path.join(temporaryRoot, "persistent-cache"),
      cleanup() {
        removeContainedDirectory(temporaryRoot, tmpdir());
      },
      fileCount: files.length,
      files,
      label: scale === 1 ? scenario.name : `${scenario.name}-x${String(scale)}`,
      markerText: scenario.markerText,
      root: workspaceRoot,
      scenario: scenario.name,
      temporaryRoot,
      tsconfigPath: path.join(workspaceRoot, "tsconfig.json"),
      updatedMarkerText: scenario.updatedMarkerText,
    };
  } catch (error) {
    removeContainedDirectory(temporaryRoot, tmpdir());
    throw error;
  }
}

function createPluginContext() {
  return {
    addWatchFile() {},
    warn(message) {
      throw new Error(`Benchmark plugin warning: ${String(message)}`);
    },
  };
}

function createServer() {
  const invalidatedModules = new Set();

  return {
    invalidatedModules,
    server: {
      moduleGraph: {
        getModulesByFile(file) {
          return new Set([{ file, id: file, url: file }]);
        },
        invalidateModule(module) {
          invalidatedModules.add(module);
        },
      },
    },
  };
}

function createModeConfig(mode, workspace, cache = "off") {
  return {
    ...parserOptions(workspace.scenario),
    fileSystemCache:
      cache === "off" ? false : { directory: workspace.cacheDirectory },
    tsconfigPath: workspace.tsconfigPath,
    ...(mode === "watch" ? { EXPERIMENTAL_useWatchProgram: true } : {}),
    ...(mode === "projectService"
      ? { EXPERIMENTAL_useProjectService: true }
      : {}),
  };
}

function retainNativeDisabled(prop) {
  return (
    prop.name === "disabled" ||
    !prop.parent?.fileName.replaceAll("\\", "/").includes("node_modules")
  );
}

function parserOptions(scenario) {
  return scenario === "react-typing"
    ? {
        propFilter: retainNativeDisabled,
        shouldExtractLiteralValuesFromEnum: true,
        shouldRemoveUndefinedFromOptional: true,
      }
    : {};
}

function parserReport(scenario) {
  return {
    ...parserOptions(scenario),
    propFilter:
      scenario === "react-typing"
        ? `retainNativeDisabled: ${retainNativeDisabled.toString()}`
        : "plugin-default",
  };
}

async function withWorkingDirectory(directory, run) {
  const previousDirectory = process.cwd();
  process.chdir(directory);

  try {
    return await run();
  } finally {
    process.chdir(previousDirectory);
  }
}

function readTransformCode(result) {
  if (!result) {
    return "";
  }

  if (typeof result === "string") {
    return result;
  }

  return result.code ?? "";
}

function extractDocgenDescription(result) {
  const code = readTransformCode(result);
  const match = code.match(
    /__docgenInfo\s*=\s*\{[\s\S]*?"description":\s*"([^"]*)"/,
  );

  return match?.[1] ?? null;
}

export function assertReactMetadata(outputs, workspace) {
  if (workspace.scenario !== "react-typing") return;
  if (outputs.size === 0)
    throw new Error("React fixture produced no component metadata");
  for (const [file, output] of outputs) {
    const match = readTransformCode(output).match(
      /__docgenInfo\s*=\s*(\{[^\r\n]*\})/,
    );
    const doc = match ? JSON.parse(match[1]) : null;
    const disabled = doc?.props?.disabled;
    const intent = doc?.props?.intent;
    if (
      disabled?.type?.name !== "boolean" ||
      !disabled.declarations?.some((declaration) =>
        /[\\/]@types[\\/]react[\\/]/.test(declaration.fileName),
      )
    ) {
      throw new Error(
        `React fixture metadata missing inherited boolean disabled from real React declarations: ${file}`,
      );
    }
    const values = intent?.type?.value?.map((entry) => entry.value).sort();
    if (
      JSON.stringify(values) !== JSON.stringify(['"primary"', '"quiet"']) ||
      !intent.declarations?.some((declaration) =>
        declaration.fileName.replaceAll("\\", "/").endsWith("/shared.ts"),
      )
    ) {
      throw new Error(
        `React fixture metadata missing imported intent union: ${file}`,
      );
    }
  }
}

// Compiler preflight is called exclusively from the seed/validation child.
function validateReactFixture(workspace) {
  if (workspace.scenario !== "react-typing") return null;
  const ts = require("typescript");
  const config = ts.readConfigFile(workspace.tsconfigPath, ts.sys.readFile);
  if (config.error)
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, "\n"),
    );
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    workspace.root,
  );
  const resolved = ts.resolveModuleName(
    "react",
    workspace.changedFile,
    parsed.options,
    ts.sys,
  ).resolvedModule;
  const expected = path.join(
    path.dirname(require.resolve("@types/react/package.json")),
    "index.d.ts",
  );
  if (
    !resolved ||
    realpathSync(resolved.resolvedFileName) !== realpathSync(expected)
  ) {
    throw new Error(
      "React fixture must resolve the installed @types/react declarations; unresolved imports and JSX shims are invalid",
    );
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const rejectShim = (node) => {
    if (
      ts.isModuleDeclaration(node) &&
      ["JSX", "react"].includes(node.name.text)
    ) {
      throw new Error("React fixture contains a local JSX/React shim");
    }
    ts.forEachChild(node, rejectShim);
  };
  for (const file of parsed.fileNames) {
    const source = program.getSourceFile(file);
    if (source) rejectShim(source);
  }
  const errors = [
    ...parsed.errors,
    ...ts.getPreEmitDiagnostics(program),
  ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (errors.length)
    throw new Error(
      `React fixture compiler preflight failed: ${errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n")}`,
    );
  return { reactDeclaration: realpathSync(expected), compilerDiagnostics: 0 };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function moduleFileIdentity(module) {
  const file = module.file ?? module.id ?? module.url;
  if (!file) return null;
  const resolved = path.resolve(file.split(/[?#]/)[0]);
  try {
    return realpathSync(resolved).replaceAll("\\", "/");
  } catch {
    return resolved.replaceAll("\\", "/");
  }
}

function getHmrFilesToTransform(modules, workspace) {
  const identities = new Set(modules.map(moduleFileIdentity));
  return workspace.files.filter((file) =>
    identities.has(moduleFileIdentity({ file })),
  );
}

async function resolveComponentHmrStatus(plugin, files, mode, workspace) {
  if (mode !== "watch") {
    const outputs = await transformFiles(plugin, files);
    assertReactMetadata(outputs, workspace);

    return (
      extractDocgenDescription(outputs.get(workspace.changedFile)) ===
      workspace.updatedMarkerText
    );
  }

  const hmrDeadline = performance.now() + HMR_TIMEOUT_MS;

  while (performance.now() < hmrDeadline) {
    const outputs = await transformFiles(plugin, files);
    assertReactMetadata(outputs, workspace);
    const changedFileDescription = extractDocgenDescription(
      outputs.get(workspace.changedFile),
    );

    if (changedFileDescription === workspace.updatedMarkerText) {
      return true;
    }

    await delay(HMR_POLL_INTERVAL_MS);
  }

  return false;
}

async function transformFiles(plugin, files) {
  const pluginContext = createPluginContext();
  const outputs = new Map();

  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    const result = await plugin.transform.call(pluginContext, source, file);
    outputs.set(file, result);
  }

  return outputs;
}

// Used only by seed/validation child processes; never warm the measurement process.
export async function warmMode(
  reactDocgenTypescript,
  mode,
  workspace,
  cache = "off",
) {
  const plugin = reactDocgenTypescript(
    createModeConfig(mode, workspace, cache),
  );

  try {
    await withWorkingDirectory(workspace.root, async () => {
      await plugin.configResolved?.({ command: "serve", root: workspace.root });
      const outputs = await transformFiles(plugin, workspace.files);
      assertReactMetadata(outputs, workspace);
    });
  } finally {
    await plugin.closeBundle?.();
  }
}

export async function measureModeIteration(
  reactDocgenTypescript,
  mode,
  workspace,
  { cache = "off", processFirstMeasuredInstance = true } = {},
) {
  const originalChangedFile = readFileSync(workspace.changedFile, "utf-8");
  const updatedChangedFile = originalChangedFile.replace(
    workspace.markerText,
    workspace.updatedMarkerText,
  );

  if (updatedChangedFile === originalChangedFile) {
    throw new Error(
      `Failed to update benchmark marker in ${workspace.changedFile}`,
    );
  }

  const sessionStart = performance.now();
  const plugin = reactDocgenTypescript(
    createModeConfig(mode, workspace, cache),
  );
  let result;
  try {
    result = await withWorkingDirectory(workspace.root, async () => {
      const configResolvedStart = performance.now();
      await plugin.configResolved?.({ command: "serve", root: workspace.root });
      const configResolvedMs = performance.now() - configResolvedStart;

      const firstBatchStart = performance.now();
      const firstOutputs = await transformFiles(plugin, workspace.files);
      const firstBatchMs = performance.now() - firstBatchStart;
      assertReactMetadata(firstOutputs, workspace);

      const warmBatchStart = performance.now();
      const warmOutputs = await transformFiles(plugin, workspace.files);
      const warmBatchMs = performance.now() - warmBatchStart;
      assertReactMetadata(warmOutputs, workspace);

      writeFileSync(workspace.changedFile, updatedChangedFile);

      const { invalidatedModules, server } = createServer();
      const componentHmrStart = performance.now();

      const incomingModules = [
        { file: workspace.changedFile, id: workspace.changedFile },
      ];
      const affectedModules = await plugin.handleHotUpdate?.call(
        createPluginContext(),
        {
          file: workspace.changedFile,
          modules: incomingModules,
          server,
        },
      );
      const hmrFiles = getHmrFilesToTransform(
        [
          ...(affectedModules === undefined
            ? incomingModules
            : affectedModules),
          ...invalidatedModules,
        ],
        workspace,
      );

      const updated = await resolveComponentHmrStatus(
        plugin,
        hmrFiles,
        mode,
        workspace,
      );
      if (!updated) {
        throw new Error(
          `Stale docgen metadata after direct-plugin HMR (${mode}, ${workspace.changedFile})`,
        );
      }

      return {
        cache,
        mode,
        processFirstMeasuredInstance,
        componentHmr: {
          affectedModuleCount: hmrFiles.length,
          invalidatedModuleCount: new Set(
            [...invalidatedModules].map(moduleFileIdentity),
          ).size,
          status: updated ? "updated" : "stale",
          totalCycleMs: performance.now() - componentHmrStart,
        },
        coldBatchMs: configResolvedMs + firstBatchMs,
        configResolvedMs,
        fileCount: workspace.fileCount,
        firstBatchMs,
        warmBatchMs,
      };
    });
    return result;
  } finally {
    try {
      await plugin.closeBundle?.();
    } finally {
      if (result) result.sessionTotalMs = performance.now() - sessionStart;
      writeFileSync(workspace.changedFile, originalChangedFile);
    }
  }
}

function removeContainedDirectory(directory, parent) {
  const target = path.resolve(directory);
  const relative = path.relative(path.resolve(parent), target);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`Refusing cleanup outside benchmark workspace: ${target}`);
  }
  rmSync(target, { force: true, recursive: true });
}

async function runSeedProcess(workspace, mode, action = "seed") {
  const manifest = path.join(workspace.temporaryRoot, "seed-workspace.json");
  writeFileSync(manifest, JSON.stringify({ workspace, mode }));
  const { stdout } = await execFileAsync(
    process.execPath,
    [__filename, `--internal-${action}`, manifest],
    {
      cwd: repoRoot,
      windowsHide: true,
    },
  );
  return JSON.parse(stdout);
}

export async function prepareIteration(
  workspace,
  mode,
  cache,
  seed = runSeedProcess,
) {
  removeContainedDirectory(workspace.cacheDirectory, workspace.temporaryRoot);
  if (cache !== "restart") {
    const validation =
      workspace.scenario === "react-typing"
        ? await seed(workspace, mode, "validate")
        : null;
    return { initialEntryCount: 0, seedProcessId: null, validation };
  }
  const seeded = await seed(workspace, mode);
  const initialEntryCount = countCacheEntries(workspace.cacheDirectory);
  if (initialEntryCount === 0)
    throw new Error("Restart seed produced no persistent cache entries");
  return {
    initialEntryCount,
    seedProcessId: seeded.processId,
    validation: workspace.scenario === "react-typing" ? seeded : null,
  };
}

function countCacheEntries(directory) {
  if (!existsSync(directory)) return 0;
  return readdirSync(directory, { recursive: true }).filter((file) =>
    file.endsWith(".json"),
  ).length;
}

function hashFiles(root) {
  const hash = createHash("sha256");
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile())
        hash
          .update(path.relative(root, file).replaceAll("\\", "/"))
          .update(readFileSync(file));
    }
  };
  visit(root);
  return hash.digest("hex");
}

async function collectIdentity() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    windowsHide: true,
  });
  const versions = Object.fromEntries(
    [
      "typescript",
      "react-docgen-typescript",
      "react",
      "@types/react",
      "vite",
    ].map((name) => [
      name,
      JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8"))
        .version,
    ]),
  );
  return {
    buildSha256: hashFiles(path.dirname(distEntry)),
    sourceSha256: hashFiles(path.join(packageRoot, "src")),
    benchmarkSha256: createHash("sha256")
      .update(readFileSync(__filename))
      .digest("hex"),
    gitHead: stdout.trim(),
    pluginVersion: JSON.parse(
      readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ).version,
    dependencies: versions,
  };
}

export function validateBaseline(baseline, options) {
  if (baseline.schemaVersion !== REPORT_SCHEMA_VERSION) {
    throw new Error(
      `Incompatible benchmark baseline schema: expected ${REPORT_SCHEMA_VERSION}; rerun the baseline with this benchmark script.`,
    );
  }
  if (
    baseline.benchmarkKind !== "direct-plugin" ||
    baseline.cache !== options.cache ||
    baseline.scenario.name !== options.scenario ||
    baseline.scenario.scale !== options.scale
  ) {
    throw new Error(
      "Incompatible benchmark baseline scenario, scale, cache state, or timing kind.",
    );
  }
  if (
    baseline.iterations !== options.iterations ||
    JSON.stringify(baseline.modes) !== JSON.stringify(options.modes)
  ) {
    throw new Error(
      "Incompatible benchmark baseline mode order or iteration count changes process warmth.",
    );
  }
  if (
    JSON.stringify(baseline.parserOptions?.parser) !==
    JSON.stringify(parserReport(options.scenario))
  ) {
    throw new Error("Incompatible benchmark baseline parser options.");
  }
}

function printSummary(result, baseline) {
  console.log(
    `Direct-plugin scenario: ${result.scenario.label} (${result.scenario.fileCount} files), cache: ${result.cache}, iterations: ${result.iterations}`,
  );

  for (const modeResult of result.results) {
    const {
      coldBatchMs,
      componentHmr,
      configResolvedMs,
      firstBatchMs,
      sessionTotalMs,
      warmBatchMs,
    } = modeResult.metrics;
    const hmrText =
      componentHmr.status === "updated"
        ? `${componentHmr.totalCycleMs.toFixed(1)}ms`
        : `${componentHmr.status} (${componentHmr.totalCycleMs.toFixed(1)}ms)`;

    console.log(
      `${modeResult.mode.padEnd(14)} setup ${configResolvedMs.toFixed(1)}ms  first ${firstBatchMs.toFixed(1)}ms  cold ${coldBatchMs.toFixed(1)}ms  warm ${warmBatchMs.toFixed(1)}ms  hmr ${hmrText}  affected ${componentHmr.affectedModuleCount.toFixed(0)}  invalidated ${componentHmr.invalidatedModuleCount.toFixed(0)}  session ${sessionTotalMs.toFixed(1)}ms`,
    );

    if (!baseline) {
      continue;
    }

    const baselineMode = baseline.results.find(
      (candidate) => candidate.mode === modeResult.mode,
    );

    if (!baselineMode) {
      continue;
    }

    const comparisons = [
      ["setup", baselineMode.metrics.configResolvedMs, configResolvedMs],
      ["first", baselineMode.metrics.firstBatchMs, firstBatchMs],
      ["cold", baselineMode.metrics.coldBatchMs, coldBatchMs],
      ["warm", baselineMode.metrics.warmBatchMs, warmBatchMs],
      ["session", baselineMode.metrics.sessionTotalMs, sessionTotalMs],
    ].filter((comparison) => typeof comparison[1] === "number");

    if (
      baselineMode.metrics.componentHmr.status === "updated" &&
      componentHmr.status === "updated"
    ) {
      comparisons.push([
        "hmr",
        baselineMode.metrics.componentHmr.totalCycleMs,
        componentHmr.totalCycleMs,
      ]);
    }

    const comparisonText = comparisons
      .map(([label, previousValue, currentValue]) => {
        const percentChange =
          previousValue === 0
            ? 0
            : ((currentValue - previousValue) / previousValue) * 100;
        const sign = percentChange > 0 ? "+" : "";

        return `${label} ${sign}${percentChange.toFixed(1)}%`;
      })
      .join("  ");

    const hmrStatusChanged =
      baselineMode.metrics.componentHmr.status !== componentHmr.status;
    const hmrStatusText = hmrStatusChanged
      ? `  hmr status ${baselineMode.metrics.componentHmr.status} -> ${componentHmr.status}`
      : "";

    console.log(`  vs baseline: ${comparisonText}${hmrStatusText}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!existsSync(distEntry)) {
    throw new Error(
      `Missing build output at ${distEntry}. Run "yarn exec unbuild packages/vite-plugin-react-docgen-typescript" first.`,
    );
  }

  const { default: reactDocgenTypescript } = await import(
    pathToFileURL(distEntry).href
  );
  if (options.internalSeed || options.internalValidate) {
    const { workspace, mode } = JSON.parse(
      readFileSync(options.internalSeed ?? options.internalValidate, "utf8"),
    );
    const fixtureValidation = validateReactFixture(workspace);
    await warmMode(
      reactDocgenTypescript,
      mode,
      workspace,
      options.internalSeed ? "populate" : "off",
    );
    console.log(JSON.stringify({ processId: process.pid, fixtureValidation }));
    return;
  }
  const baseline = options.baseline
    ? JSON.parse(readFileSync(path.resolve(options.baseline), "utf-8"))
    : null;
  if (baseline) validateBaseline(baseline, options);
  const identity = await collectIdentity();
  const workspace = createWorkspace(options.scenario, options.scale);

  try {
    const results = [];
    let measuredInstanceCount = 0;

    for (const mode of options.modes) {
      const runs = [];

      for (let iteration = 0; iteration < options.iterations; iteration += 1) {
        const cacheLifecycle = await prepareIteration(
          workspace,
          mode,
          options.cache,
        );
        const run = await measureModeIteration(
          reactDocgenTypescript,
          mode,
          workspace,
          {
            cache: options.cache,
            processFirstMeasuredInstance: measuredInstanceCount === 0,
          },
        );
        cacheLifecycle.finalEntryCount = countCacheEntries(
          workspace.cacheDirectory,
        );
        if (options.cache !== "off" && cacheLifecycle.finalEntryCount === 0) {
          throw new Error(
            "Measured instance produced no persistent cache entries",
          );
        }
        runs.push({ ...run, cacheLifecycle });
        measuredInstanceCount += 1;
      }

      results.push({
        metrics: summarizeRuns(runs),
        mode,
        runs,
      });
    }

    const result = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      benchmarkKind: "direct-plugin",
      processId: process.pid,
      cache: options.cache,
      identity,
      parserOptions: {
        parser: parserReport(workspace.scenario),
        tsconfig: JSON.parse(readFileSync(workspace.tsconfigPath, "utf8")),
      },
      timingScope: {
        coldBatchMs:
          "configResolved plus first transform batch; only the first measured instance has a fresh process",
        warmBatchMs: "same-instance in-memory reuse",
        sessionTotalMs:
          "plugin configuration and construction through first batch, warm batch, HMR, and awaited close; excludes fixture copy/restore, cache clearing, and child-process seeding",
      },
      createdAt: new Date().toISOString(),
      iterations: options.iterations,
      modes: options.modes,
      nodeVersion: process.version,
      platform: process.platform,
      scenario: {
        sourceSha256: hashFiles(
          path.join(
            workspace.root,
            SCENARIOS[workspace.scenario].sourceRootRelativePath,
          ),
        ),
        fileCount: workspace.fileCount,
        label: workspace.label,
        name: workspace.scenario,
        scale: options.scale,
      },
      results,
    };

    printSummary(result, baseline);

    if (options.output) {
      const outputPath = path.resolve(options.output);

      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`Wrote benchmark output to ${outputPath}`);
    }
  } finally {
    if (!options.keepTemp) {
      workspace.cleanup();
    } else {
      console.log(`Kept benchmark workspace at ${workspace.temporaryRoot}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await main();
}
