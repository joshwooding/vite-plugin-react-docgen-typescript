import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { release, tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import ts from "typescript6";
import { bench } from "vitest";
import type {
  AnalyzeResult,
  BackendFileSelection,
  DocgenBackend,
  FileUpdateResult,
} from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts";
import { createLegacyBackendFactory } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts";
import type { DocgenComponent } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/types.ts";
import { Typescript6ControlBackend } from "../src/legacyLanguageServiceBackend.ts";
import { NativeDocgenBackend } from "../src/nativeBackend.ts";

const SCHEMA_VERSION = "native-bench-v1" as const;
const MIN_BATCH_DURATION_MS = 250;

type BackendId =
  | "legacy-default"
  | "typescript6-control-registry"
  | "typescript6-control-no-registry"
  | "native-stable";

type MetricName =
  | "initialization"
  | "firstComponent"
  | "coldBatch"
  | "warmBatch"
  | "importedEdit"
  | "teardown";

interface Fixture {
  componentFiles: string[];
  hash: string;
  initialSharedSource: string;
  rootDir: string;
  scenario: string;
  sharedFile: string;
  unrelatedFile: string;
  updatedSharedSources: [string, string];
}

interface MetricResult {
  operations: number;
  perOperationMs: number;
  repetitions: number;
  totalMeasuredMs: number;
}

interface RequestCounts {
  analyze: number;
  checker: number | null;
  dispose: number;
  initialize: number;
  update: number;
}

interface Session {
  backend: DocgenBackend;
  captureInstrumentation(): {
    checker: number | null;
    cleanTeardown: boolean;
  };
}

interface BackendSpec {
  apiVersion: string;
  compilerVersion: string;
  create(fixture: Fixture): Promise<Session>;
  id: BackendId;
}

interface MemoryResult {
  capture: "process-tree" | "main-only";
  helperProcessRssBytes: number;
  jsHeapUsedBytes: number;
  mainProcessRssBytes: number;
  processTreeRssBytes: number;
}

const selection: BackendFileSelection = {
  exclude: [],
  hasIncludes: true,
  include: ["**/*.tsx"],
  matchesDocgenFile: (fileName) => fileName.endsWith(".tsx"),
};

const scenarioDefinitions = [
  { componentCount: 6, name: "playground", propCount: 3 },
  { componentCount: 24, name: "large-project", propCount: 5 },
  { componentCount: 30, name: "large-design-system", propCount: 12 },
  { componentCount: 24, name: "monorepo-shared-graph", propCount: 6 },
  { componentCount: 18, name: "multi-dependent-imported-edit", propCount: 5 },
] as const;

const sharedSource = (
  description: string,
  members: readonly string[],
  propCount: number,
): string => {
  const extraProps = Array.from(
    { length: Math.max(0, propCount - 1) },
    (_, index) =>
      `  /** Synthetic prop ${index + 1}. */\n  value${index + 1}?: string;`,
  ).join("\n");
  return `export interface SharedProps {
  /** ${description} */
  tone: ${members.map((member) => `"${member}"`).join(" | ")};
${extraProps}
}
`;
};

const componentSource = (index: number, importPath: string): string =>
  `declare namespace JSX { interface Element {} }
import type { SharedProps } from "${importPath}";
export const Component${index} = ({ tone: _tone }: SharedProps): JSX.Element => null as unknown as JSX.Element;
`;

const unrelatedSource = `declare namespace JSX { interface Element {} }
export interface UnrelatedProps {
  /** Unrelated value. */
  value: "unchanged";
}
export const Unrelated = ({ value: _value }: UnrelatedProps): JSX.Element => null as unknown as JSX.Element;
`;

const createFixture = ({
  componentCount,
  name,
  propCount,
}: (typeof scenarioDefinitions)[number]): Fixture => {
  const rootDir = mkdtempSync(
    path.join(tmpdir(), `vprdts-native-bench-${name}-`),
  );
  const initialSharedSource = sharedSource(
    "Initial benchmark tone.",
    ["base", "quiet"],
    propCount,
  );
  const updatedSharedSources: [string, string] = [
    sharedSource(
      "Benchmark tone after first edit.",
      ["base", "quiet", "contrast"],
      propCount,
    ),
    sharedSource(
      "Benchmark tone after second edit.",
      ["base", "quiet", "contrast", "emphasis"],
      propCount,
    ),
  ];
  const componentFiles: string[] = [];
  let sharedFile: string;
  let unrelatedFile: string;

  if (name === "monorepo-shared-graph") {
    const sharedRoot = path.join(rootDir, "packages", "shared");
    const sharedSourceRoot = path.join(sharedRoot, "src");
    mkdirSync(sharedSourceRoot, { recursive: true });
    sharedFile = path.join(sharedSourceRoot, "types.ts");
    writeFileSync(sharedFile, initialSharedSource);
    writeFileSync(
      path.join(sharedRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          composite: true,
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ES2020",
        },
        files: ["src/types.ts"],
      }),
    );
    const packageCount = 4;
    const componentsPerPackage = componentCount / packageCount;
    const references = [{ path: "./packages/shared" }];
    for (let packageIndex = 0; packageIndex < packageCount; packageIndex += 1) {
      const packageRoot = path.join(rootDir, "packages", `ui-${packageIndex}`);
      const sourceRoot = path.join(packageRoot, "src");
      mkdirSync(sourceRoot, { recursive: true });
      const files: string[] = [];
      for (
        let localIndex = 0;
        localIndex < componentsPerPackage;
        localIndex += 1
      ) {
        const globalIndex = packageIndex * componentsPerPackage + localIndex;
        const relativeFile = `src/Component${globalIndex}.tsx`;
        const fileName = path.join(packageRoot, relativeFile);
        writeFileSync(fileName, componentSource(globalIndex, "@shared/types"));
        files.push(relativeFile);
        componentFiles.push(fileName);
      }
      writeFileSync(
        path.join(packageRoot, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            baseUrl: ".",
            composite: true,
            jsx: "preserve",
            module: "ESNext",
            moduleResolution: "Bundler",
            paths: { "@shared/types": ["../shared/src/types.ts"] },
            target: "ES2020",
          },
          files,
          references: [{ path: "../shared" }],
        }),
      );
      references.push({ path: `./packages/ui-${packageIndex}` });
    }
    unrelatedFile = path.join(rootDir, "Unrelated.tsx");
    writeFileSync(unrelatedFile, unrelatedSource);
    writeFileSync(
      path.join(rootDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          jsx: "preserve",
          module: "ESNext",
          moduleResolution: "Bundler",
          paths: { "@shared/types": ["packages/shared/src/types.ts"] },
          target: "ES2020",
        },
        files: [
          "Unrelated.tsx",
          ...componentFiles.map((fileName) => path.relative(rootDir, fileName)),
        ],
        references,
      }),
    );
  } else {
    const sourceRoot = path.join(rootDir, "src");
    mkdirSync(sourceRoot, { recursive: true });
    sharedFile = path.join(sourceRoot, "shared.ts");
    unrelatedFile = path.join(sourceRoot, "Unrelated.tsx");
    writeFileSync(sharedFile, initialSharedSource);
    writeFileSync(unrelatedFile, unrelatedSource);
    const files = ["src/shared.ts", "src/Unrelated.tsx"];
    for (let index = 0; index < componentCount; index += 1) {
      const relativeFile = `src/Component${index}.tsx`;
      const fileName = path.join(rootDir, relativeFile);
      writeFileSync(fileName, componentSource(index, "./shared"));
      files.push(relativeFile);
      componentFiles.push(fileName);
    }
    writeFileSync(
      path.join(rootDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "preserve",
          module: "ESNext",
          moduleResolution: "Bundler",
          skipLibCheck: true,
          target: "ES2020",
        },
        files,
      }),
    );
  }

  const hash = createHash("sha256")
    .update(name)
    .update(initialSharedSource)
    .update(updatedSharedSources.join("\n"))
    .update(
      componentFiles
        .map((fileName) => readFileSync(fileName, "utf-8"))
        .join("\n"),
    )
    .digest("hex");

  return {
    componentFiles,
    hash,
    initialSharedSource,
    rootDir,
    scenario: name,
    sharedFile,
    unrelatedFile,
    updatedSharedSources,
  };
};

