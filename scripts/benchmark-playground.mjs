import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const DEFAULT_ITERATIONS = 5;
const DEFAULT_MODES = ["default", "watch", "projectService"];
const DEFAULT_SCENARIO = "playground";
const HMR_POLL_INTERVAL_MS = 25;
const HMR_TIMEOUT_MS = 10_000;
const SCENARIOS = {
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
};
const HELP_TEXT = `Usage: node ./scripts/benchmark-playground.mjs [options]

Options:
  --scenario <name>       Benchmark fixture to run. Default: ${DEFAULT_SCENARIO}
  --iterations <number>   Number of measured runs per mode. Default: ${DEFAULT_ITERATIONS}
  --modes <list>          Comma-separated modes: default,watch,projectService
  --scale <number>        Number of scenario expansions to benchmark. Default: 1
  --output <file>         Write JSON results to a file
  --baseline <file>       Compare results against a previous JSON output
  --keep-temp             Keep the temporary benchmark workspace
  --help                  Show this message

Scenarios:
  ${Object.keys(SCENARIOS).join(", ")}
`;

function parseArgs(argv) {
  const options = {
    baseline: null,
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
      invalidatedModuleCount: median(
        runs.map((run) => run.componentHmr.invalidatedModuleCount),
      ),
      status: hmrStatus,
      totalCycleMs: median(runs.map((run) => run.componentHmr.totalCycleMs)),
    },
    fileCount: runs[0].fileCount,
    firstBatchMs: median(runs.map((run) => run.firstBatchMs)),
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

  cpSync(scenario.fixtureRoot, workspaceRoot, {
    filter(source) {
      return path.basename(source) !== "node_modules";
    },
    recursive: true,
  });

  scenario.createScaleCopies(workspaceRoot, scale);
  const files = collectComponentFiles(sourceRoot);

  return {
    changedFile: path.join(workspaceRoot, scenario.changedFileRelativePath),
    cleanup() {
      rmSync(temporaryRoot, { force: true, recursive: true });
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
}

function createPluginContext() {
  return {
    warn() {},
  };
}

function createServer() {
  const invalidatedModules = new Set();

  return {
    invalidatedModules,
    server: {
      moduleGraph: {
        getModulesByFile(file) {
          return new Set([{ id: file, url: file }]);
        },
        invalidateModule(module) {
          invalidatedModules.add(module.id ?? module.url);
        },
      },
    },
  };
}

function createModeConfig(mode, workspace) {
  return {
    tsconfigPath: workspace.tsconfigPath,
    ...(mode === "watch" ? { EXPERIMENTAL_useWatchProgram: true } : {}),
    ...(mode === "projectService"
      ? { EXPERIMENTAL_useProjectService: true }
      : {}),
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

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function resolveComponentHmrStatus(plugin, mode, workspace) {
  if (mode !== "watch") {
    const outputs = await transformFiles(plugin, [workspace.changedFile]);

    return (
      extractDocgenDescription(outputs.get(workspace.changedFile)) ===
      workspace.updatedMarkerText
    );
  }

  const hmrDeadline = performance.now() + HMR_TIMEOUT_MS;

  while (performance.now() < hmrDeadline) {
    const outputs = await transformFiles(plugin, [workspace.changedFile]);
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

async function warmMode(reactDocgenTypescript, mode, workspace) {
  const plugin = reactDocgenTypescript(createModeConfig(mode, workspace));

  try {
    await withWorkingDirectory(workspace.root, async () => {
      await plugin.configResolved?.({ command: "serve", root: workspace.root });
      await transformFiles(plugin, workspace.files);
    });
  } finally {
    plugin.closeBundle?.();
  }
}

async function measureModeIteration(reactDocgenTypescript, mode, workspace) {
  const plugin = reactDocgenTypescript(createModeConfig(mode, workspace));
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

  try {
    return await withWorkingDirectory(workspace.root, async () => {
      await plugin.configResolved?.({ command: "serve", root: workspace.root });

      const firstBatchStart = performance.now();
      await transformFiles(plugin, workspace.files);
      const firstBatchMs = performance.now() - firstBatchStart;

      const warmBatchStart = performance.now();
      await transformFiles(plugin, workspace.files);
      const warmBatchMs = performance.now() - warmBatchStart;

      writeFileSync(workspace.changedFile, updatedChangedFile);

      const { invalidatedModules, server } = createServer();
      const componentHmrStart = performance.now();

      await plugin.handleHotUpdate?.({
        file: workspace.changedFile,
        modules: [{ file: workspace.changedFile, id: workspace.changedFile }],
        server,
      });

      const updated = await resolveComponentHmrStatus(plugin, mode, workspace);

      return {
        componentHmr: {
          invalidatedModuleCount: invalidatedModules.size,
          status: updated ? "updated" : "stale",
          totalCycleMs: performance.now() - componentHmrStart,
        },
        fileCount: workspace.fileCount,
        firstBatchMs,
        warmBatchMs,
      };
    });
  } finally {
    writeFileSync(workspace.changedFile, originalChangedFile);
    plugin.closeBundle?.();
  }
}

function printSummary(result, baseline) {
  console.log(
    `Scenario: ${result.scenario.label} (${result.scenario.fileCount} files), iterations: ${result.iterations}`,
  );

  for (const modeResult of result.results) {
    const { componentHmr, firstBatchMs, warmBatchMs } = modeResult.metrics;
    const hmrText =
      componentHmr.status === "updated"
        ? `${componentHmr.totalCycleMs.toFixed(1)}ms`
        : `${componentHmr.status} (${componentHmr.totalCycleMs.toFixed(1)}ms)`;

    console.log(
      `${modeResult.mode.padEnd(14)} first ${firstBatchMs.toFixed(1)}ms  warm ${warmBatchMs.toFixed(1)}ms  hmr ${hmrText}  invalidated ${componentHmr.invalidatedModuleCount.toFixed(0)}`,
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
      ["first", baselineMode.metrics.firstBatchMs, firstBatchMs],
      ["warm", baselineMode.metrics.warmBatchMs, warmBatchMs],
    ];

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
  const workspace = createWorkspace(options.scenario, options.scale);
  const baseline = options.baseline
    ? JSON.parse(readFileSync(path.resolve(options.baseline), "utf-8"))
    : null;

  try {
    const results = [];

    for (const mode of options.modes) {
      await warmMode(reactDocgenTypescript, mode, workspace);

      const runs = [];

      for (let iteration = 0; iteration < options.iterations; iteration += 1) {
        runs.push(
          await measureModeIteration(reactDocgenTypescript, mode, workspace),
        );
      }

      results.push({
        metrics: summarizeRuns(runs),
        mode,
      });
    }

    const result = {
      createdAt: new Date().toISOString(),
      iterations: options.iterations,
      modes: options.modes,
      nodeVersion: process.version,
      platform: process.platform,
      scenario: {
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

await main();
