import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const script = fileURLToPath(import.meta.url);
const repo = path.resolve(path.dirname(script), "../../..");
const run = promisify(execFile);
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const names = ["First", "Second", "Other"];
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const normalize = (file) => file.replaceAll("\\", "/");
const under = (parent, child) => { const relative = path.relative(parent, child); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); };
const waitFor = async (predicate, message, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  do { if (await predicate()) return; await delay(25); } while (Date.now() < deadline);
  throw new Error("Timed out: " + message);
};
const semanticMetadata = (result) => {
  const code = typeof result === "string" ? result : result?.code ?? "";
  const match = code.match(/__docgenInfo\s*=\s*(\{[^\r\n]*\})/);
  if (!match) return null;
  const doc = JSON.parse(match[1]);
  return { displayName: doc.displayName, description: doc.description, props: Object.fromEntries(Object.entries(doc.props).sort(([a], [b]) => a.localeCompare(b)).map(([name, prop]) => [name, { name: prop.name, description: prop.description, required: prop.required, type: prop.type, defaultValue: prop.defaultValue }])) };
};
const options = (root, mode) => ({ docgenMode: mode, tsconfigPath: path.join(root, "tsconfig.json"), include: ["src/**/*.tsx"], exclude: [], fileSystemCache: false, shouldExtractLiteralValuesFromEnum: true });
const [operation, inputArgument, modeArgument, outputArgument] = process.argv.slice(2);