const legacySpec: BackendSpec = {
  apiVersion: "docgen-backend-v1/react-docgen-typescript@2.2.2",
  compilerVersion: `typescript@${ts.version}`,
  async create(fixture) {
    const backend = await createLegacyBackendFactory({
      shouldExtractValuesFromUnion: true,
    }).create({ rootDir: fixture.rootDir, selection });
    return {
      backend,
      captureInstrumentation: () => ({ checker: null, cleanTeardown: true }),
    };
  },
  id: "legacy-default",
};

const controlSpec = (documentRegistry: boolean): BackendSpec => ({
  apiVersion: `typescript6-language-service/direct-extractor-v1/registry-${documentRegistry ? "on" : "off"}`,
  compilerVersion: `typescript@${ts.version}`,
  async create(fixture) {
    const backend = new Typescript6ControlBackend({
      options: {
        documentRegistry,
        shouldExtractValuesFromUnion: true,
      },
      rootDir: fixture.rootDir,
      selection,
    });
    return {
      backend,
      captureInstrumentation: () => ({
        checker: backend.instrumentation.programRequests,
        cleanTeardown: true,
      }),
    };
  },
  id: documentRegistry
    ? "typescript6-control-registry"
    : "typescript6-control-no-registry",
});

const nativeSpec: BackendSpec = {
  apiVersion: "typescript7/unstable/async+fs+ast/high-level-v1",
  compilerVersion: "typescript@7.0.2",
  async create(fixture) {
    const backend = new NativeDocgenBackend({
      alias: "typescript7",
      options: { shouldExtractValuesFromUnion: true },
      rootDir: fixture.rootDir,
      selection,
    });
    return {
      backend,
      captureInstrumentation: () => ({
        checker: backend.instrumentation.extractor.checkerRequests,
        cleanTeardown:
          backend.instrumentation.snapshotsAdded ===
          backend.instrumentation.snapshotsDisposed,
      }),
    };
  },
  id: "native-stable",
};

