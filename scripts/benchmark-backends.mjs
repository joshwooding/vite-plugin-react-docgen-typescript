import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.dirname(
  fileURLToPath(new URL("../package.json", import.meta.url)),
);
const DIST_ENTRY = path.join(
  REPOSITORY_ROOT,
  "packages",
  "vite-plugin-react-docgen-typescript",
  "dist",
  "index.mjs",
);
const DEFAULT_COMPONENT_COUNT = 188;
const DEFAULT_PROJECT_COUNT = 7;
const DEFAULT_EDIT_COUNT = 10;
const DEFAULT_ITERATIONS = 1;
const DEFAULT_MODES = ["default", "projectService"];
const SUPPORTED_MODES = new Set([...DEFAULT_MODES, "watch", "native"]);
const BENCHMARK_SCHEMA_VERSION = 5;
const CORE_PHASES = new Set([
  "backend-analyze",
  "backend-initialize",
  "backend-update",
]);
const PROFILE_MATRIX = [
  { componentCount: 1, projectCount: 1 },
  { componentCount: 10, projectCount: 1 },
  { componentCount: 50, projectCount: 1 },
  { componentCount: 50, projectCount: 7 },
  { componentCount: 188, projectCount: 7 },
];
const HELP_TEXT = `Usage: node ./scripts/benchmark-backends.mjs [options]

Options:
  --components <number>   Components in the generated fixture
  --projects <number>     Referenced projects in the generated fixture
  --iterations <number>   Fresh child-process runs per engine. Default: ${DEFAULT_ITERATIONS}
  --edits <number>        Shared-type edits per run. Default: ${DEFAULT_EDIT_COUNT}
  --modes <list>          default,watch,projectService,native
  --plugin-entry <file>   Plugin build to benchmark. Default: local dist/index.mjs
  --label <name>          Label for --plugin-entry. Default: working-tree
  --compare-plugin-entry <file>
                           Second plugin build to benchmark with the same modes
  --compare-label <name>  Label for the comparison build. Default: comparison
  --native-request-profile
                           Count physical and logical TS7 API requests
  --output <file>         Write machine-readable JSON results
  --profile-matrix        Run the fixed 1/1, 10/1, 50/1, 50/7, 188/7 scale profile
  --require-parity        Fail unless normalized backend outputs match
  --keep-temp             Keep the generated monorepo and child results
  --help                  Show this message
`;

const require = createRequire(import.meta.url);

