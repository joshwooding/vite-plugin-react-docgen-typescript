import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const script = fileURLToPath(import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const deadline = async (promise, label, ms = 10_000) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const removeOwned = (directory, parent) => {
  const relative = path.relative(realpathSync(parent), realpathSync(directory));
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  rmSync(directory, { force: true, recursive: true });
};
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

if (process.argv[2] === "--child") {
  const { default: plugin } = await import(
    "@joshwooding/vite-plugin-react-docgen-typescript"
  );
  const { createServer, normalizePath } = await import("vite");
  const commonRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "vite-rdt-native-lower-")),
  );
  const root = path.join(commonRoot, "apps/storybook");
  const library = path.join(commonRoot, "library");
  const source = path.join(library, "src");
  mkdirSync(root, { recursive: true });
  mkdirSync(source, { recursive: true });
  const props = path.join(source, "props.ts");
  const component = path.join(source, "Dependent.tsx");
  const unrelated = path.join(source, "Unrelated.tsx");
  const compilerOptions = {
    jsx: "preserve",
    module: "ESNext",
    moduleResolution: "Node",
    skipLibCheck: true,
    target: "ES2019",
  };
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions,
      files: [],
      references: [{ path: "../../library/tsconfig.build.json" }],
    }),
  );
  writeFileSync(
    path.join(library, "tsconfig.build.json"),
    JSON.stringify({
      compilerOptions: { ...compilerOptions, composite: true },
      include: ["src/**/*"],
    }),
  );
  const propsSource = (phase) =>
    `export interface ImportedProps { /** ${phase} tone. */\n tone: "base" | "${phase}"; }\n`;
  writeFileSync(props, propsSource("initial"));
  writeFileSync(
    component,
    `declare namespace JSX { interface Element {} }\nimport { ImportedProps } from "./props";\nexport const Dependent = ({ tone: _tone }: ImportedProps): JSX.Element => null as unknown as JSX.Element;\nif (import.meta.hot) import.meta.hot.accept();\n`,
  );
  writeFileSync(
    unrelated,
    `declare namespace JSX { interface Element {} }\nexport const Unrelated = ({ value: _value }: { value: string }): JSX.Element => null as unknown as JSX.Element;\nif (import.meta.hot) import.meta.hot.accept();\n`,
  );
  const url = (file) => `/@fs/${normalizePath(file)}`;
  const sameFile = (left, right) =>
    normalizePath(left).toLowerCase() === normalizePath(right).toLowerCase();
  const metadata = (code) => {
    const match = code?.match(/__docgenInfo\s*=\s*(\{[\s\S]*?\});/);
    assert(match?.[1], "Expected docgen metadata");
    const info = runInNewContext(`(${match[1]})`, Object.create(null), {
      timeout: 1_000,
    });
    return {
      description: info.props?.tone?.description ?? null,
      values: (info.props?.tone?.type?.value ?? [])
        .map(({ value }) => value.replace(/^"|"$/g, ""))
        .sort(),
    };
  };
  let server;
  let capture;
  const results = [];
  let primaryError;
  try {
    server = await deadline(
      createServer({
        configFile: false,
        appType: "custom",
        logLevel: "silent",
        root,
        optimizeDeps: { disabled: true, noDiscovery: true },
        plugins: [
          plugin({
            EXPERIMENTAL_useWatchProgram: true,
            exclude: [],
            include: ["../../library/**/*.tsx"],
            shouldExtractValuesFromUnion: true,
            tsconfigPath: "tsconfig.json",
          }),
        ],
        server: {
          middlewareMode: true,
          fs: { allow: [commonRoot] },
          watch: {},
        },
      }),
      "server creation",
    );
    const originalSend = server.ws.send;
    server.ws.send = function (...args) {
      if (capture && args[0] && typeof args[0] === "object") {
        capture.payloads.push(args[0]);
        if (["update", "full-reload", "error"].includes(args[0].type))
          capture.resolveHot();
      }
      return Reflect.apply(originalSend, this, args);
    };
    for (const event of ["add", "change", "unlink"])
      server.watcher.on(event, (file) => {
        if (capture && sameFile(file, props)) {
          capture.events.push({ event, file });
          if (event === capture.expected) capture.resolveEvent();
        }
      });
    const initial = metadata(
      (
        await deadline(
          server.transformRequest(url(component)),
          "initial transform",
        )
      )?.code,
    );
    assert(initial.values.includes("initial"));
    await deadline(
      server.transformRequest(url(unrelated)),
      "unrelated transform",
    );
    const waitRegistration = async () => {
      const start = Date.now();
      while (
        !Object.entries(server.watcher.getWatched()).some(
          ([directory, names]) =>
            sameFile(directory, path.dirname(props)) &&
            names.includes(path.basename(props)),
        )
      ) {
        assert(
          Date.now() - start < 10_000,
          "External dependency never registered with native watcher",
        );
        await delay(20);
      }
      await delay(150);
    };
    await waitRegistration();
    const cycle = async (phase, expected, mutate) => {
      let resolveEvent;
      let resolveHot;
      const eventPromise = new Promise((resolve) => {
        resolveEvent = resolve;
      });
      const hotPromise = new Promise((resolve) => {
        resolveHot = resolve;
      });
      capture = {
        phase,
        expected,
        events: [],
        payloads: [],
        resolveEvent,
        resolveHot,
      };
      mutate();
      await deadline(eventPromise, `${phase} native ${expected}`);
      await deadline(hotPromise, `${phase} hot delivery`);
      const current = metadata(
        (
          await deadline(
            server.transformRequest(url(component)),
            `${phase} transform`,
          )
        )?.code,
      );
      if (phase === "deleted")
        assert(
          !current.values.includes("edited"),
          "Deletion retained stale metadata",
        );
      else
        assert(
          current.values.includes(phase),
          `${phase} metadata stale: ${JSON.stringify(current)}`,
        );
      assert(
        !capture.payloads.some(({ type }) =>
          ["error", "full-reload"].includes(type),
        ),
        "Unexpected reload/error",
      );
      const updates = capture.payloads
        .filter(({ type }) => type === "update")
        .flatMap(({ updates }) => updates);
      const matches = (value, target) =>
        value && sameFile(value.split("?")[0], url(target));
      assert.equal(
        updates.filter(
          ({ acceptedPath, path: updatePath }) =>
            matches(acceptedPath, component) || matches(updatePath, component),
        ).length,
        1,
        "Dependent delivery was not exact",
      );
      assert.equal(
        updates.filter(
          ({ acceptedPath, path: updatePath }) =>
            matches(acceptedPath, unrelated) || matches(updatePath, unrelated),
        ).length,
        0,
        "Unrelated component was delivered",
      );
      results.push({
        phase,
        events: capture.events,
        payloads: capture.payloads,
        metadata: current,
      });
      capture = undefined;
    };
    await cycle("edited", "change", () =>
      writeFileSync(props, propsSource("edited")),
    );
    await delay(150);
    await cycle("deleted", "unlink", () => rmSync(props));
    await delay(150);
    await cycle("recreated", "add", () =>
      writeFileSync(props, propsSource("recreated")),
    );
    await waitRegistration();
    await cycle("final", "change", () =>
      writeFileSync(props, propsSource("final")),
    );
  } catch (error) {
    primaryError = error;
    console.error(`PRIMARY_NATIVE_ERROR: ${error.stack ?? error}`);
  } finally {
    capture = undefined;
    try {
      if (server) await deadline(server.close(), "server close");
    } catch (error) {
      console.error(`NATIVE_CLOSE_ERROR: ${error.stack ?? error}`);
      primaryError ??= error;
    }
    removeOwned(commonRoot, tmpdir());
  }
  const handles = () =>
    process
      ._getActiveHandles()
      .filter((handle) =>
        ["FSWatcher", "StatWatcher"].includes(handle.constructor?.name),
      );
  for (let i = 0; i < 400 && handles().length; i++) await delay(25);
  assert.equal(handles().length, 0, "Watcher handles remain");
  console.log(
    JSON.stringify({
      status: primaryError ? "FAIL" : "PASS",
      node: process.versions.node,
      platform: process.platform,
      results,
      watcherHandles: handles().length,
      primaryError: primaryError?.message ?? null,
    }),
  );
  if (primaryError) process.exitCode = 1;
} else {
  assert.equal(process.platform, "win32");
  assert.equal(process.versions.node, "20.19.5");
  const archive = process.argv[2];
  assert(path.isAbsolute(archive));
  const evidence = path.join(path.dirname(script), "compatibility/native");
  const expected = JSON.parse(
    readFileSync(path.join(path.dirname(script), "compatibility/artifact.json"), "utf8"),
  );
  assert.equal(hash(archive), expected.archiveSha256);
  const consumer = realpathSync(
    mkdtempSync(path.join(tmpdir(), "vite-rdt-native-consumer-")),
  );
  const npm = path.join(
    path.dirname(process.execPath),
    "node_modules/npm/bin/npm-cli.js",
  );
  const record = {
    startedAt: new Date().toISOString(),
    archiveSha256: hash(archive),
    scriptSha256: hash(script),
    node: process.versions.node,
    platform: process.platform,
    status: "FAIL",
  };
  try {
    writeFileSync(
      path.join(consumer, "package.json"),
      JSON.stringify({
        name: "plan033-native-lower",
        private: true,
        type: "module",
      }),
    );
    const installed = spawnSync(
      process.execPath,
      [
        npm,
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `file:${archive}`,
        "typescript@4.3.5",
        "vite@3.2.11",
      ],
      { cwd: consumer, encoding: "utf8", windowsHide: true, timeout: 180_000 },
    );
    assert.equal(installed.status, 0, installed.stderr);
    const modules = path.join(consumer, "node_modules");
    record.versions = Object.fromEntries(
      [
        "typescript",
        "vite",
        "react-docgen-typescript",
        "@joshwooding/vite-plugin-react-docgen-typescript",
      ].map((name) => [
        name,
        JSON.parse(
          readFileSync(path.join(modules, name, "package.json"), "utf8"),
        ).version,
      ]),
    );
    assert.equal(record.versions.typescript, "4.3.5");
    assert.equal(record.versions.vite, "3.2.11");
    assert.equal(record.versions["react-docgen-typescript"], "2.4.0");
    for (const [file, digest] of Object.entries(expected.distFiles))
      assert.equal(
        hash(
          path.join(
            modules,
            "@joshwooding/vite-plugin-react-docgen-typescript/dist",
            file,
          ),
        ),
        digest,
      );
    const child = path.join(consumer, "native.mjs");
    copyFileSync(script, child);
    const run = spawnSync(process.execPath, [child, "--child"], {
      cwd: consumer,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
    });
    writeFileSync(
      path.join(evidence, "native-lower-stdout.txt"),
      run.stdout ?? "",
    );
    writeFileSync(
      path.join(evidence, "native-lower-stderr.txt"),
      run.stderr ?? "",
    );
    record.exitCode = run.status;
    record.error = run.error?.message ?? null;
    record.result = JSON.parse(run.stdout.trim().split(/\r?\n/).at(-1));
    assert.equal(run.status, 0, run.stderr);
    assert.equal(record.result.status, "PASS");
    assert.deepEqual(
      record.result.results.map(({ phase }) => phase),
      ["edited", "deleted", "recreated", "final"],
    );
    record.status = "PASS";
  } catch (error) {
    record.validationError = error.message;
    process.exitCode = 1;
  } finally {
    removeOwned(consumer, tmpdir());
    record.completedAt = new Date().toISOString();
    writeFileSync(
      path.join(evidence, "native-lower.json"),
      `${JSON.stringify(record, null, 2)}\n`,
    );
    console.log(JSON.stringify(record));
  }
}