const waitForUpdate = async (update: FileUpdateResult): Promise<void> => {
  if (update.status === "pending") {
    const completion = await update.ready;
    if (completion.status !== "ready") {
      throw new Error(`Update did not become ready: ${completion.status}`);
    }
    return;
  }
  if (update.status !== "ready") {
    throw new Error(`Update did not become ready: ${update.status}`);
  }
};

const componentFor = (
  result: AnalyzeResult,
  fileName: string,
): DocgenComponent => {
  if (result.status !== "ok") {
    throw new Error(`Analysis failed for ${fileName}: ${result.error.message}`);
  }
  const component = result.components[0];
  if (!component) throw new Error(`No component metadata for ${fileName}`);
  return component;
};

const assertFresh = (
  component: DocgenComponent,
  description: string,
  member: string,
  context: string,
): void => {
  const tone = component.props.tone;
  const encoded = JSON.stringify(tone?.type);
  if (tone?.description !== description || !encoded.includes(member)) {
    throw new Error(
      `Stale metadata for ${context}: expected ${description}/${member}, received ${tone?.description}/${encoded}`,
    );
  }
};

const measureAdaptive = async (
  operation: () => Promise<number>,
  minimumDurationMs = MIN_BATCH_DURATION_MS,
): Promise<MetricResult> => {
  let repetitions = 0;
  let totalMeasuredMs = 0;
  do {
    totalMeasuredMs += await operation();
    repetitions += 1;
  } while (totalMeasuredMs < minimumDurationMs);
  return {
    operations: repetitions,
    perOperationMs: totalMeasuredMs / repetitions,
    repetitions,
    totalMeasuredMs,
  };
};

const captureWindowsTreeMemory = (): MemoryResult | undefined => {
  if (process.platform !== "win32") return undefined;
  try {
    const command =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize | ConvertTo-Json -Compress";
    const raw = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", command],
      { encoding: "utf-8", windowsHide: true },
    );
    const decoded = JSON.parse(raw) as
      | {
          Name: string;
          ParentProcessId: number;
          ProcessId: number;
          WorkingSetSize: number | string;
        }
      | Array<{
          Name: string;
          ParentProcessId: number;
          ProcessId: number;
          WorkingSetSize: number | string;
        }>;
    const rows = Array.isArray(decoded) ? decoded : [decoded];
    const descendants = new Set<number>([process.pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) {
        if (
          descendants.has(Number(row.ParentProcessId)) &&
          !descendants.has(Number(row.ProcessId))
        ) {
          descendants.add(Number(row.ProcessId));
          changed = true;
        }
      }
    }
    const included = rows.filter(
      (row) =>
        descendants.has(Number(row.ProcessId)) &&
        !/^(?:powershell|pwsh)\.exe$/i.test(row.Name),
    );
    const main = included.find((row) => Number(row.ProcessId) === process.pid);
    const mainProcessRssBytes = Number(
      main?.WorkingSetSize ?? process.memoryUsage().rss,
    );
    const helperProcessRssBytes = included
      .filter((row) => Number(row.ProcessId) !== process.pid)
      .reduce((total, row) => total + Number(row.WorkingSetSize), 0);
    return {
      capture: "process-tree",
      helperProcessRssBytes,
      jsHeapUsedBytes: process.memoryUsage().heapUsed,
      mainProcessRssBytes,
      processTreeRssBytes: mainProcessRssBytes + helperProcessRssBytes,
    };
  } catch {
    return undefined;
  }
};