function parseArguments(arguments_) {
  const options = {
    childMode: null,
    childOutput: null,
    compareLabel: "comparison",
    comparePluginEntry: null,
    componentCount: DEFAULT_COMPONENT_COUNT,
    edits: DEFAULT_EDIT_COUNT,
    iterations: DEFAULT_ITERATIONS,
    keepTemp: false,
    label: "working-tree",
    modes: [...DEFAULT_MODES],
    nativeRequestProfile: false,
    output: null,
    pluginEntry: DIST_ENTRY,
    profileMatrix: false,
    projectCount: DEFAULT_PROJECT_COUNT,
    requireParity: false,
    targetLabel: null,
    workspace: null,
  };

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    switch (argument) {
      case "--child-mode":
        options.childMode = arguments_[++index];
        break;
      case "--child-output":
        options.childOutput = arguments_[++index];
        break;
      case "--compare-label":
        options.compareLabel = arguments_[++index];
        break;
      case "--compare-plugin-entry":
        options.comparePluginEntry = arguments_[++index];
        break;
      case "--components":
        options.componentCount = Number(arguments_[++index]);
        break;
      case "--edits":
        options.edits = Number(arguments_[++index]);
        break;
      case "--iterations":
        options.iterations = Number(arguments_[++index]);
        break;
      case "--keep-temp":
        options.keepTemp = true;
        break;
      case "--label":
        options.label = arguments_[++index];
        break;
      case "--modes":
        options.modes = arguments_[++index]
          .split(",")
          .map((mode) => mode.trim())
          .filter(Boolean);
        break;
      case "--native-request-profile":
        options.nativeRequestProfile = true;
        break;
      case "--output":
        options.output = arguments_[++index];
        break;
      case "--plugin-entry":
        options.pluginEntry = arguments_[++index];
        break;
      case "--profile-matrix":
        options.profileMatrix = true;
        break;
      case "--projects":
        options.projectCount = Number(arguments_[++index]);
        break;
      case "--require-parity":
        options.requireParity = true;
        break;
      case "--target-label":
        options.targetLabel = arguments_[++index];
        break;
      case "--workspace":
        options.workspace = arguments_[++index];
        break;
      case "--help":
        console.log(HELP_TEXT);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${argument}`);
    }
  }

  for (const [name, value] of [
    ["--components", options.componentCount],
    ["--edits", options.edits],
    ["--iterations", options.iterations],
    ["--projects", options.projectCount],
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
  }
  if (options.projectCount > options.componentCount) {
    throw new Error("--projects cannot exceed --components");
  }
  if (options.modes.length === 0) {
    throw new Error("--modes must contain at least one mode");
  }
  const unknownModes = options.modes.filter(
    (mode) => !SUPPORTED_MODES.has(mode),
  );
  if (unknownModes.length > 0) {
    throw new Error(`Unsupported modes: ${unknownModes.join(", ")}`);
  }
  if (new Set(options.modes).size !== options.modes.length) {
    throw new Error("--modes contains duplicates");
  }
  options.pluginEntry = path.resolve(options.pluginEntry);
  if (options.comparePluginEntry) {
    options.comparePluginEntry = path.resolve(options.comparePluginEntry);
  }
  for (const [label, pluginEntry] of [
    [options.label, options.pluginEntry],
    [options.compareLabel, options.comparePluginEntry],
  ]) {
    if (pluginEntry && !existsSync(pluginEntry)) {
      throw new Error(
        `Plugin entry for ${label} does not exist: ${pluginEntry}`,
      );
    }
  }
  if (options.comparePluginEntry && options.compareLabel === options.label) {
    throw new Error("--label and --compare-label must be different");
  }
  return options;
}

const pad = (value, length = 3) => String(value).padStart(length, "0");

const createSharedSource = (revision) => `export type SharedTone =
  | "base"
  | "revision-${pad(revision)}";

export interface SharedProps {
  /** Shared tone revision ${pad(revision)}. */
  tone?: SharedTone;
}
`;

function writeSharedRevision(fileName, revision) {
  writeFileSync(fileName, createSharedSource(revision));
  const modifiedTime = Date.now() + (revision + 1) * 2_000;
  utimesSync(fileName, modifiedTime / 1_000, modifiedTime / 1_000);
}

function createBenchmarkWorkspace(componentCount, projectCount) {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "vite-rdt-backends-"));
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  const sharedDirectory = path.join(workspaceRoot, "shared");
  const sharedFile = path.join(sharedDirectory, "shared-types.ts");
  const typeRoots = path.join(REPOSITORY_ROOT, "node_modules", "@types");
  const entries = [];
  const references = [];
  mkdirSync(sharedDirectory, { recursive: true });
  writeSharedRevision(sharedFile, 0);

  let componentIndex = 0;
  for (let projectIndex = 0; projectIndex < projectCount; projectIndex += 1) {
    const projectName = `project-${pad(projectIndex, 2)}`;
    const projectRoot = path.join(workspaceRoot, "packages", projectName);
    const sourceRoot = path.join(projectRoot, "src");
    mkdirSync(sourceRoot, { recursive: true });
    references.push({ path: `./packages/${projectName}/tsconfig.json` });
    writeFileSync(
      path.join(projectRoot, "tsconfig.json"),
      `${JSON.stringify(
        {
          compilerOptions: {
            composite: true,
            esModuleInterop: true,
            jsx: "preserve",
            lib: ["ES2020", "DOM"],
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            skipLibCheck: true,
            strict: true,
            target: "ES2020",
            typeRoots: [typeRoots],
            types: ["react"],
          },
          include: ["src/**/*.ts", "src/**/*.tsx"],
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      path.join(sourceRoot, "project-types.ts"),
      `export interface ProjectProps {
  /** Project-local density. */
  density?: "compact" | "comfortable";
}
`,
    );

    const projectComponentCount =
      Math.floor(componentCount / projectCount) +
      (projectIndex < componentCount % projectCount ? 1 : 0);
    for (
      let projectComponentIndex = 0;
      projectComponentIndex < projectComponentCount;
      projectComponentIndex += 1
    ) {
      const componentName = `Component${pad(componentIndex)}`;
      const componentFile = path.join(sourceRoot, `${componentName}.tsx`);
      const storyFile = path.join(sourceRoot, `${componentName}.stories.tsx`);
      writeFileSync(
        componentFile,
        `import type { SharedProps } from "../../../shared/shared-types";
import type { ProjectProps } from "./project-types";

export interface ${componentName}Props extends SharedProps, ProjectProps {
  /** Visible label for ${componentName}. */
  label: string;
  /** Local visual variant. */
  variant?: "solid" | "outline";
}

/** Benchmark component ${componentIndex}. */
export const ${componentName} = (_props: ${componentName}Props) => null;
`,
      );
      writeFileSync(
        storyFile,
        `import { ${componentName} } from "./${componentName}";

export default { component: ${componentName} };
export const Primary = {};
`,
      );
      entries.push({
        componentFile: path.relative(workspaceRoot, componentFile),
        componentName,
        importId: `./${componentName}`,
        storyFile: path.relative(workspaceRoot, storyFile),
      });
      componentIndex += 1;
    }
  }

  writeFileSync(
    path.join(workspaceRoot, "tsconfig.json"),
    `${JSON.stringify({ files: [], references }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(workspaceRoot, "benchmark-manifest.json"),
    `${JSON.stringify(
      {
        componentCount,
        entries,
        projectCount,
        sharedFile: path.relative(workspaceRoot, sharedFile),
      },
      null,
      2,
    )}\n`,
  );

  return {
    cleanup() {
      rmSync(temporaryRoot, { force: true, recursive: true });
    },
    root: workspaceRoot,
    sharedFile,
    temporaryRoot,
  };
}

function readBenchmarkWorkspace(root) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "benchmark-manifest.json"), "utf8"),
  );
  return {
    ...manifest,
    entries: manifest.entries.map((entry) => ({
      ...entry,
      componentFile: path.join(root, entry.componentFile),
      storyFile: path.join(root, entry.storyFile),
    })),
    root,
    sharedFile: path.join(root, manifest.sharedFile),
    tsconfigPath: path.join(root, "tsconfig.json"),
  };
}

function normalizeType(type) {
  if (!type || typeof type !== "object") return null;
  const values = Array.isArray(type.value)
    ? type.value
        .map((value) =>
          value && typeof value === "object" && "value" in value
            ? String(value.value)
            : String(value),
        )
        .sort()
    : undefined;
  return {
    name: String(type.name ?? ""),
    ...(values ? { values } : {}),
  };
}

function normalizeComponent(component) {
  const props = Object.fromEntries(
    Object.entries(component?.props ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, prop]) => [
        name,
        {
          defaultValue:
            prop?.defaultValue && typeof prop.defaultValue === "object"
              ? prop.defaultValue.value
              : null,
          description: String(prop?.description ?? ""),
          required: Boolean(prop?.required),
          type: normalizeType(prop?.type),
        },
      ]),
  );
  return {
    description: String(component?.description ?? ""),
    displayName: String(component?.displayName ?? ""),
    props,
  };
}

function normalizeOutput(components) {
  return Object.fromEntries(
    components
      .map((component) => [
        component.displayName,
        normalizeComponent(component),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeFileIdentity(fileName) {
  const resolvedFileName = realpathSync.native(path.resolve(fileName));
  return process.platform === "win32"
    ? resolvedFileName.toLowerCase()
    : resolvedFileName;
}

function readNativeTiming(controls) {
  const timing = controls.getNativeTimingInfo?.();
  if (!timing?.enabled) return null;
  const { totals } = timing;
  return {
    bytesReceived: totals.bytesReceived,
    bytesSent: totals.bytesSent,
    nodesFetched: totals.nodesFetched,
    nodesMaterialized: totals.nodesMaterialized,
    requestCount: totals.requestCount,
    roundTripMs: totals.roundTripMs,
    serverTimeMs: totals.serverTimeMs,
    sourceFilesFetched: totals.sourceFilesFetched,
    transportOverheadMs: totals.transportOverheadMs,
  };
}

function readNativeRequestProfile(controls) {
  return controls.getNativeRequestProfile?.() ?? null;
}

function summarizePhaseEvents(events) {
  const durationMs = {};
  let failedEventCount = 0;
  for (const event of events) {
    if (event.status === "failed") failedEventCount += 1;
    durationMs[event.phase] = (durationMs[event.phase] ?? 0) + event.durationMs;
  }
  return {
    durationMs,
    eventCount: events.length,
    failedEventCount,
  };
}

function createPluginMeasurementCollector(controls, entries) {
  const expectedFiles = new Set(
    entries.map((entry) => normalizeFileIdentity(entry.componentFile)),
  );
  let analysisEvents = new Map();
  let duplicateFiles = new Set();
  let phaseEvents = [];

  controls.onAnalysis = (event) => {
    const fileName = normalizeFileIdentity(event.fileName);
    if (analysisEvents.has(fileName)) duplicateFiles.add(fileName);
    analysisEvents.set(fileName, event);
  };
  controls.onPhase = (event) => {
    phaseEvents.push(event);
  };

  return {
    finish(decodeMs) {
      const nativeRequestProfile = readNativeRequestProfile(controls);
      const nativeTiming = readNativeTiming(controls);
      controls.resetNativeRequestProfile?.();
      controls.resetNativeTimingInfo?.();
      const instrumented =
        analysisEvents.size > 0 ||
        duplicateFiles.size > 0 ||
        phaseEvents.length > 0;
      if (!instrumented) {
        return {
          measurement: {
            adapter: {
              codeGenerationMs: null,
              decodeMs,
              totalMs: null,
            },
            core: {
              phaseMs: {},
              totalMs: null,
            },
            instrumented: false,
            nativeRequestProfile,
            nativeTiming,
            phaseEventCount: 0,
          },
          structuredOutput: null,
        };
      }
      if (duplicateFiles.size > 0) {
        throw new Error(
          "Duplicate structured analysis results: " +
            [...duplicateFiles].sort().join(", "),
        );
      }
      const missingFiles = [...expectedFiles].filter(
        (fileName) => !analysisEvents.has(fileName),
      );
      const unexpectedFiles = [...analysisEvents.keys()].filter(
        (fileName) => !expectedFiles.has(fileName),
      );
      if (missingFiles.length > 0 || unexpectedFiles.length > 0) {
        throw new Error(
          "Structured analysis file mismatch: missing " +
            missingFiles.length +
            ", unexpected " +
            unexpectedFiles.length,
        );
      }
      const components = [];
      for (const fileName of [...expectedFiles].sort()) {
        const event = analysisEvents.get(fileName);
        if (event.result.status !== "ok") {
          throw new Error(
            "Structured analysis failed for " +
              fileName +
              ": " +
              event.result.error.message,
          );
        }
        components.push(...event.result.components);
      }
      const phases = summarizePhaseEvents(phaseEvents);
      if (phases.failedEventCount > 0) {
        throw new Error("A benchmarked plugin phase failed");
      }
      const coreMs = phaseEvents
        .filter(
          (event) =>
            event.status === "completed" && CORE_PHASES.has(event.phase),
        )
        .reduce((total, event) => total + event.durationMs, 0);
      const codeGenerationMs = phaseEvents
        .filter(
          (event) =>
            event.status === "completed" && event.phase === "code-generation",
        )
        .reduce((total, event) => total + event.durationMs, 0);
      return {
        measurement: {
          adapter: {
            codeGenerationMs,
            decodeMs,
            totalMs: codeGenerationMs + decodeMs,
          },
          core: {
            phaseMs: phases.durationMs,
            totalMs: coreMs,
          },
          instrumented: true,
          nativeRequestProfile,
          nativeTiming,
          phaseEventCount: phases.eventCount,
        },
        structuredOutput: normalizeOutput(components),
      };
    },
    reset() {
      analysisEvents = new Map();
      duplicateFiles = new Set();
      phaseEvents = [];
      controls.resetNativeRequestProfile?.();
      controls.resetNativeTimingInfo?.();
    },
  };
}

function extractDocgenComponent(result, fileName) {
  const code =
    typeof result === "string"
      ? result
      : result && "code" in result
        ? result.code
        : "";
  const match = code.match(/__docgenInfo\s*=\s*(\{[\s\S]*?\});/);
  if (!match?.[1]) {
    throw new Error(`No __docgenInfo assignment was generated for ${fileName}`);
  }
  return JSON.parse(match[1]);
}

function createPluginContext() {
  return {
    warn(message) {
      const warning = String(message);
      if (
        warning.includes("EXPERIMENTAL_useWatchProgram is deprecated") ||
        warning.includes("EXPERIMENTAL_useProjectService is deprecated")
      ) {
        return;
      }
      throw new Error(`Plugin warning: ${warning}`);
    },
  };
}

function createModuleGraph() {
  const invalidatedFiles = new Set();
  const modules = new Map();
  const getModule = (file) => {
    const fileIdentity = normalizeFileIdentity(file);
    let module = modules.get(fileIdentity);
    if (!module) {
      module = { file: fileIdentity, id: fileIdentity, url: fileIdentity };
      modules.set(fileIdentity, module);
    }
    return module;
  };
  return {
    consumeInvalidatedFiles() {
      const files = new Set(invalidatedFiles);
      invalidatedFiles.clear();
      return files;
    },
    getModule,
    moduleGraph: {
      getModulesByFile(file) {
        return new Set([getModule(file)]);
      },
      invalidateModule(module) {
        if (module.file) invalidatedFiles.add(module.file);
      },
    },
  };
}

function getPluginHookHandler(hook, name) {
  const handler = typeof hook === "function" ? hook : hook?.handler;
  if (typeof handler !== "function") {
    throw new Error(`Expected plugin hook ${name}`);
  }
  return handler;
}

async function transformPluginFiles(plugin, context, entries) {
  const components = [];
  let decodeMs = 0;
  const transform = getPluginHookHandler(plugin.transform, "transform");
  for (const entry of entries) {
    const source = readFileSync(entry.componentFile, "utf8");
    const result = await transform.call(context, source, entry.componentFile);
    const decodeStartedAt = performance.now();
    components.push(extractDocgenComponent(result, entry.componentFile));
    decodeMs += performance.now() - decodeStartedAt;
  }
  return { decodeMs, output: normalizeOutput(components) };
}

async function loadPluginRunner(
  mode,
  workspace,
  nativeRequestProfile,
  pluginEntry,
  targetLabel,
) {
  const { default: reactDocgenTypescript } = await import(
    pathToFileURL(pluginEntry).href
  );
  const pluginRequire = createRequire(pathToFileURL(pluginEntry));
  const packageName =
    mode === "native"
      ? (process.env.VITE_RDT_NATIVE_TYPESCRIPT_PACKAGE ?? "typescript")
      : "typescript";
  const typescriptVersion = pluginRequire(
    `${packageName}/package.json`,
  ).version;
  return {
    async create() {
      const context = createPluginContext();
      const graph = createModuleGraph();
      const entriesByFile = new Map(
        workspace.entries.map((entry) => [
          normalizeFileIdentity(entry.componentFile),
          entry,
        ]),
      );
      const controls = {
        collectNativeRequestProfile: mode === "native" && nativeRequestProfile,
        collectNativeTiming: mode === "native",
      };
      const collector = createPluginMeasurementCollector(
        controls,
        workspace.entries,
      );
      const plugin = reactDocgenTypescript({
        __benchmark: controls,
        ...(mode === "native" ? { docgenMode: "native" } : {}),
        ...(mode === "watch" ? { EXPERIMENTAL_useWatchProgram: true } : {}),
        ...(mode === "projectService"
          ? { EXPERIMENTAL_useProjectService: true }
          : {}),
        exclude: ["**/*.stories.tsx"],
        include: ["packages/**/*.tsx"],
        shouldExtractValuesFromUnion: true,
        shouldRemoveUndefinedFromOptional: true,
        tsconfigPath: workspace.tsconfigPath,
      });
      await plugin.configResolved.call(context, {
        command: "serve",
        root: workspace.root,
      });
      let output;
      const extract = async (entries, resetCollector = true) => {
        if (resetCollector) collector.reset();
        const transformed = await transformPluginFiles(
          plugin,
          context,
          entries,
        );
        const collected = collector.finish(transformed.decodeMs);
        if (
          collected.structuredOutput &&
          JSON.stringify(collected.structuredOutput) !==
            JSON.stringify(transformed.output)
        ) {
          throw new Error(
            `${mode} structured analysis did not match generated docgen output`,
          );
        }
        output = transformed.output;
        return {
          measurement: collected.measurement,
          output,
        };
      };
      return {
        async cold() {
          return extract(workspace.entries);
        },
        async dispose() {
          await plugin.closeBundle?.();
        },
        async edit(revision) {
          collector.reset();
          writeSharedRevision(workspace.sharedFile, revision);
          const timestamp = Date.now() + revision * 2_000;
          const returnedModules =
            (await plugin.handleHotUpdate.call(context, {
              file: workspace.sharedFile,
              modules: [graph.getModule(workspace.sharedFile)],
              read: async () => readFileSync(workspace.sharedFile, "utf8"),
              server: { moduleGraph: graph.moduleGraph },
              timestamp,
            })) ?? [];
          const affectedFiles = new Set([
            ...graph.consumeInvalidatedFiles(),
            ...returnedModules.map((module) => module.file).filter(Boolean),
          ]);
          const affectedEntries = [...affectedFiles]
            .map((fileName) => entriesByFile.get(fileName))
            .filter(Boolean);
          if (affectedEntries.length !== workspace.componentCount) {
            throw new Error(
              `${mode} invalidated ${affectedEntries.length}/${workspace.componentCount} components after a shared-type edit`,
            );
          }
          return extract(affectedEntries, false);
        },
      };
    },
    metadata: {
      engine: mode,
      pluginEntry,
      targetLabel,
      typescriptVersion,
    },
  };
}

const expectedSharedDescription = (revision) =>
  `Shared tone revision ${pad(revision)}.`;

function outputHasRevision(output, revision, componentCount) {
  const components = Object.values(output);
  return (
    components.length === componentCount &&
    components.every(
      (component) =>
        component.props.tone?.description ===
        expectedSharedDescription(revision),
    )
  );
}

function startWindowsMemorySampler(processIdFile) {
  const samplerRoot = mkdtempSync(
    path.join(tmpdir(), "vite-rdt-memory-sampler-"),
  );
  const stopFile = path.join(samplerRoot, "stop");
  const command = `$ErrorActionPreference = "Stop"
$processIds = @([int]$PID)
$peak = [Int64]0
$ready = $false
do {
  $candidateIds = @(Get-Content -LiteralPath $env:VITE_RDT_BENCHMARK_PID_FILE -Raw -ErrorAction SilentlyContinue).Split(",") | ForEach-Object { if ($_ -match "^\\d+$") { [int]$_ } }
  if ($candidateIds.Count -gt 0) { $processIds = $candidateIds }
  $sum = (Get-Process -Id $processIds -ErrorAction SilentlyContinue | Measure-Object -Property WorkingSet64 -Sum).Sum
  if ($null -eq $sum) { $sum = 0 }
  if ($sum -gt $peak) { $peak = [Int64]$sum }
  if (-not $ready) {
    [Console]::Out.WriteLine("ready")
    [Console]::Out.Flush()
    $ready = $true
  }
  Start-Sleep -Milliseconds 5
} while (-not (Test-Path -LiteralPath $env:VITE_RDT_BENCHMARK_STOP_FILE))
[Console]::Out.WriteLine("peak:$peak")
[Console]::Out.Flush()`;
  const child = spawn(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      env: {
        ...process.env,
        VITE_RDT_BENCHMARK_PID_FILE: processIdFile,
        VITE_RDT_BENCHMARK_STOP_FILE: stopFile,
      },
      stdio: ["ignore", "pipe", "inherit"],
      windowsHide: true,
    },
  );
  child.stdout.setEncoding("utf8");
  let output = "";
  let ready = false;
  const readyPromise = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (!ready && output.includes("ready")) {
        ready = true;
        resolve();
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (!ready) {
        reject(new Error(`Windows RSS sampler exited before ready (${code})`));
      }
    });
  });
  return readyPromise.then(() => ({
    async close() {
      writeFileSync(stopFile, "stop\n");
      const exitCode = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", resolve);
      });
      rmSync(samplerRoot, { force: true, recursive: true });
      if (exitCode !== 0) {
        throw new Error(`Windows RSS sampler exited ${exitCode}`);
      }
      const match = output.match(/peak:(\d+)/);
      if (!match) throw new Error("Windows RSS sampler returned no peak");
      return Number(match[1]);
    },
  }));
}

async function startMemorySampler(processIdFile) {
  if (process.platform === "win32") {
    return startWindowsMemorySampler(processIdFile);
  }
  const peakRssBuffer = new SharedArrayBuffer(BigInt64Array.BYTES_PER_ELEMENT);
  const peakRss = new BigInt64Array(peakRssBuffer);
  const worker = new Worker(
    new URL("./benchmark-memory-sampler.mjs", import.meta.url),
    { workerData: { peakRssBuffer, processIdFile } },
  );
  await new Promise((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  return {
    async close() {
      worker.postMessage("stop");
      await new Promise((resolve) => worker.once("message", resolve));
      await worker.terminate();
      return Number(Atomics.load(peakRss, 0));
    },
  };
}

async function sampleAggregateRss(processIds) {
  if (process.platform === "linux") {
    return processIds.reduce((total, processId) => {
      if (processId === process.pid) return total + process.memoryUsage.rss();
      try {
        const residentPages = Number(
          readFileSync(`/proc/${processId}/statm`, "utf8").split(" ")[1],
        );
        return total + residentPages * 4096;
      } catch {
        return total;
      }
    }, 0);
  }
  if (process.platform === "win32") {
    const samplerRoot = mkdtempSync(
      path.join(tmpdir(), "vite-rdt-memory-snapshot-"),
    );
    const processIdFile = path.join(samplerRoot, "pids");
    writeFileSync(processIdFile, processIds.join(","));
    const sampler = await startWindowsMemorySampler(processIdFile);
    const rssBytes = await sampler.close();
    rmSync(samplerRoot, { force: true, recursive: true });
    return rssBytes;
  }
  return process.memoryUsage.rss();
}

async function collectSettledMemory(processIds) {
  globalThis.gc?.();
  await new Promise((resolve) => setImmediate(resolve));
  globalThis.gc?.();
  const memory = process.memoryUsage();
  const aggregateRssBytes = await sampleAggregateRss(processIds);
  const benchmarkRssBytes = memory.rss;
  const hasEngineChildren = processIds.length > 1;
  return {
    arrayBuffersBytes: memory.arrayBuffers,
    benchmarkRssBytes,
    engineChildrenRssBytes: hasEngineChildren
      ? Math.max(0, aggregateRssBytes - benchmarkRssBytes)
      : 0,
    externalBytes: memory.external,
    heapUsedBytes: memory.heapUsed,
    rssBytes: hasEngineChildren
      ? Math.max(aggregateRssBytes, benchmarkRssBytes)
      : benchmarkRssBytes,
  };
}

function createProcessRegistry() {
  const registryRoot = mkdtempSync(
    path.join(tmpdir(), "vite-rdt-process-registry-"),
  );
  const fileName = path.join(registryRoot, "pids");
  const processIds = new Set([process.pid]);
  const persist = () => writeFileSync(fileName, [...processIds].join(","));
  persist();
  return {
    add(processId) {
      processIds.add(processId);
      persist();
    },
    cleanup() {
      rmSync(registryRoot, { force: true, recursive: true });
    },
    fileName,
    values: () => [...processIds],
  };
}

function startSpawnCapture(processRegistry) {
  const childProcess = require("node:child_process");
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = function benchmarkSpawn(...arguments_) {
    const child = Reflect.apply(originalSpawn, this, arguments_);
    if (child.pid) processRegistry.add(child.pid);
    child.once("spawn", () => {
      if (child.pid) processRegistry.add(child.pid);
    });
    return child;
  };
  syncBuiltinESMExports();
  return {
    restore() {
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
    },
  };
}

const digestOutput = (output) =>
  createHash("sha256").update(JSON.stringify(output)).digest("hex");

async function runChild(options) {
  if (
    !options.childOutput ||
    !options.workspace ||
    !options.childMode ||
    !options.pluginEntry ||
    !options.targetLabel
  ) {
    throw new Error(
      "Child mode requires --child-mode, --child-output, --plugin-entry, --target-label, and --workspace",
    );
  }
  if (!globalThis.gc) {
    throw new Error("Child benchmarks must run with --expose-gc");
  }
  const workspace = readBenchmarkWorkspace(options.workspace);
  const processRegistry = createProcessRegistry();
  const activeSamplers = new Set();
  const createSampler = async () => {
    const sampler = await startMemorySampler(processRegistry.fileName);
    activeSamplers.add(sampler);
    return sampler;
  };
  const closeSampler = async (sampler) => {
    activeSamplers.delete(sampler);
    return sampler.close();
  };
  const parentProcessIds = [process.pid];
  let runner;
  try {
    const baselineMemory = await collectSettledMemory(parentProcessIds);
    const coldSampler = await createSampler();
    const capture = startSpawnCapture(processRegistry);
    const moduleLoadStart = performance.now();
    let loaded;
    let moduleLoadMs;
    let setupMs;
    let output;
    let coldExtractionMs;
    let coldMeasurement;
    try {
      loaded = await loadPluginRunner(
        options.childMode,
        workspace,
        options.nativeRequestProfile,
        options.pluginEntry,
        options.targetLabel,
      );
      moduleLoadMs = performance.now() - moduleLoadStart;
      const setupStart = performance.now();
      runner = await loaded.create();
      setupMs = performance.now() - setupStart;
      const coldExtractionStart = performance.now();
      const coldRun = await runner.cold();
      coldExtractionMs = performance.now() - coldExtractionStart;
      output = coldRun.output;
      coldMeasurement = {
        ...coldRun.measurement,
        integration: { totalMs: coldExtractionMs },
      };
    } finally {
      capture.restore();
    }
    const processIds = processRegistry.values();
    if (!outputHasRevision(output, 0, workspace.componentCount)) {
      throw new Error(
        `${options.childMode} cold extraction was incomplete or stale`,
      );
    }
    const sampledColdPeakRssBytes = await closeSampler(coldSampler);
    const coldRetainedMemory = await collectSettledMemory(processIds);
    const coldPeakRssBytes = Math.max(
      sampledColdPeakRssBytes,
      coldRetainedMemory.rssBytes,
    );

    const editSampler = await createSampler();
    const editMeasurements = [];
    const editSamplesMs = [];
    for (let revision = 1; revision <= options.edits; revision += 1) {
      const editStart = performance.now();
      const editRun = await runner.edit(revision);
      const integrationMs = performance.now() - editStart;
      output = editRun.output;
      editSamplesMs.push(integrationMs);
      editMeasurements.push({
        ...editRun.measurement,
        integration: { totalMs: integrationMs },
      });
      if (!outputHasRevision(output, revision, workspace.componentCount)) {
        throw new Error(
          `${options.childMode} produced stale output for revision ${revision}`,
        );
      }
    }
    const sampledEditPeakRssBytes = await closeSampler(editSampler);
    const editRetainedMemory = await collectSettledMemory(processIds);
    const editPeakRssBytes = Math.max(
      sampledEditPeakRssBytes,
      editRetainedMemory.rssBytes,
    );
    await runner.dispose();
    runner = undefined;
    const disposedMemory = await collectSettledMemory(parentProcessIds);
    const result = {
      cold: {
        extractionMs: coldExtractionMs,
        measurement: coldMeasurement,
        moduleLoadMs,
        setupMs,
        totalMs: moduleLoadMs + setupMs + coldExtractionMs,
      },
      editMeasurements,
      editSamplesMs,
      memory: {
        baseline: baselineMemory,
        cold: {
          peakRssBytes: coldPeakRssBytes,
          peakRssDeltaBytes: Math.max(
            0,
            coldPeakRssBytes - baselineMemory.rssBytes,
          ),
          retainedHeapBytes: coldRetainedMemory.heapUsedBytes,
          retainedHeapDeltaBytes: Math.max(
            0,
            coldRetainedMemory.heapUsedBytes - baselineMemory.heapUsedBytes,
          ),
          retainedBenchmarkRssBytes: coldRetainedMemory.benchmarkRssBytes,
          retainedEngineChildrenRssBytes:
            coldRetainedMemory.engineChildrenRssBytes,
          retainedRssBytes: coldRetainedMemory.rssBytes,
        },
        disposed: disposedMemory,
        edits: {
          peakRssBytes: editPeakRssBytes,
          peakRssDeltaBytes: Math.max(
            0,
            editPeakRssBytes - coldRetainedMemory.rssBytes,
          ),
          retainedHeapBytes: editRetainedMemory.heapUsedBytes,
          retainedHeapDeltaBytes:
            editRetainedMemory.heapUsedBytes - coldRetainedMemory.heapUsedBytes,
          retainedBenchmarkRssBytes: editRetainedMemory.benchmarkRssBytes,
          retainedEngineChildrenRssBytes:
            editRetainedMemory.engineChildrenRssBytes,
          retainedRssBytes: editRetainedMemory.rssBytes,
        },
        sampledProcessCount: processIds.length,
      },
      metadata: loaded.metadata,
      mode: options.childMode,
      output,
      outputDigest: digestOutput(output),
      targetLabel: options.targetLabel,
    };
    writeFileSync(options.childOutput, `${JSON.stringify(result)}\n`);
  } finally {
    await runner?.dispose();
    await Promise.all([...activeSamplers].map((sampler) => sampler.close()));
    processRegistry.cleanup();
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((percentileValue / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, index)];
}

function summarizeLane(runs, lane) {
  const editSamples = runs.flatMap((run) =>
    run.editMeasurements
      .map((measurement) => measurement[lane].totalMs)
      .filter((value) => typeof value === "number"),
  );
  const coldSamples = runs
    .map((run) => run.cold.measurement[lane].totalMs)
    .filter((value) => typeof value === "number");
  if (coldSamples.length === 0 && editSamples.length === 0) return null;
  return {
    coldMs: coldSamples.length > 0 ? median(coldSamples) : null,
    edits: {
      count: editSamples.length,
      maxMs: editSamples.length > 0 ? Math.max(...editSamples) : null,
      p50Ms: editSamples.length > 0 ? percentile(editSamples, 50) : null,
      p95Ms: editSamples.length > 0 ? percentile(editSamples, 95) : null,
      totalPerRunMs:
        editSamples.length > 0
          ? median(
              runs.map((run) =>
                run.editMeasurements.reduce((total, measurement) => {
                  const value = measurement[lane].totalMs;
                  return total + (typeof value === "number" ? value : 0);
                }, 0),
              ),
            )
          : null,
    },
  };
}

function summarizeNumericRecords(records) {
  const available = records.filter(Boolean);
  if (available.length === 0) return null;
  const keys = [
    ...new Set(available.flatMap((record) => Object.keys(record))),
  ].sort();
  return Object.fromEntries(
    keys.map((key) => [
      key,
      median(
        available
          .map((record) => record[key])
          .filter((value) => typeof value === "number"),
      ),
    ]),
  );
}

function summarizeNativeRequestProfiles(records) {
  const available = records.filter(Boolean);
  if (available.length === 0) return null;
  return {
    ...summarizeNumericRecords(
      available.map(
        ({ logicalMethods: _logical, physicalMethods: _physical, ...totals }) =>
          totals,
      ),
    ),
    logicalMethods: summarizeNumericRecords(
      available.map((profile) => profile.logicalMethods),
    ),
    physicalMethods: summarizeNumericRecords(
      available.map((profile) => profile.physicalMethods),
    ),
  };
}

function summarizeRuns(runs) {
  const editSamples = runs.flatMap((run) => run.editSamplesMs);
  const nativeCold = summarizeNumericRecords(
    runs.map((run) => run.cold.measurement.nativeTiming),
  );
  const nativeEdits = summarizeNumericRecords(
    runs.flatMap((run) =>
      run.editMeasurements.map((measurement) => measurement.nativeTiming),
    ),
  );
  const nativeRequestCold = summarizeNativeRequestProfiles(
    runs.map((run) => run.cold.measurement.nativeRequestProfile),
  );
  const nativeRequestEdits = summarizeNativeRequestProfiles(
    runs.flatMap((run) =>
      run.editMeasurements.map(
        (measurement) => measurement.nativeRequestProfile,
      ),
    ),
  );
  return {
    adapter: summarizeLane(runs, "adapter"),
    cold: {
      extractionMs: median(runs.map((run) => run.cold.extractionMs)),
      moduleLoadMs: median(runs.map((run) => run.cold.moduleLoadMs)),
      setupMs: median(runs.map((run) => run.cold.setupMs)),
      totalMs: median(runs.map((run) => run.cold.totalMs)),
    },
    edits: {
      count: editSamples.length,
      editsPerRun: runs[0].editSamplesMs.length,
      maxMs: Math.max(...editSamples),
      p50Ms: percentile(editSamples, 50),
      p95Ms: percentile(editSamples, 95),
      totalPerRunMs: median(
        runs.map((run) =>
          run.editSamplesMs.reduce((sum, value) => sum + value, 0),
        ),
      ),
    },
    core: summarizeLane(runs, "core"),
    integration: summarizeLane(runs, "integration"),
    memory: {
      coldPeakRssBytes: median(runs.map((run) => run.memory.cold.peakRssBytes)),
      coldPeakRssDeltaBytes: median(
        runs.map((run) => run.memory.cold.peakRssDeltaBytes),
      ),
      coldRetainedHeapBytes: median(
        runs.map((run) => run.memory.cold.retainedHeapBytes),
      ),
      coldRetainedBenchmarkRssBytes: median(
        runs.map((run) => run.memory.cold.retainedBenchmarkRssBytes),
      ),
      coldRetainedEngineChildrenRssBytes: median(
        runs.map((run) => run.memory.cold.retainedEngineChildrenRssBytes),
      ),
      coldRetainedRssBytes: median(
        runs.map((run) => run.memory.cold.retainedRssBytes),
      ),
      editPeakRssBytes: median(
        runs.map((run) => run.memory.edits.peakRssBytes),
      ),
      editPeakRssDeltaBytes: median(
        runs.map((run) => run.memory.edits.peakRssDeltaBytes),
      ),
      editRetainedHeapDeltaBytes: median(
        runs.map((run) => run.memory.edits.retainedHeapDeltaBytes),
      ),
      editRetainedBenchmarkRssBytes: median(
        runs.map((run) => run.memory.edits.retainedBenchmarkRssBytes),
      ),
      editRetainedEngineChildrenRssBytes: median(
        runs.map((run) => run.memory.edits.retainedEngineChildrenRssBytes),
      ),
      editRetainedRssBytes: median(
        runs.map((run) => run.memory.edits.retainedRssBytes),
      ),
      sampledProcessCount: Math.max(
        ...runs.map((run) => run.memory.sampledProcessCount),
      ),
    },
    nativeTiming:
      nativeCold || nativeEdits
        ? {
            cold: nativeCold,
            editP50: nativeEdits,
          }
        : null,
    nativeRequestProfile:
      nativeRequestCold || nativeRequestEdits
        ? {
            cold: nativeRequestCold,
            editP50: nativeRequestEdits,
          }
        : null,
    phases: {
      coldMs: summarizeNumericRecords(
        runs.map((run) => run.cold.measurement.core.phaseMs),
      ),
      editP50Ms: summarizeNumericRecords(
        runs.flatMap((run) =>
          run.editMeasurements.map((measurement) => measurement.core.phaseMs),
        ),
      ),
    },
  };
}

function flatten(value, prefix = "", output = new Map()) {
  if (value === null || typeof value !== "object") {
    output.set(prefix, JSON.stringify(value));
    return output;
  }
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
  if (entries.length === 0) output.set(prefix, JSON.stringify(value));
  for (const [key, item] of entries) {
    flatten(item, prefix ? `${prefix}.${key}` : key, output);
  }
  return output;
}

function compareOutputs(leftMode, left, rightMode, right) {
  const componentNames = [
    ...new Set([...Object.keys(left), ...Object.keys(right)]),
  ].sort();
  let matchingComponents = 0;
  let matchingFields = 0;
  let totalFields = 0;
  const mismatches = [];
  for (const componentName of componentNames) {
    const leftComponent = left[componentName];
    const rightComponent = right[componentName];
    if (JSON.stringify(leftComponent) === JSON.stringify(rightComponent)) {
      matchingComponents += 1;
    }
    const leftFields = flatten(leftComponent);
    const rightFields = flatten(rightComponent);
    const fieldNames = [
      ...new Set([...leftFields.keys(), ...rightFields.keys()]),
    ].sort();
    const differingFields = fieldNames.filter((fieldName) => {
      const matches = leftFields.get(fieldName) === rightFields.get(fieldName);
      if (matches) matchingFields += 1;
      return !matches;
    });
    totalFields += fieldNames.length;
    if (differingFields.length > 0 && mismatches.length < 10) {
      mismatches.push({ componentName, differingFields });
    }
  }
  return {
    componentCount: componentNames.length,
    exactComponentMatches: matchingComponents,
    fieldAgreement:
      totalFields === 0 ? 1 : Number((matchingFields / totalFields).toFixed(6)),
    leftMode,
    mismatchExamples: mismatches,
    rightMode,
    totalFields,
  };
}

function runChildProcess({
  edits,
  mode,
  nativeRequestProfile,
  output,
  pluginEntry,
  targetLabel,
  workspace,
}) {
  const environment = { ...process.env };
  if (mode === "native" && !environment.VITE_RDT_NATIVE_TYPESCRIPT_PACKAGE) {
    environment.VITE_RDT_NATIVE_TYPESCRIPT_PACKAGE = "typescript7next";
  }
  const arguments_ = [
    "--expose-gc",
    SCRIPT_PATH,
    "--child-mode",
    mode,
    "--child-output",
    output,
    "--plugin-entry",
    pluginEntry,
    "--target-label",
    targetLabel,
    "--workspace",
    workspace,
    "--edits",
    String(edits),
  ];
  if (nativeRequestProfile) arguments_.push("--native-request-profile");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, arguments_, {
      cwd: REPOSITORY_ROOT,
      env: environment,
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${mode} child exited ${String(code)}${signal ? ` (${signal})` : ""}`,
          ),
        );
      }
    });
  });
}

