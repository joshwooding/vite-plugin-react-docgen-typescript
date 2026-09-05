// Decision-only prototype. The production plugin is loaded unchanged.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { child, config, dist, equal, evidence, filesUnder, identity, json, metadata, modes, observeExtractions, options, raw, removeFixture, writeJson } from "./common.mjs";
import { createRequire } from "node:module";

const require = createRequire(dist);
const countExtractions = observeExtractions();
const { default: createPlugin } = await import(pathToFileURL(dist).href);
const { createServer, normalizePath } = await import(pathToFileURL(require.resolve("vite")).href);
const script = fileURLToPath(import.meta.url);
const waitFor = async (predicate, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  while (!(await predicate()) && Date.now() < deadline) await delay(25);
  return predicate();
};
const assert = (value, message) => { if (!value) throw new Error(message); };
const componentSource = (name, specifier) => `import type { Props } from '${specifier}';\nexport const ${name} = (_props: Props) => null;\nif (import.meta.hot) import.meta.hot.accept();\n`;
const declaration = (type) => `export interface Props { label: ${type} }\n`;
const extensions = [".ts", ".tsx", ".mts", ".cts", ".d.ts", ".js", ".jsx", ".mjs", ".cjs"];
const candidatesFor = (base) => extensions.flatMap(extension => [base + extension, path.join(base, "index" + extension)]);
const watched = (server) => Object.fromEntries(Object.entries(server.watcher.getWatched()).map(([directory, names]) => [normalizePath(directory), [...names].sort()]));
const census = (server, fixture) => {
  const entries = Object.entries(watched(server)).filter(([directory]) => directory === normalizePath(fixture) || directory.startsWith(normalizePath(fixture) + "/"));
  return { directories: entries.map(([directory]) => path.relative(fixture, directory).replaceAll("\\", "/") || "."), entryCount: entries.reduce((total, [, names]) => total + names.length, 0), entries: Object.fromEntries(entries.map(([directory, names]) => [path.relative(fixture, directory).replaceAll("\\", "/") || ".", names])) };
};