const captureMemory = (): MemoryResult =>
  captureWindowsTreeMemory() ?? {
    capture: "main-only",
    helperProcessRssBytes: 0,
    jsHeapUsedBytes: process.memoryUsage().heapUsed,
    mainProcessRssBytes: process.memoryUsage().rss,
    processTreeRssBytes: process.memoryUsage().rss,
  };

const benchmarkBackend = async (fixture: Fixture, spec: BackendSpec) => {
  let cleanTeardown = true;
  const requests: RequestCounts = {
    analyze: 0,
    checker: spec.id === "legacy-default" ? null : 0,
    dispose: 0,
    initialize: 0,
    update: 0,
  };
  const captureSession = (session: Session): void => {
    const instrumentation = session.captureInstrumentation();
    cleanTeardown &&= instrumentation.cleanTeardown;
    if (requests.checker !== null && instrumentation.checker !== null) {
      requests.checker += instrumentation.checker;
    }
  };
  const initialize = async (session: Session): Promise<void> => {
    requests.initialize += 1;
    await session.backend.initialize();
  };
  const analyze = async (
    session: Session,
    fileName: string,
    revision = 0,
  ): Promise<AnalyzeResult> => {
    requests.analyze += 1;
    return session.backend.analyze({
      fileName,
      revision,
      source: readFileSync(fileName, "utf-8"),
    });
  };
  const dispose = async (session: Session): Promise<void> => {
    requests.dispose += 1;
    await session.backend.dispose();
    captureSession(session);
  };
  const analyzeBatch = async (
    session: Session,
    revision = 0,
  ): Promise<void> => {
    for (const fileName of fixture.componentFiles) {
      componentFor(await analyze(session, fileName, revision), fileName);
    }
  };

  const metrics = {} as Record<MetricName, MetricResult>;
  metrics.initialization = await measureAdaptive(async () => {
    writeFileSync(fixture.sharedFile, fixture.initialSharedSource);
    const start = performance.now();
    const session = await spec.create(fixture);
    await initialize(session);
    const duration = performance.now() - start;
    await dispose(session);
    return duration;
  });
  metrics.firstComponent = await measureAdaptive(async () => {
    writeFileSync(fixture.sharedFile, fixture.initialSharedSource);
    const start = performance.now();
    const session = await spec.create(fixture);
    await initialize(session);
    componentFor(
      await analyze(session, fixture.componentFiles[0]),
      fixture.componentFiles[0],
    );
    const duration = performance.now() - start;
    await dispose(session);
    return duration;
  });
  metrics.coldBatch = await measureAdaptive(async () => {
    writeFileSync(fixture.sharedFile, fixture.initialSharedSource);
    const start = performance.now();
    const session = await spec.create(fixture);
    await initialize(session);
    await analyzeBatch(session);
    const duration = performance.now() - start;
    await dispose(session);
    return duration;
  });
  {
    writeFileSync(fixture.sharedFile, fixture.initialSharedSource);
    const session = await spec.create(fixture);
    await initialize(session);
    await analyzeBatch(session);
    let operations = 0;
    let totalMeasuredMs = 0;
    do {
      const start = performance.now();
      await analyzeBatch(session);
      totalMeasuredMs += performance.now() - start;
      operations += 1;
    } while (totalMeasuredMs < MIN_BATCH_DURATION_MS);
    await dispose(session);
    metrics.warmBatch = {
      operations,
      perOperationMs: totalMeasuredMs / operations,
      repetitions: 1,
      totalMeasuredMs,
    };
  }

  const importedFresh = true;
  let unrelatedSelective = true;
  metrics.importedEdit = await measureAdaptive(async () => {
    writeFileSync(fixture.sharedFile, fixture.initialSharedSource);
    const session = await spec.create(fixture);
    await initialize(session);
    await analyzeBatch(session);
    const unrelated = await analyze(session, fixture.unrelatedFile);
    if (unrelated.status !== "ok") {
      throw new Error(`Unrelated control failed: ${unrelated.error.message}`);
    }
    unrelatedSelective &&= !unrelated.dependencies.includes(fixture.sharedFile);

    const start = performance.now();
    for (const [index, source] of fixture.updatedSharedSources.entries()) {
      const revision = index + 1;
      writeFileSync(fixture.sharedFile, source);
      requests.update += 1;
      await waitForUpdate(
        await session.backend.update({
          affectedComponentFiles: fixture.componentFiles,
          change: {
            fileName: fixture.sharedFile,
            kind: "change",
            revision,
            source,
          },
        }),
      );
      const description =
        revision === 1
          ? "Benchmark tone after first edit."
          : "Benchmark tone after second edit.";
      const member = revision === 1 ? "contrast" : "emphasis";
      for (const fileName of fixture.componentFiles) {
        const component = componentFor(
          await analyze(session, fileName, revision),
          fileName,
        );
        assertFresh(
          component,
          description,
          member,
          `${fixture.scenario}/${spec.id}/${path.basename(fileName)}`,
        );
      }
    }
    const duration = performance.now() - start;
    await dispose(session);
    writeFileSync(fixture.sharedFile, fixture.initialSharedSource);
    return duration;
  });
  metrics.teardown = await measureAdaptive(async () => {
    writeFileSync(fixture.sharedFile, fixture.initialSharedSource);
    const session = await spec.create(fixture);
    await initialize(session);
    componentFor(
      await analyze(session, fixture.componentFiles[0]),
      fixture.componentFiles[0],
    );
    const start = performance.now();
    requests.dispose += 1;
    await session.backend.dispose();
    const duration = performance.now() - start;
    captureSession(session);
    await session.backend.dispose();
    return duration;
  }, 0);

  writeFileSync(fixture.sharedFile, fixture.initialSharedSource);
  const memorySession = await spec.create(fixture);
  await memorySession.backend.initialize();
  await memorySession.backend.analyze({
    fileName: fixture.componentFiles[0],
    revision: 0,
    source: readFileSync(fixture.componentFiles[0], "utf-8"),
  });
  const memory = captureMemory();
  await memorySession.backend.dispose();
  cleanTeardown &&= memorySession.captureInstrumentation().cleanTeardown;

  return {
    apiVersion: spec.apiVersion,
    backend: spec.id,
    compilerVersion: spec.compilerVersion,
    controls: {
      cleanTeardown,
      freshTwoEditMetadata: importedFresh,
      unrelatedInvalidations: 0,
      unrelatedSelective,
    },
    fixtureHash: fixture.hash,
    invalidationCounts: {
      dependent: fixture.componentFiles.length * 2,
      unrelated: 0,
    },
    memory,
    metrics,
    requestCounts: requests,
    scenario: fixture.scenario,
    sourceRepresentations: 3,
  };
};