const toMiB = (bytes) => bytes / (1024 * 1024);

function createMetricDelta(baseline, candidate) {
  const absolute = candidate - baseline;
  return {
    absolute,
    baseline,
    candidate,
    percent:
      baseline === 0
        ? candidate === 0
          ? 0
          : null
        : (absolute / baseline) * 100,
  };
}

function compareTargetMetrics(results, targets, modes) {
  if (targets.length !== 2) return [];
  const [baselineTarget, candidateTarget] = targets;
  return modes.map((mode) => {
    const baseline = results.find(
      (result) =>
        result.targetLabel === baselineTarget.label && result.mode === mode,
    );
    const candidate = results.find(
      (result) =>
        result.targetLabel === candidateTarget.label && result.mode === mode,
    );
    return {
      baselineLabel: baselineTarget.label,
      candidateLabel: candidateTarget.label,
      metrics: {
        coldRetainedRssBytes: createMetricDelta(
          baseline.metrics.memory.coldRetainedRssBytes,
          candidate.metrics.memory.coldRetainedRssBytes,
        ),
        coldTotalMs: createMetricDelta(
          baseline.metrics.cold.totalMs,
          candidate.metrics.cold.totalMs,
        ),
        editP50Ms: createMetricDelta(
          baseline.metrics.edits.p50Ms,
          candidate.metrics.edits.p50Ms,
        ),
        editP95Ms: createMetricDelta(
          baseline.metrics.edits.p95Ms,
          candidate.metrics.edits.p95Ms,
        ),
        editRetainedRssBytes: createMetricDelta(
          baseline.metrics.memory.editRetainedRssBytes,
          candidate.metrics.memory.editRetainedRssBytes,
        ),
      },
      mode,
    };
  });
}