if (operation === "oracle") {
  const input = json(inputArgument);
  const require = createRequire(path.join(input.environment, "package.json"));
  const { default: createPlugin } = await import(pathToFileURL(require.resolve("@joshwooding/vite-plugin-react-docgen-typescript")).href);
  const plugin = createPlugin(options(input.root, input.mode));
  const docs = {};
  try {
    await plugin.configResolved({ root: input.root, command: "serve" });
    for (const name of names) {
      const file = path.join(input.root, "src", name + ".tsx");
      docs[name] = semanticMetadata(await plugin.transform.call({ addWatchFile() {}, warn(message) { throw new Error(String(message)); } }, readFileSync(file, "utf8"), file));
    }
  } finally { await plugin.closeBundle?.(); }
  writeJson(input.output, { processId: process.pid, root: input.root, mode: input.mode, cache: false, docs });
} else {
  assert.equal(operation, "row");
  const environment = realpathSync(inputArgument);
  const owned = process.platform === "win32" ? path.join(repo, ".yarn/simplification-evidence/034/boundary") : "/var/tmp/vite-rdt-plan034-boundary";
  assert(under(owned, environment), "Environment must be in owned boundary workspace");
  const mode = modeArgument;
  assert(["legacy", "project-service"].includes(mode));
  const output = path.resolve(outputArgument);
  assert(under(path.join(repo, "plans/034-evidence/boundary"), output));
  assert(!existsSync(output), "Refusing to overwrite row evidence");
  const require = createRequire(path.join(environment, "package.json"));
  const pluginEntry = require.resolve("@joshwooding/vite-plugin-react-docgen-typescript");
  const pluginRoot = path.resolve(path.dirname(pluginEntry), "..");
  const artifact = json(path.join(repo, "plans/033-evidence/compatibility/artifact.json"));
  const archiveSha256 = sha(path.join(repo, ".yarn/simplification-evidence/033/candidate.tgz"));
  assert.equal(archiveSha256, artifact.archiveSha256);
  const distFiles = Object.fromEntries(Object.keys(artifact.distFiles).map((file) => [file, sha(path.join(pluginRoot, "dist", file))]));
  assert.deepEqual(distFiles, artifact.distFiles, "Installed runtime must be exact033 dist");
  const versions = Object.fromEntries(["vite", "typescript", "react-docgen-typescript", "glob"].map((name) => [name, json(require.resolve(name + "/package.json")).version]));
  const family = versions.vite === "3.2.11" ? "lower" : "upper";
  assert.equal(versions.vite, family === "lower" ? "3.2.11" : "8.1.5");
  assert.equal(versions.typescript, family === "lower" ? "4.3.5" : "6.0.3");
  assert.equal(process.versions.node, family === "lower" ? "20.19.5" : "24.10.0");
  const packageHashes = Object.fromEntries(Object.keys(versions).map((name) => [name, sha(require.resolve(name + "/package.json"))]));
  const { default: createPlugin } = await import(pathToFileURL(pluginEntry).href);
  const vitePackage = path.dirname(require.resolve("vite/package.json"));
  const { createServer, normalizePath } = await import(pathToFileURL(path.join(vitePackage, "dist/node/index.js")).href);
  const fixtures = path.join(environment, "fixtures");
  mkdirSync(fixtures, { recursive: true });
  const fixture = realpathSync(mkdtempSync(path.join(fixtures, mode + "-")));
  assert(under(fixtures, fixture));
  if (process.platform === "linux") assert(!fixture.startsWith("/mnt/"), "Linux fixture must use Linux filesystem");
  const root = path.join(fixture, "app");
  const external = path.join(fixture, "shared-types");
  const sibling = path.join(fixture, "unrelated-sibling/nested");
  const control = path.join(root, "src/control.js");
  const first = path.join(external, "first.d.ts");
  const second = path.join(external, "second.ts");
  for (const directory of [path.dirname(control), path.join(external, "nested"), sibling]) mkdirSync(directory, { recursive: true });
  const noise = path.join(external, "nested/noise.txt");
  const siblingNoise = path.join(sibling, "noise.txt");
  writeFileSync(noise, "initial owned noise\n");
  writeFileSync(siblingNoise, "initial sibling noise\n");
  writeJson(path.join(root, "tsconfig.json"), { compilerOptions: { target: "ES2019", module: "ESNext", moduleResolution: "Node", jsx: "preserve", strict: true, skipLibCheck: true, types: [], ...(family === "upper" ? { ignoreDeprecations: "6.0" } : {}) }, include: ["src/**/*"] });
  for (const name of names) writeFileSync(path.join(root, "src", name + ".tsx"), name === "Other" ? 'export const Other = (_props: { unaffected: boolean }) => null;\nif (import.meta.hot) import.meta.hot.accept();\n' : `import type { Props } from '../../shared-types/${name.toLowerCase()}';\n/** ${name} component description. */\nexport const ${name} = (_props: Props) => null;\nif (import.meta.hot) import.meta.hot.accept();\n`);
  writeFileSync(control, "export const control = 1;\nif (import.meta.hot) import.meta.hot.accept();\n");
  const declaration = (label, type, optional, defaultValue) => `export interface Props {\n  /** ${label}\n   * @default ${defaultValue}\n   */\n  value${optional ? "?" : ""}: ${type};\n}\n`;
  const report = { status: "RUNNING", startedAt: new Date().toISOString(), command: [process.execPath, ...process.argv.slice(1)], environment, fixture, root, mode, family, node: process.versions.node, nodeSha256: sha(process.execPath), platform: process.platform, osRelease: os.release(), archiveSha256, distFiles, versions, packageHashes, lockfileSha256: sha(path.join(environment, "package-lock.json")), scriptSha256: sha(script), checkpoints: [] };
  let server;
  const events = [];
  const payloads = [];
  const docs = {};
  let transformCalls = 0;
  let configCalls = 0;
  let registrationCalls = 0;
  const watched = () => Object.fromEntries(Object.entries(server.watcher.getWatched()).map(([directory, files]) => [normalizePath(directory), [...files].sort()]));
  const census = () => Object.fromEntries(Object.entries(watched()).filter(([directory]) => directory === normalizePath(fixture) || directory.startsWith(normalizePath(fixture) + "/")));
  const readDocs = async () => { for (const name of names) await server.transformRequest(`/src/${name}.tsx`); return structuredClone(docs); };
  const oracle = async (label) => {
    const input = path.join(fixture, "oracle-" + label + ".input.json");
    const childOutput = path.join(fixture, "oracle-" + label + ".output.json");
    writeJson(input, { environment, root, mode, output: childOutput });
    const command = [process.execPath, script, "oracle", input];
    const result = await run(command[0], command.slice(1), { cwd: environment, windowsHide: true, timeout: 45000, maxBuffer: 2000000 });
    const value = json(childOutput);
    assert.notEqual(value.processId, process.pid);
    return { ...value, command, stdout: result.stdout, stderr: result.stderr };
  };
  const settle = async (minimum = 250) => { await delay(minimum); let size = payloads.length; const deadline = Date.now() + 2000; while (Date.now() < deadline) { await delay(100); if (payloads.length === size) return; size = payloads.length; } throw new Error("Payloads did not settle"); };
  try {
    const plugin = createPlugin(options(root, mode));
    const transform = plugin.transform;
    plugin.transform = async function (...args) { transformCalls++; const result = await transform.apply(this, args); const name = path.basename(args[1].split("?")[0], ".tsx"); if (names.includes(name)) docs[name] = semanticMetadata(result); return result; };
    const recipe = { name: "watch-external-types", apply: "serve", config() { configCalls++; if (!statSync(external).isDirectory()) throw new Error("externalTypesDirectory must be an existing directory"); }, configureServer(active) { server = active; registrationCalls++; report.transformsAtRegistration = transformCalls; report.scopeBefore = census(); active.watcher.add(normalizePath(external)); } };
    server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent", optimizeDeps: { noDiscovery: true }, plugins: [plugin, recipe], server: { middlewareMode: true } });
    report.configCalls = configCalls;
    report.registrationCalls = registrationCalls;
    assert.equal(configCalls, 1);
    assert.equal(registrationCalls, 1);
    assert.equal(report.transformsAtRegistration, 0);
    server.watcher.on("all", (event, file) => events.push({ event, file: normalizePath(file) }));
    const hot = server.environments?.client.hot ?? server.ws;
    const send = hot.send;
    hot.send = function (...args) { if (args[0] && typeof args[0] === "object") payloads.push(structuredClone(args[0])); return Reflect.apply(send, this, args); };
    report.initial = await readDocs();
    assert(report.initial.First && report.initial.Second && report.initial.Other);
    assert(!report.initial.First.props.value && !report.initial.Second.props.value);
    report.initialOracle = await oracle("initial");
    assert.deepEqual(report.initial, report.initialOracle.docs);
    await server.transformRequest("/src/control.js");
    await waitFor(() => (watched()[normalizePath(path.dirname(control))] ?? []).includes(path.basename(control)) && (watched()[normalizePath(path.dirname(noise))] ?? []).includes(path.basename(noise)), "root and explicit directory registration");
    await delay(150);
    writeFileSync(control, "export const control = 2;\nif (import.meta.hot) import.meta.hot.accept();\n");
    await waitFor(() => events.some((event) => event.event === "change" && event.file === normalizePath(control)), "native in-root control");
    await settle();
    report.control = { event: events.find((event) => event.event === "change" && event.file === normalizePath(control)), payloads: structuredClone(payloads) };
    report.scopeAfterRegistration = census();
    assert(!Object.keys(report.scopeAfterRegistration).some((directory) => directory === normalizePath(path.dirname(sibling)) || directory.startsWith(normalizePath(path.dirname(sibling)) + "/")), "Recipe recursively watched unrelated sibling");
    let priorDocs = structuredClone(report.initial);
    const mutations = [
      { phase: "create-first-dts", file: first, event: "add", component: "First", source: declaration("First created description.", "string", false, "alpha"), expected: { type: "string", required: true, description: "First created description.", defaultValue: "alpha" } },
      { phase: "create-second-ts", file: second, event: "add", component: "Second", source: declaration("Second created description.", "number", true, "12"), expected: { type: "number | undefined", required: false, description: "Second created description.", defaultValue: "12" } },
      { phase: "edit-first", file: first, event: "change", component: "First", source: declaration("First edited description.", "number", true, "42"), expected: { type: "number | undefined", required: false, description: "First edited description.", defaultValue: "42" } },
      { phase: "delete-first", file: first, event: "unlink", component: "First" },
      { phase: "recreate-first", file: first, event: "add", component: "First", source: declaration("First recreated description.", "boolean", false, "false"), expected: { type: "boolean", required: true, description: "First recreated description.", defaultValue: "false" } },
    ];
    for (const mutation of mutations) {
      const eventStart = events.length;
      const payloadStart = payloads.length;
      const checkpoint = { phase: mutation.phase, file: mutation.file, expectedEvent: mutation.event, expectedComponents: [`/src/${mutation.component}.tsx`] };
      report.checkpoints.push(checkpoint);
      if (mutation.source === undefined) rmSync(mutation.file); else writeFileSync(mutation.file, mutation.source);
      await waitFor(() => events.slice(eventStart).some((event) => event.event === mutation.event && event.file === normalizePath(mutation.file)), "native " + mutation.phase);
      checkpoint.oracle = await oracle(mutation.phase);
      const valueProp = checkpoint.oracle.docs[mutation.component]?.props.value;
      if (!mutation.expected) assert.equal(valueProp, undefined, "Deleted dependency must remove value prop");
      else {
        assert(valueProp, "Created dependency must supply value prop");
        assert.equal(valueProp.type.name, mutation.expected.type);
        assert.equal(valueProp.required, mutation.expected.required);
        assert.equal(valueProp.description, mutation.expected.description);
        assert.deepEqual(valueProp.defaultValue, { value: mutation.expected.defaultValue });
      }
      assert(!equal(priorDocs[mutation.component], checkpoint.oracle.docs[mutation.component]), "Oracle mutation was ineffective");
      for (const name of names.filter((name) => name !== mutation.component)) assert.deepEqual(checkpoint.oracle.docs[name], priorDocs[name], "Oracle unexpectedly changed " + name);
      await waitFor(async () => equal(await readDocs(), checkpoint.oracle.docs), "full metadata " + mutation.phase);
      await settle();
      checkpoint.metadata = structuredClone(docs);
      checkpoint.events = events.slice(eventStart);
      checkpoint.payloads = payloads.slice(payloadStart);
      checkpoint.deliveredPaths = checkpoint.payloads.filter((payload) => payload.type === "update").flatMap((payload) => payload.updates.map((update) => update.path));
      checkpoint.deliveredSet = [...new Set(checkpoint.deliveredPaths)].sort();
      assert.deepEqual(checkpoint.deliveredSet, checkpoint.expectedComponents);
      assert(!checkpoint.payloads.some((payload) => ["error", "full-reload"].includes(payload.type)));
      checkpoint.status = "PASS";
      priorDocs = structuredClone(docs);
    }
    report.noise = [];
    for (const [label, file, expectedEvent] of [["owned-descendant", noise, true], ["unrelated-sibling", siblingNoise, false]]) {
      const eventStart = events.length;
      const payloadStart = payloads.length;
      writeFileSync(file, "changed " + label + "\n");
      if (expectedEvent) await waitFor(() => events.slice(eventStart).some((event) => event.file === normalizePath(file)), "owned noise control");
      await settle(350);
      const observation = { label, events: events.slice(eventStart), payloads: payloads.slice(payloadStart) };
      assert.equal(observation.events.some((event) => event.file === normalizePath(file)), expectedEvent);
      assert(!observation.payloads.some((payload) => ["update", "full-reload", "error"].includes(payload.type)));
      assert.deepEqual(await readDocs(), priorDocs);
      report.noise.push(observation);
    }
    report.finalScope = census();
    assert(!Object.keys(report.finalScope).some((directory) => directory === normalizePath(path.dirname(sibling)) || directory.startsWith(normalizePath(path.dirname(sibling)) + "/")));
    report.status = "PASS";
  } catch (error) { report.status = "FAIL"; report.error = String(error.stack ?? error); }
  finally {
    try {
      if (server) {
        await server.close();
        const eventStart = events.length;
        const payloadStart = payloads.length;
        writeFileSync(control, "export const control = 99;\n");
        writeFileSync(noise, "after close\n");
        await delay(300);
        report.close = { closed: server.watcher.closed === true, watchedDirectories: Object.keys(server.watcher.getWatched()).length, postCloseEvents: events.length - eventStart, postClosePayloads: payloads.length - payloadStart };
        assert.deepEqual(report.close, { closed: true, watchedDirectories: 0, postCloseEvents: 0, postClosePayloads: 0 });
      }
    } catch (error) { report.status = "FAIL"; report.closeError = String(error.stack ?? error); }
    report.completedAt = new Date().toISOString();
    report.distUnchangedAfter = Object.keys(artifact.distFiles).every((file) => sha(path.join(pluginRoot, "dist", file)) === artifact.distFiles[file]);
    if (!report.distUnchangedAfter) report.status = "FAIL";
    writeJson(output, report);
    // Preserve fixtures and oracle files as ignored evidence; no recursive removal.
  }
  console.log(JSON.stringify({ output, status: report.status, checkpoints: report.checkpoints.length, error: report.error, close: report.close }));
  process.exitCode = report.status === "PASS" ? 0 : 1;
}
