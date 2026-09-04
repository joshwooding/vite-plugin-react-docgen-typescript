import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const CHILD_DEADLINE_MS = 90_000;
const INSTALL_DEADLINE_MS = 180_000;
const RUNTIME_MODES = Object.freeze([
  "default",
  "legacy",
  "native",
  "project-service",
  "experimental-watch",
  "experimental-project-service",
]);
const USAGE =
  "Usage: verify-runtime-compatibility.mjs --package <absolute.tgz> --typescript <version> --vite <version> --modes <comma-separated-mode-ids>";

const parseModes = (value) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("The --modes argument must contain at least one mode");
  }

  const modes = value.split(",").map((mode) => mode.trim());
  if (modes.some((mode) => mode === "")) {
    throw new Error("The --modes argument contains an empty mode");
  }
  const unknownModes = modes.filter((mode) => !RUNTIME_MODES.includes(mode));
  if (unknownModes.length > 0) {
    throw new Error(
      `Unknown runtime mode${unknownModes.length === 1 ? "" : "s"}: ${unknownModes.join(", ")}`,
    );
  }
  if (new Set(modes).size !== modes.length) {
    throw new Error("The --modes argument contains duplicate modes");
  }
  return modes;
};

const parseArguments = (arguments_) => {
  const expectedKeys = new Set(["modes", "package", "typescript", "vite"]);
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error(USAGE);
    }
    const normalizedKey = key.slice(2);
    if (!expectedKeys.has(normalizedKey)) {
      throw new Error(`Unknown argument: ${key}`);
    }
    if (values.has(normalizedKey)) {
      throw new Error(`Duplicate argument: ${key}`);
    }
    values.set(normalizedKey, value);
  }
  return {
    modes: values.has("modes") ? parseModes(values.get("modes")) : undefined,
    packageArchive: values.get("package"),
    typescriptVersion: values.get("typescript"),
    viteVersion: values.get("vite"),
  };
};