function printSummary(result) {
  console.log(
    `Backend benchmark: ${result.fixture.componentCount} components across ${result.fixture.projectCount} projects; ${result.edits} edits x ${result.iterations} runs`,
  );
  for (const backend of result.results) {
    const { adapter, cold, core, edits, memory } = backend.metrics;
    const laneLabel = `${backend.targetLabel}/${backend.mode}`;
    console.log(
      `${laneLabel.padEnd(28)} cold ${cold.totalMs.toFixed(1)}ms (extract ${cold.extractionMs.toFixed(1)}ms)  edits p50 ${edits.p50Ms.toFixed(1)}ms p95 ${edits.p95Ms.toFixed(1)}ms  cold peak +${toMiB(memory.coldPeakRssDeltaBytes).toFixed(0)}MiB  edit peak +${toMiB(memory.editPeakRssDeltaBytes).toFixed(0)}MiB`,
    );
    if (core && adapter) {
      console.log(
        " ".repeat(29) +
          "core cold " +
          core.coldMs.toFixed(1) +
          "ms/edit p50 " +
          core.edits.p50Ms.toFixed(1) +
          "ms; adapter cold " +
          adapter.coldMs.toFixed(1) +
          "ms/edit p50 " +
          adapter.edits.p50Ms.toFixed(1) +
          "ms",
      );
    } else {
      console.log(
        " ".repeat(29) +
          "internal phase timing unavailable for this plugin build",
      );
    }
    console.log(
      " ".repeat(29) +
        "retained RSS cold " +
        toMiB(memory.coldRetainedRssBytes).toFixed(0) +
        "MiB (benchmark " +
        toMiB(memory.coldRetainedBenchmarkRssBytes).toFixed(0) +
        "MiB + engine children " +
        toMiB(memory.coldRetainedEngineChildrenRssBytes).toFixed(0) +
        "MiB); edit " +
        toMiB(memory.editRetainedRssBytes).toFixed(0) +
        "MiB (benchmark " +
        toMiB(memory.editRetainedBenchmarkRssBytes).toFixed(0) +
        "MiB + engine children " +
        toMiB(memory.editRetainedEngineChildrenRssBytes).toFixed(0) +
        "MiB)",
    );
    const requestProfile = backend.metrics.nativeRequestProfile?.editP50;
    if (requestProfile) {
      const topLogicalMethods = Object.entries(requestProfile.logicalMethods)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([method, count]) => `${method}=${count}`)
        .join(", ");
      console.log(
        " ".repeat(29) +
          `native requests/edit physical ${requestProfile.physicalRequestCount}, logical ${requestProfile.logicalRequestCount}, batches ${requestProfile.batchRequestCount}, max batch ${requestProfile.maxBatchSize}; top logical ${topLogicalMethods}`,
      );
    }
  }
  for (const parity of result.parity) {
    console.log(
      `${parity.leftMode} vs ${parity.rightMode}: ${parity.exactComponentMatches}/${parity.componentCount} exact components, ${(parity.fieldAgreement * 100).toFixed(2)}% field agreement`,
    );
  }
  for (const comparison of result.targetComparisons) {
    const formatPercent = (metric) =>
      metric.percent === null
        ? "n/a"
        : `${metric.percent > 0 ? "+" : ""}${metric.percent.toFixed(1)}%`;
    console.log(
      `${comparison.candidateLabel} vs ${comparison.baselineLabel} (${comparison.mode}): cold ${formatPercent(comparison.metrics.coldTotalMs)}, edits p50 ${formatPercent(comparison.metrics.editP50Ms)}, edits p95 ${formatPercent(comparison.metrics.editP95Ms)}, retained RSS ${formatPercent(comparison.metrics.editRetainedRssBytes)}`,
    );
  }
}