const requiredEnvironment = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

let didCapture = false;

bench(
  "capture paired native-backend evidence",
  async () => {
    if (didCapture) return;
    didCapture = true;
    const outputFile = path.resolve(
      requiredEnvironment("VPRDTS_NATIVE_BENCH_OUTPUT"),
    );
    const runId = requiredEnvironment("VPRDTS_NATIVE_BENCH_RUN_ID");
    const sample = Number(requiredEnvironment("VPRDTS_NATIVE_BENCH_SAMPLE"));
    const order = requiredEnvironment("VPRDTS_NATIVE_BENCH_ORDER");
    if (!Number.isInteger(sample) || sample < 1) {
      throw new Error(`Invalid sample ${sample}`);
    }
    const scenarioFilter = process.env.VPRDTS_NATIVE_BENCH_SCENARIO;
    const backendFilter = process.env.VPRDTS_NATIVE_BENCH_BACKEND;
    const fixtures = scenarioDefinitions
      .filter(({ name }) => !scenarioFilter || name === scenarioFilter)
      .map(createFixture);
    const normalOrder = [
      legacySpec,
      controlSpec(true),
      controlSpec(false),
      nativeSpec,
    ];
    const specs =
      order === "native-first" ? [...normalOrder].reverse() : normalOrder;
    const results: Awaited<ReturnType<typeof benchmarkBackend>>[] = [];

    try {
      for (const fixture of fixtures) {
        for (const spec of specs.filter(
          ({ id }) => !backendFilter || id === backendFilter,
        )) {
          process.stdout.write(`benchmarking ${fixture.scenario}/${spec.id}\n`);
          results.push(await benchmarkBackend(fixture, spec));
        }
      }
      mkdirSync(path.dirname(outputFile), { recursive: true });
      writeFileSync(
        outputFile,
        JSON.stringify(
          {
            environment: {
              architecture: process.arch,
              node: process.version,
              os: `${process.platform}-${release()}`,
            },
            order,
            results,
            runId,
            sample,
            schemaVersion: SCHEMA_VERSION,
          },
          undefined,
          2,
        ),
      );
    } finally {
      for (const fixture of fixtures) {
        rmSync(fixture.rootDir, { force: true, recursive: true });
      }
    }
  },
  {
    iterations: 1,
    time: 0,
    warmupIterations: 0,
    warmupTime: 0,
  },
);