if (process.argv[2] === "--child") {
  const input = json(process.argv[3]);
  const plugin = createPlugin(options(input.root, input.mode, input.cache));
  const docs = {};
  let seedServer;
  try {
    if (input.cache) {
      const transform = plugin.transform;
      plugin.transform = async function (...args) {
        const result = await transform.apply(this, args);
        docs[path.basename(args[1].split("?")[0], ".tsx")] = metadata(result);
        return result;
      };
      seedServer = await createServer({ root: input.root, configFile: false, appType: "custom", logLevel: "silent", optimizeDeps: { noDiscovery: true }, plugins: [plugin], server: { middlewareMode: true, fs: { allow: [path.dirname(input.root)] } } });
    } else await plugin.configResolved({ command: "serve", root: input.root });
    for (const name of ["Component", "Second", "Other"]) {
      const file = path.join(input.root, "src", name + ".tsx");
      if (seedServer) await seedServer.transformRequest(`/src/${name}.tsx`);
      else docs[name] = metadata(await plugin.transform.call({ addWatchFile() {}, warn(message) { throw new Error(String(message)); } }, readFileSync(file, "utf8"), file));
    }
  } finally { if (seedServer) await seedServer.close(); else await plugin.closeBundle?.(); }
  writeJson(input.output, { processId: process.pid, docs, extractions: countExtractions() });
} else {
  const policy = process.argv[2] ?? "baseline";
  assert(["baseline", "exact-candidates", "parent"].includes(policy), "Unknown prototype policy");
  const beforeIdentity = await identity();
  const rows = [];
  for (const mode of modes) for (const cacheState of ["off", "seed-absent", "offline-delete"]) {
    const fixture = mkdtempSync(path.join(raw, "missing-"));
    const root = path.join(fixture, "app");
    // Alternate rows place the imported declarations at a repository-level parent.
    const parent = cacheState === "offline-delete" ? fixture : path.join(fixture, "shared");
    const imports = [path.join(parent, "types"), path.join(parent, "other")];
    const components = ["Component", "Second", "Other"];
    const control = path.join(root, "src/control.js");
    const cache = cacheState !== "off";
    mkdirSync(path.dirname(control), { recursive: true });
    mkdirSync(parent, { recursive: true });
    writeJson(path.join(root, "tsconfig.json"), config());
    for (let index = 0; index < 2; index++) {
      const specifier = path.relative(path.dirname(control), imports[index]).replaceAll("\\", "/");
      writeFileSync(path.join(root, "src", components[index] + ".tsx"), componentSource(components[index], specifier));
    }
    writeFileSync(path.join(root, "src/Other.tsx"), "export const Other = (_props: { unaffected: boolean }) => null;\nif (import.meta.hot) import.meta.hot.accept();\n");
    writeFileSync(control, "export const value = 1;\nif (import.meta.hot) import.meta.hot.accept();\n");
    // Explicit unrelated descendants measure scope, not elapsed-time performance.
    for (let directory = 0; directory < 12; directory++) {
      const nested = path.join(parent, "unrelated", "package-" + directory, "nested");
      mkdirSync(nested, { recursive: true });
      for (let file = 0; file < 8; file++) writeFileSync(path.join(nested, "file-" + file + ".txt"), "unrelated\n");
    }
    const events = [];
    const payloads = [];
    const docs = {};
    const row = { policy, mode, cacheState, parentKind: parent === fixture ? "repository" : "shared-directory", prototypeOnly: policy !== "baseline", checkpoints: [] };
    let server;
    try {
      if (cache) {
        if (cacheState === "offline-delete") for (const base of imports) writeFileSync(base + ".d.ts", declaration("string"));
        row.seed = await child(script, { root, mode, cache: true }, `${policy}-${mode}-${cacheState}-seed`);
        assert(row.seed.processId !== process.pid, "Seed was not a separate process");
        assert(filesUnder(path.join(root, ".cache")).length > 0, "No persistent seed entries");
        if (cacheState === "offline-delete") for (const base of imports) rmSync(base + ".d.ts");
      }
      const plugin = createPlugin(options(root, mode, cache));
      const originalTransform = plugin.transform;
      plugin.transform = async function (...args) {
        const result = await originalTransform.apply(this, args);
        const name = path.basename(args[1].split("?")[0], ".tsx");
        if (components.includes(name)) docs[name] = metadata(result);
        return result;
      };
      server = await createServer({ root, configFile: false, appType: "custom", logLevel: "silent", optimizeDeps: { noDiscovery: true }, plugins: [plugin], server: { middlewareMode: true, fs: { allow: [fixture] } } });
      server.watcher.on("all", (event, file) => events.push({ event, file: normalizePath(file) }));
      const hot = server.environments?.client.hot ?? server.ws;
      const originalSend = hot.send;
      hot.send = function (...args) {
        if (args[0] && typeof args[0] === "object") payloads.push(args[0]);
        return Reflect.apply(originalSend, this, args);
      };
      const beforeCount = countExtractions();
      for (const name of components) await server.transformRequest(`/src/${name}.tsx`);
      row.initialExtractions = countExtractions() - beforeCount;
      row.initial = structuredClone(docs);
      assert(docs.Component && docs.Second && !docs.Component.props.label && !docs.Second.props.label, "Invalid initially missing fixture");
      if (cacheState === "seed-absent") assert(row.initialExtractions === 0, "Seeded absent entries were not true persistent hits");
      await server.transformRequest("/src/control.js");
      assert(await waitFor(() => (watched(server)[normalizePath(path.dirname(control))] ?? []).includes(path.basename(control))), "In-root control not watched");
      await delay(150);
      writeFileSync(control, "export const value = 2;\nif (import.meta.hot) import.meta.hot.accept();\n");
      assert(await waitFor(() => events.some(event => event.event === "change" && event.file === normalizePath(control))), "No real in-root control change");
      row.beforeWatch = census(server, fixture);
      if (policy === "exact-candidates") server.watcher.add(imports.flatMap(candidatesFor).map(normalizePath));
      if (policy === "parent") server.watcher.add(normalizePath(parent));
      if (policy === "parent") assert(await waitFor(() => Object.keys(watched(server)).some(directory => directory.endsWith("unrelated/package-11/nested"))), "Parent prototype did not finish descendant registration");
      await delay(250);
      row.afterWatch = census(server, fixture);
      row.addedDirectories = row.afterWatch.directories.filter(directory => !row.beforeWatch.directories.includes(directory));
      row.addedEntries = row.afterWatch.entryCount - row.beforeWatch.entryCount;
      const extension = cacheState === "offline-delete" ? ".ts" : ".d.ts";
      // Distinct unresolved names sharing one parent must each deliver their own event.
      for (let index = 0; index < 2; index++) {
        const file = imports[index] + extension;
        const eventStart = events.length;
        const payloadStart = payloads.length;
        writeFileSync(file, declaration("number"));
        const receivedEvent = await waitFor(() => events.slice(eventStart).some(event => event.event === "add" && event.file === normalizePath(file)));
        await delay(100);
        const oracle = await child(script, { root, mode, cache: false }, `${policy}-${mode}-${cacheState}-create-${index}-oracle`);
        assert(oracle.docs[components[index]]?.props.label?.type.name === "number", "Ineffective creation oracle");
        const fresh = await waitFor(async () => { for (const name of components) await server.transformRequest(`/src/${name}.tsx`); return equal(docs, oracle.docs); }, receivedEvent ? 5000 : 1);
        const cyclePayloads = payloads.slice(payloadStart);
        row.checkpoints.push({ phase: "create-" + components[index], receivedEvent, fresh, metadata: structuredClone(docs), oracle, payloads: cyclePayloads, status: receivedEvent && fresh ? "PASS" : "FAIL" });
      }
      if (row.checkpoints.every(checkpoint => checkpoint.status === "PASS")) {
        for (const phase of ["delete", "recreate", "edit"]) {
          const file = imports[0] + extension;
          const eventStart = events.length;
          const payloadStart = payloads.length;
          if (phase === "delete") rmSync(file);
          else { await delay(150); writeFileSync(file, declaration(phase === "recreate" ? "boolean" : "string")); }
          const eventType = phase === "delete" ? "unlink" : phase === "recreate" ? "add" : "change";
          const receivedEvent = await waitFor(() => events.slice(eventStart).some(event => event.event === eventType && event.file === normalizePath(file)));
          const oracle = await child(script, { root, mode, cache: false }, `${policy}-${mode}-${cacheState}-${phase}-oracle`);
          const fresh = await waitFor(async () => { for (const name of components) await server.transformRequest(`/src/${name}.tsx`); return equal(docs, oracle.docs); }, receivedEvent ? 5000 : 1);
          row.checkpoints.push({ phase, receivedEvent, fresh, metadata: structuredClone(docs), oracle, payloads: payloads.slice(payloadStart), status: receivedEvent && fresh ? "PASS" : "FAIL" });
        }
      }
      const unrelated = path.join(parent, "unrelated/package-0/nested/file-0.txt");
      const unrelatedStart = events.length;
      const unrelatedPayloadStart = payloads.length;
      writeFileSync(unrelated, "unrelated changed\n");
      const unrelatedEvent = await waitFor(() => events.slice(unrelatedStart).some(event => event.event === "change" && event.file === normalizePath(unrelated)), policy === "parent" ? 5000 : 300);
      await delay(100);
      row.unrelated = { receivedEvent: unrelatedEvent, payloads: payloads.slice(unrelatedPayloadStart) };
      for (const checkpoint of row.checkpoints) {
        checkpoint.deliveredPaths = checkpoint.payloads.filter(payload => payload.type === "update").flatMap(payload => payload.updates.map(update => update.path));
        checkpoint.fullReloads = checkpoint.payloads.filter(payload => payload.type === "full-reload").length;
        checkpoint.unrelatedDelivery = checkpoint.deliveredPaths.includes("/src/Other.tsx");
        const expected = checkpoint.phase === "create-Second" ? "/src/Second.tsx" : "/src/Component.tsx";
        checkpoint.deliveredExpected = checkpoint.deliveredPaths.includes(expected);
        if (!checkpoint.deliveredExpected || checkpoint.fullReloads || checkpoint.unrelatedDelivery) checkpoint.status = "FAIL";
      }
      row.status = row.checkpoints.every(checkpoint => checkpoint.status === "PASS") && (!row.unrelated.payloads.some(payload => payload.type === "full-reload" || payload.type === "update" || payload.type === "error")) ? "PASS" : "FAIL";
    } catch (error) { row.status = "ERROR"; row.error = String(error.stack ?? error); }
    finally {
      if (server) {
        await server.close();
        row.closed = server.watcher.closed === true;
        row.watchedDirectoriesAfterClose = Object.keys(server.watcher.getWatched()).length;
        const eventCount = events.length;
        writeFileSync(control, "export const value = 3;\n");
        await delay(100);
        row.postCloseEvents = events.length - eventCount;
        if (!row.closed || row.watchedDirectoriesAfterClose || row.postCloseEvents) row.status = "ERROR";
      }
      rows.push(row);
      removeFixture(fixture);
    }
    console.log(`${policy}/${mode}/${cacheState}: ${row.status}, added directories=${row.addedDirectories?.length}, entries=${row.addedEntries}`);
  }
  assert(equal(beforeIdentity, await identity()), "Source/build identity changed during probe");
  const result = { policy, identity: beforeIdentity, rows, verdict: rows.every(row => row.status === "PASS") ? "PASS" : "FAIL" };
  writeJson(path.join(evidence, `${policy}-results.json`), result);
  if (result.verdict !== "PASS") process.exitCode = 1;
}