async function runSingleBenchmark(options) {
  const workspace = createBenchmarkWorkspace(
    options.componentCount,
    options.projectCount,
  );
  const targets = [
    { label: options.label, pluginEntry: options.pluginEntry },
    ...(options.comparePluginEntry
      ? [
          {
            label: options.compareLabel,
            pluginEntry: options.comparePluginEntry,
          },
        ]
      : []),
  ];
  const lanes = targets.flatMap((target) =>
    options.modes.map((mode) => ({
      ...target,
      key: `${target.label}:${mode}`,
      mode,
    })),
  );
  const runsByLane = new Map(lanes.map((lane) => [lane.key, []]));
  const executionOrder = [];
  try {
    for (let iteration = 0; iteration < options.iterations; iteration += 1) {
      const offset = iteration % lanes.length;
      const iterationLanes = [
        ...lanes.slice(offset),
        ...lanes.slice(0, offset),
      ];
      executionOrder.push(iterationLanes.map((lane) => lane.key));
      for (const [order, lane] of iterationLanes.entries()) {
        writeSharedRevision(workspace.sharedFile, 0);
        const childOutput = path.join(
          workspace.temporaryRoot,
          `run-${iteration}-${order}.json`,
        );
        console.log(
          `Running ${lane.key} (${iteration + 1}/${options.iterations}, order ${order + 1}/${iterationLanes.length})...`,
        );
        await runChildProcess({
          edits: options.edits,
          mode: lane.mode,
          nativeRequestProfile: options.nativeRequestProfile,
          output: childOutput,
          pluginEntry: lane.pluginEntry,
          targetLabel: lane.label,
          workspace: workspace.root,
        });
        const run = JSON.parse(readFileSync(childOutput, "utf8"));
        runsByLane.get(lane.key).push({ ...run, iteration, order });
      }
    }

    const representativeOutputs = Object.fromEntries(
      lanes.map((lane) => [lane.key, runsByLane.get(lane.key)[0].output]),
    );
    const results = lanes.map((lane) => ({
      metadata: runsByLane.get(lane.key)[0].metadata,
      metrics: summarizeRuns(runsByLane.get(lane.key)),
      mode: lane.mode,
      runs: runsByLane.get(lane.key).map(({ output, ...run }) => run),
      targetLabel: lane.label,
    }));
    const [referenceLane, ...comparisonLanes] = lanes;
    const parity = comparisonLanes.map((lane) =>
      compareOutputs(
        referenceLane.key,
        representativeOutputs[referenceLane.key],
        lane.key,
        representativeOutputs[lane.key],
      ),
    );
    const targetComparisons = compareTargetMetrics(
      results,
      targets,
      options.modes,
    );
    const result = {
      counterbalanced: options.iterations % lanes.length === 0,
      createdAt: new Date().toISOString(),
      edits: options.edits,
      executionOrder,
      fixture: {
        componentCount: options.componentCount,
        projectCount: options.projectCount,
        sharedDependencyFanout: options.componentCount,
        workload:
          "Cold extraction followed by shared type edits that invalidate every component",
      },
      iterations: options.iterations,
      modes: options.modes,
      nodeVersion: process.version,
      outputs: representativeOutputs,
      parity,
      platform: process.platform,
      schemaVersion: BENCHMARK_SCHEMA_VERSION,
      targetComparisons,
      targets,
      measurement: {
        adapter:
          "Vite code generation plus benchmark regex/JSON decoding when the plugin exposes benchmark telemetry; excluded from core",
        core: "Backend initialize/update/analyze time when the plugin exposes benchmark telemetry",
        heapScope: "benchmark Node process after forced garbage collection",
        integration:
          "Unchanged end-to-end runner wall time, including Vite transforms and output validation",
        nativeRequestProfile:
          "Benchmark-only counts of physical TS7 transport calls and logical API methods, including requests carried by batchRequests",
        rssSampleIntervalMs: 5,
        rssScope: "benchmark Node process plus engine child processes",
        retainedRssBreakdown:
          "Settled aggregate RSS split between the benchmark Node process and its engine child processes",
      },
      results,
    };
    printSummary(result);
    if (options.output) {
      const outputPath = path.resolve(options.output);
      mkdirSync(path.dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
      console.log(`Wrote benchmark output to ${outputPath}`);
    }
    if (
      options.requireParity &&
      parity.some(
        (comparison) =>
          comparison.exactComponentMatches !== comparison.componentCount ||
          comparison.fieldAgreement !== 1,
      )
    ) {
      throw new Error("Normalized output parity check failed");
    }
    return result;
  } finally {
    if (options.keepTemp) {
      console.log(`Kept benchmark workspace at ${workspace.temporaryRoot}`);
    } else {
      workspace.cleanup();
    }
  }
}

async function runParent(options) {
  if (!options.profileMatrix) return runSingleBenchmark(options);

  const points = [];
  for (const requested of PROFILE_MATRIX) {
    const result = await runSingleBenchmark({
      ...options,
      ...requested,
      output: null,
      profileMatrix: false,
    });
    points.push({ requested, result });
  }
  const matrixResult = {
    createdAt: new Date().toISOString(),
    matrix: points,
    modes: options.modes,
    profileMatrix: true,
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    targets: [
      { label: options.label, pluginEntry: options.pluginEntry },
      ...(options.comparePluginEntry
        ? [
            {
              label: options.compareLabel,
              pluginEntry: options.comparePluginEntry,
            },
          ]
        : []),
    ],
  };
  if (options.output) {
    const outputPath = path.resolve(options.output);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(matrixResult, null, 2)}\n`);
    console.log(`Wrote benchmark output to ${outputPath}`);
  }
  return matrixResult;
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.childMode) await runChild(options);
  else await runParent(options);
} catch (error) {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
}