const run = (command, arguments_, options) => {
  const result = spawnSync(command, arguments_, {
    encoding: "utf8",
    stdio: "pipe",
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      [
        `${command} ${arguments_.join(" ")} exited ${String(result.status)}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
};

const resolveNpmInvocation = () => {
  if (process.platform !== "win32") {
    return { arguments_: [], command: "npm" };
  }
  const npmCli = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  if (!existsSync(npmCli)) {
    throw new Error(`Could not locate npm CLI beside Node.js: ${npmCli}`);
  }
  return { arguments_: [npmCli], command: process.execPath };
};

const packedConsumerMain = async (runtimeModes) => {
  const TOPOLOGIES = ["same-project", "project-reference"];
  const MODE_OPTIONS = {
    default: {},
    legacy: { docgenMode: "legacy" },
    native: { docgenMode: "native" },
    "project-service": { docgenMode: "project-service" },
    "experimental-watch": { EXPERIMENTAL_useWatchProgram: true },
    "experimental-project-service": {
      EXPERIMENTAL_useProjectService: true,
    },
  };
  const PROPS_SOURCES = {
    initial: `export interface ImportedProps {
  /** Initial imported tone. */
  tone: "base" | "quiet";
}
`,
    first: `export interface ImportedProps {
  /** Tone after the first imported-type edit. */
  tone: "base" | "quiet" | "contrast";
}
`,
    second: `export interface ImportedProps {
  /** Tone after the second imported-type edit. */
  tone: "base" | "quiet" | "contrast" | "emphasis";
}
`,
  };
  const COMPONENT_SOURCE = `declare namespace JSX {
  interface Element {}
}

import { ImportedProps } from "./props";

export const DependentComponent = ({ tone: _tone }: ImportedProps): JSX.Element =>
  null as unknown as JSX.Element;

if (import.meta.hot) import.meta.hot.accept();
`;
  const UNRELATED_SOURCE = `declare namespace JSX {
  interface Element {}
}

export interface UnrelatedProps {
  /** Unrelated value. */
  value: "unchanged";
}

export const UnrelatedComponent = ({ value: _value }: UnrelatedProps): JSX.Element =>
  null as unknown as JSX.Element;

if (import.meta.hot) import.meta.hot.accept();
`;
  const MISSING_DEPENDENT_SOURCE = `declare namespace JSX {
  interface Element {}
}

import { MissingProps } from "./missingProps";

export const MissingDependent = ({ tone: _tone }: MissingProps): JSX.Element =>
  null as unknown as JSX.Element;

if (import.meta.hot) import.meta.hot.accept();
`;
  const MISSING_PROPS_SOURCES = {
    created: `export interface MissingProps {
  /** Tone after missing dependency creation. */
  tone: "base" | "created";
}
`,
    recreated: `export interface MissingProps {
  /** Tone after missing dependency recreation. */
  tone: "base" | "recreated";
}
`,
  };

  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };

  const withDeadline = async (promise, label) => {
    let timeout;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`${label} exceeded 10 seconds`)),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  };

  const extractMetadata = (code, testLabel) => {
    const match = code?.match(/__docgenInfo\s*=\s*(\{[\s\S]*?\});/);
    assert(
      match?.[1],
      `${testLabel} transformed component has no __docgenInfo assignment`,
    );
    const docgen = runInNewContext(`(${match[1]})`, Object.create(null), {
      timeout: 1_000,
    });
    const tone = docgen.props?.tone;
    return {
      description: tone?.description ?? null,
      unionValues: [
        ...new Set(
          (tone?.type?.value ?? [])
            .map(({ value }) => value?.replace(/^[/"]+|[/"]+$/g, ""))
            .filter(Boolean),
        ),
      ].sort(),
    };
  };

  const createFixture = (topology) => {
    const commonRoot = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), "vite-rdt-packed-")),
    );
    const root =
      topology === "same-project"
        ? path.join(commonRoot, "app")
        : path.join(commonRoot, "apps", "storybook");
    const sourceRoot =
      topology === "same-project"
        ? path.join(root, "src")
        : path.join(commonRoot, "library", "src");
    const componentPath = path.join(sourceRoot, "Dependent.tsx");
    const missingComponentPath = path.join(sourceRoot, "MissingDependent.tsx");
    const missingPropsPath = path.join(sourceRoot, "missingProps.ts");
    const propsPath = path.join(sourceRoot, "props.ts");
    const unrelatedPath = path.join(sourceRoot, "Unrelated.tsx");
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(root, { recursive: true });
    writeFileSync(componentPath, COMPONENT_SOURCE);
    writeFileSync(missingComponentPath, MISSING_DEPENDENT_SOURCE);
    writeFileSync(propsPath, PROPS_SOURCES.initial);
    writeFileSync(unrelatedPath, UNRELATED_SOURCE);

    const compilerOptions = {
      jsx: "preserve",
      module: "ESNext",
      moduleResolution: "Node",
      skipLibCheck: true,
      target: "ES2019",
    };
    if (topology === "same-project") {
      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions,
          include: ["src/**/*"],
        }),
      );
    } else {
      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions,
          files: [],
          references: [{ path: "../../library/tsconfig.build.json" }],
        }),
      );
      writeFileSync(
        path.join(commonRoot, "library", "tsconfig.build.json"),
        JSON.stringify({
          compilerOptions: { ...compilerOptions, composite: true },
          include: ["src/**/*"],
        }),
      );
    }

    const toUrl = (fileName) =>
      topology === "same-project"
        ? `/${normalizePath(path.relative(root, fileName))}`
        : `/@fs/${normalizePath(fileName)}`;
    return {
      commonRoot,
      componentPath,
      componentUrl: toUrl(componentPath),
      missingComponentPath,
      missingComponentUrl: toUrl(missingComponentPath),
      missingPropsPath,
      propsPath,
      root,
      unrelatedPath,
      unrelatedUrl: toUrl(unrelatedPath),
    };
  };

  const installWatcherProbe = (watcher, event, getCapture) => {
    const rawListeners = watcher.rawListeners(event);
    for (const listener of rawListeners) {
      watcher.removeListener(event, listener);
    }
    for (const rawListener of rawListeners) {
      const listener = rawListener.listener ?? rawListener;
      const wrapped = function (...arguments_) {
        const capture = getCapture();
        if (capture) capture.listenerInvocations += 1;
        return Reflect.apply(listener, this, arguments_);
      };
      if (rawListener.listener) watcher.once(event, wrapped);
      else watcher.on(event, wrapped);
    }
    assert(
      rawListeners.length > 0,
      `Vite watcher exposes no ${event} listener`,
    );
  };

  const getModuleGraph = (server) =>
    server.environments?.client?.moduleGraph ?? server.moduleGraph;
  const getHotChannel = (server) =>
    server.environments?.client?.hot ?? server.ws;

  const moduleCandidates = (module, fixture) => {
    const values = [module.url, module.id, module.file].filter(Boolean);
    if (module.file) {
      values.push(`/@fs/${normalizePath(module.file)}`);
      values.push(
        `/${normalizePath(path.relative(fixture.root, module.file))}`,
      );
    }
    return new Set(values.map((value) => normalizePath(value.split("?")[0])));
  };

  const matchesModule = (value, module, fixture) =>
    moduleCandidates(module, fixture).has(normalizePath(value.split("?")[0]));

  const countDelivery = (payloads, module, fixture) =>
    payloads
      .filter(({ type }) => type === "update")
      .flatMap(({ updates }) => updates)
      .filter(({ acceptedPath, path: updatePath }) =>
        [acceptedPath, updatePath].some(
          (value) => value && matchesModule(value, module, fixture),
        ),
      ).length;

  const getSingleModule = (server, fileName) => {
    const modules = getModuleGraph(server).getModulesByFile(
      normalizePath(fileName),
    );
    return modules?.size === 1 ? [...modules][0] : null;
  };

  const writeEdit = (fileName, contents, previousMtime) => {
    writeFileSync(fileName, contents);
    const nextMtime = Math.max(previousMtime + 2_000, Date.now() + 2_000);
    utimesSync(fileName, nextMtime / 1_000, nextMtime / 1_000);
    return nextMtime;
  };

  const runTopology = async (runtimeMode, topology) => {
    const testLabel = `${runtimeMode}/${topology}`;
    const fixture = createFixture(topology);
    assert(
      existsSync(fixture.componentPath),
      `${testLabel} fixture component is absent: ${fixture.componentPath}`,
    );
    let server;
    let activeCapture;
    try {
      server = await withDeadline(
        createServer({
          appType: "custom",
          configFile: false,
          logLevel: "silent",
          optimizeDeps: { disabled: true, noDiscovery: true },
          plugins: [
            reactDocgenTypescript({
              ...MODE_OPTIONS[runtimeMode],
              exclude: [],
              include:
                topology === "same-project"
                  ? ["src/**/*.tsx"]
                  : ["../../library/**/*.tsx"],
              shouldExtractValuesFromUnion: true,
              tsconfigPath: "tsconfig.json",
            }),
          ],
          root: fixture.root,
          server: {
            fs: { allow: [fixture.commonRoot] },
            middlewareMode: true,
            watch: null,
          },
        }),
        `${testLabel} server creation`,
      );

      const hotChannel = getHotChannel(server);
      const originalSend = hotChannel.send;
      hotChannel.send = function (...arguments_) {
        const payload = arguments_[0];
        if (
          activeCapture &&
          payload &&
          typeof payload === "object" &&
          "type" in payload
        ) {
          activeCapture.payloads.push(payload);
          if (["error", "full-reload", "update"].includes(payload.type)) {
            activeCapture.resolveTerminalPayload(payload);
          }
        }
        return Reflect.apply(originalSend, this, arguments_);
      };
      for (const event of ["add", "change", "unlink"]) {
        installWatcherProbe(server.watcher, event, () => activeCapture);
      }

      const initialDependent = await withDeadline(
        server.transformRequest(fixture.componentUrl),
        `${testLabel} initial dependent transform`,
      );
      const initialUnrelated = await withDeadline(
        server.transformRequest(fixture.unrelatedUrl),
        `${testLabel} initial unrelated transform`,
      );
      await withDeadline(
        server.transformRequest(fixture.missingComponentUrl),
        `${testLabel} initial missing-dependent transform`,
      );
      const initial = extractMetadata(
        initialDependent?.code,
        `${testLabel} initial dependent`,
      );
      assert(
        initial.description === "Initial imported tone." &&
          initial.unionValues.includes("base"),
        `${testLabel} initial metadata is stale: ${JSON.stringify(initial)}`,
      );
      extractMetadata(initialUnrelated?.code, `${testLabel} initial unrelated`);

      const dependentModule = getSingleModule(server, fixture.componentPath);
      const missingDependentModule = getSingleModule(
        server,
        fixture.missingComponentPath,
      );
      const unrelatedModule = getSingleModule(server, fixture.unrelatedPath);
      assert(dependentModule, `${testLabel} dependent graph node is absent`);
      assert(
        missingDependentModule,
        `${testLabel} missing-dependent graph node is absent`,
      );
      assert(unrelatedModule, `${testLabel} unrelated graph node is absent`);

      const emitCycle = async (phase, event, changedFile) => {
        let resolveTerminalPayload;
        const terminalPayload = new Promise((resolve) => {
          resolveTerminalPayload = resolve;
        });
        const capture = {
          listenerInvocations: 0,
          payloads: [],
          resolveTerminalPayload,
          terminalPayload,
        };
        activeCapture = capture;
        const emitted = server.watcher.emit(event, changedFile);
        assert(emitted, `${testLabel} ${phase} reached no ${event} listener`);
        assert(
          capture.listenerInvocations > 0,
          `${testLabel} ${phase} did not invoke a ${event} listener`,
        );
        await withDeadline(
          terminalPayload,
          `${testLabel} ${phase} hot-channel delivery`,
        );
        activeCapture = undefined;
        const fullReloads = capture.payloads.filter(
          ({ type }) => type === "full-reload",
        ).length;
        const hotErrors = capture.payloads.filter(
          ({ type }) => type === "error",
        ).length;
        const dependentDeliveries = countDelivery(
          capture.payloads,
          missingDependentModule,
          fixture,
        );
        assert(
          fullReloads === 0 && hotErrors === 0 && dependentDeliveries === 1,
          `${testLabel} ${phase} delivery was not exact for the dependent: ${JSON.stringify(
            {
              dependentDeliveries,
              fullReloads,
              hotErrors,
              payloads: capture.payloads,
            },
          )}`,
        );
        return capture;
      };

      writeFileSync(fixture.missingPropsPath, MISSING_PROPS_SOURCES.created);
      await emitCycle(
        "missing dependency create",
        "add",
        fixture.missingPropsPath,
      );
      const created = extractMetadata(
        (
          await withDeadline(
            server.transformRequest(fixture.missingComponentUrl),
            `${testLabel} created missing-dependency transform`,
          )
        )?.code,
        `${testLabel} created missing dependency`,
      );
      assert(
        created.description === "Tone after missing dependency creation." &&
          created.unionValues.includes("created"),
        `${testLabel} created missing dependency metadata is stale: ${JSON.stringify(created)}`,
      );

      rmSync(fixture.missingPropsPath);
      const deletedCapture = await emitCycle(
        "missing dependency delete",
        "unlink",
        fixture.missingPropsPath,
      );
      const afterDelete = extractMetadata(
        (
          await withDeadline(
            server.transformRequest(fixture.missingComponentUrl),
            `${testLabel} deleted missing-dependency transform`,
          )
        )?.code,
        `${testLabel} deleted missing dependency`,
      );
      assert(
        afterDelete.description !== "Tone after missing dependency creation." &&
          !afterDelete.unionValues.includes("created"),
        `${testLabel} deleted dependency metadata remained stale: ${JSON.stringify(afterDelete)}`,
      );
      assert(
        countDelivery(deletedCapture.payloads, unrelatedModule, fixture) === 0,
        `${testLabel} missing dependency delete delivered the unrelated module`,
      );

      writeFileSync(fixture.missingPropsPath, MISSING_PROPS_SOURCES.recreated);
      await emitCycle(
        "missing dependency recreate",
        "add",
        fixture.missingPropsPath,
      );
      const recreated = extractMetadata(
        (
          await withDeadline(
            server.transformRequest(fixture.missingComponentUrl),
            `${testLabel} recreated missing-dependency transform`,
          )
        )?.code,
        `${testLabel} recreated missing dependency`,
      );
      assert(
        recreated.description === "Tone after missing dependency recreation." &&
          recreated.unionValues.includes("recreated"),
        `${testLabel} recreated missing dependency metadata is stale: ${JSON.stringify(recreated)}`,
      );

      let mtime = statSync(fixture.propsPath).mtimeMs;
      const edits = [
        ["first", "Tone after the first imported-type edit.", "contrast"],
        ["second", "Tone after the second imported-type edit.", "emphasis"],
      ];
      for (const [phase, description, unionMember] of edits) {
        mtime = writeEdit(fixture.propsPath, PROPS_SOURCES[phase], mtime);
        let resolveTerminalPayload;
        const terminalPayload = new Promise((resolve) => {
          resolveTerminalPayload = resolve;
        });
        const capture = {
          listenerInvocations: 0,
          payloads: [],
          resolveTerminalPayload,
          terminalPayload,
        };
        activeCapture = capture;
        const emitted = server.watcher.emit("change", fixture.propsPath);
        assert(
          emitted,
          `${testLabel} ${phase} edit reached no watcher listener`,
        );
        assert(
          capture.listenerInvocations > 0,
          `${testLabel} ${phase} edit did not invoke a watcher listener`,
        );
        await withDeadline(
          terminalPayload,
          `${testLabel} ${phase} hot-channel delivery`,
        );
        activeCapture = undefined;

        const transformed = await withDeadline(
          server.transformRequest(fixture.componentUrl),
          `${testLabel} ${phase} dependent transform`,
        );
        const metadata = extractMetadata(
          transformed?.code,
          `${testLabel} ${phase}`,
        );
        assert(
          metadata.description === description &&
            metadata.unionValues.includes(unionMember),
          `${testLabel} ${phase} metadata is stale: ${JSON.stringify(metadata)}`,
        );
        const fullReloads = capture.payloads.filter(
          ({ type }) => type === "full-reload",
        ).length;
        const dependentDeliveries = countDelivery(
          capture.payloads,
          dependentModule,
          fixture,
        );
        const unrelatedDeliveries = countDelivery(
          capture.payloads,
          unrelatedModule,
          fixture,
        );
        assert(
          fullReloads === 0 && dependentDeliveries === 1,
          `${testLabel} ${phase} delivery was not exact: ${JSON.stringify({
            dependentDeliveries,
            fullReloads,
            payloads: capture.payloads,
          })}`,
        );
        assert(
          unrelatedDeliveries === 0,
          `${testLabel} ${phase} delivered the unrelated module`,
        );
      }
      return {
        dynamicMembershipEvents: 3,
        edits: 2,
        mode: runtimeMode,
        topology,
      };
    } finally {
      activeCapture = undefined;
      if (server) {
        await withDeadline(server.close(), `${testLabel} server close`);
      }
      rmSync(fixture.commonRoot, { force: true, recursive: true });
    }
  };

  const results = [];
  for (const runtimeMode of runtimeModes) {
    for (const topology of TOPOLOGIES) {
      results.push(await runTopology(runtimeMode, topology));
    }
  }
  const getWatcherHandles = () =>
    process
      ._getActiveHandles()
      .filter((handle) =>
        ["FSWatcher", "StatWatcher"].includes(handle.constructor?.name),
      );
  const teardownDeadline = Date.now() + 10_000;
  let watcherHandles = getWatcherHandles();
  while (watcherHandles.length > 0 && Date.now() < teardownDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    watcherHandles = getWatcherHandles();
  }
  assert(
    watcherHandles.length === 0,
    `${runtimeModes.join(",")} watcher handles did not close in 10 seconds: ${JSON.stringify(
      watcherHandles.map((handle) => ({
        fileName: handle._filename ?? null,
        type: handle.constructor?.name ?? null,
      })),
    )}`,
  );
  console.log(
    JSON.stringify({ results, watcherHandles: watcherHandles.length }),
  );
};

const childSource = `
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";
import reactDocgenTypescript from "@joshwooding/vite-plugin-react-docgen-typescript";
import { createServer, normalizePath } from "vite";

const runtimeModes = JSON.parse(process.env.VITE_RDT_RUNTIME_MODES ?? "null");
if (!Array.isArray(runtimeModes) || runtimeModes.length === 0) {
  throw new Error("Packed consumer received no runtime modes");
}
await (${packedConsumerMain.toString()})(runtimeModes);
`;

const main = () => {
  const { modes, packageArchive, typescriptVersion, viteVersion } =
    parseArguments(process.argv.slice(2));
  if (!modes || !packageArchive || !typescriptVersion || !viteVersion) {
    throw new Error(
      "The --package, --typescript, --vite, and --modes arguments are required",
    );
  }
  if (!path.isAbsolute(packageArchive)) {
    throw new Error("--package must be an absolute path");
  }
  if (!existsSync(packageArchive)) {
    throw new Error(`Package archive does not exist: ${packageArchive}`);
  }

  const invocationRoot = path.resolve(process.cwd());
  const consumerRoot = realpathSync.native(
    mkdtempSync(path.join(tmpdir(), "vite-rdt-packed-consumer-")),
  );
  const relativeToInvocationRoot = path.relative(invocationRoot, consumerRoot);
  if (
    relativeToInvocationRoot === "" ||
    (!relativeToInvocationRoot.startsWith("..") &&
      !path.isAbsolute(relativeToInvocationRoot))
  ) {
    throw new Error(
      `Packed consumer must be outside the invocation workspace: ${consumerRoot}`,
    );
  }

  try {
    writeFileSync(
      path.join(consumerRoot, "package.json"),
      JSON.stringify({
        name: "vite-rdt-runtime-compatibility",
        private: true,
        type: "module",
      }),
    );
    const npmInvocation = resolveNpmInvocation();
    run(
      npmInvocation.command,
      [
        ...npmInvocation.arguments_,
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `file:${packageArchive}`,
        `typescript@${typescriptVersion}`,
        `vite@${viteVersion}`,
      ],
      { cwd: consumerRoot, timeout: INSTALL_DEADLINE_MS },
    );

    const verificationFile = path.join(consumerRoot, "verify.mjs");
    writeFileSync(verificationFile, childSource);
    const result = run(process.execPath, [verificationFile], {
      cwd: consumerRoot,
      env: {
        ...process.env,
        VITE_RDT_RUNTIME_MODES: JSON.stringify(modes),
      },
      timeout: CHILD_DEADLINE_MS,
    });
    const output = result.stdout.trim();
    if (!output) throw new Error("Packed consumer produced no result");
    console.log(
      JSON.stringify({
        package: path.basename(packageArchive),
        result: JSON.parse(output.split(/\r?\n/).at(-1)),
        modes,
        typescript: typescriptVersion,
        vite: viteVersion,
      }),
    );
  } finally {
    rmSync(consumerRoot, { force: true, recursive: true });
  }
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}
