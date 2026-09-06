import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { child, config, dist, equal, evidence, filesUnder, identity, json, metadata, modes, observeExtractions, options, raw, removeFixture, require, writeJson } from "./common.mjs";

const script = fileURLToPath(import.meta.url);
const windowMs = 5000;
const normalized = (f) => path.resolve(f).replaceAll("\\", "/");

async function observe(manifest) {
  const extractionCount = observeExtractions();
  const { root, mode, cache, action } = manifest;
  process.chdir(root);
  const { default: pluginFactory } = await import(pathToFileURL(dist).href);
  const plugin = pluginFactory(options(root, mode, cache));
  if (action === "oracle") {
    try {
      await plugin.configResolved({ command: "serve", root });
      const file = path.join(root, "src/Component.tsx");
      const result = await plugin.transform.call({ addWatchFile() {}, warn(m) { throw new Error(String(m)); } }, readFileSync(file, "utf8"), file);
      return { pid: process.pid, root, metadata: metadata(result) };
    } finally { await plugin.closeBundle?.(); }
  }
  const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
  const external = path.resolve(root, "../shared/types.d.ts");
  const control = path.join(root, "src/control.js");
  const registeredWatchFiles = [];
  const transforms = [];
  const originalTransform = plugin.transform;
  plugin.transform = async function(...args) {
    const context = new Proxy(this, { get(target, key) {
      if (key === "addWatchFile") return (file) => { registeredWatchFiles.push(normalized(file)); return target.addWatchFile(file); };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await originalTransform.apply(context, args);
    if (normalized(args[1].split("?")[0]) === normalized(path.join(root, "src/Component.tsx"))) transforms.push(metadata(result));
    return result;
  };
  const events = [];
  const hotHooks = [];
  const observer = { name: "plan024-observer", hotUpdate({ file, type }) { hotHooks.push({ file: normalized(file), type }); } };
  const server = await createServer({
    root, configFile: false, appType: "custom", logLevel: "silent",
    optimizeDeps: { noDiscovery: true }, plugins: [plugin, observer],
    server: { middlewareMode: true, fs: { allow: [path.dirname(root)] } },
  });
  server.watcher.on("all", (event, file) => events.push({ event, file: normalized(file) }));
  try {
    // An ordinary request loads the module graph; no dependency is added to the watcher by this probe.
    const initialResponse = await server.transformRequest("/src/Component.tsx");
    const initial = transforms.at(-1);
    if (initial?.props?.label?.type?.name !== "string") throw new Error("Invalid initial watcher fixture");
    const initialRegisteredWatchFiles = [...registeredWatchFiles];
    const initialExtractions = extractionCount();
    if (action === "seed") return { pid: process.pid, root, initial };
    const persistedHit = initialExtractions === 0;
    if (cache && !persistedHit) throw new Error("Validated persistent startup repeated metadata extraction");
    await server.transformRequest("/src/control.js");
    // The compiler can finish before Chokidar's initial root scan. Wait for real registration.
    const readyDeadline = Date.now() + windowMs;
    const containsControl = () => {
      const watched = server.watcher.getWatched();
      return (watched[normalized(path.dirname(control))] ?? watched[path.dirname(control)] ?? []).includes(path.basename(control));
    };
    while (!containsControl() && Date.now() < readyDeadline) await delay(25);
    if (!containsControl()) throw new Error("In-root watcher registration did not become ready");
    await delay(150);
    const watcherReady = server.watcher.getWatched();
    // The positive control is a real in-root edit on the very same watcher.
    writeFileSync(control, "export const control = 2;\nif (import.meta.hot) import.meta.hot.accept();\n");
    const controlDeadline = Date.now() + windowMs;
    while (!events.some((e) => e.file === normalized(control) && e.event === "change") && Date.now() < controlDeadline) await delay(25);
    if (!events.some((e) => e.file === normalized(control) && e.event === "change")) throw new Error("In-root watcher positive control failed");
    await delay(100);
    writeFileSync(external, "export interface Props { label: number }\n");
    await delay(windowMs);
    const afterResponse = await server.transformRequest("/src/Component.tsx");
    return {
      pid: process.pid, root, initial, after: transforms.at(-1), transformCount: transforms.length,
      initialExtractions, persistedHit, initialRegisteredWatchFiles,
      windowMs,
      watchedExternalAtStartup: (watcherReady[normalized(path.dirname(external))] ?? watcherReady[path.dirname(external)] ?? []).includes(path.basename(external)),
      controlEvents: events.filter((e) => e.file === normalized(control)),
      externalEvents: events.filter((e) => e.file === normalized(external)),
      controlHotHooks: hotHooks.filter((e) => e.file === normalized(control)),
      externalHotHooks: hotHooks.filter((e) => e.file === normalized(external)),
      responseUnchanged: initialResponse.code === afterResponse.code,
    };
  } finally { await server.close(); }
}

async function main() {
  mkdirSync(raw, { recursive: true });
  const evaluated = await identity();
  const rows = [];
  for (const mode of modes) for (const startup of ["fresh", "validated-persistent"]) {
    const fixture = mkdtempSync(path.join(raw, "watcher-" + mode + "-" + startup + "-"));
    const root = path.join(fixture, "app");
    try {
      mkdirSync(path.join(root, "src"), { recursive: true });
      mkdirSync(path.join(fixture, "shared"), { recursive: true });
      const cfg = config();
      cfg.include.push("../shared/**/*.d.ts");
      writeJson(path.join(root, "tsconfig.json"), cfg);
      writeFileSync(path.join(root, "src/Component.tsx"), "import type { Props } from '../../shared/types';\nexport const Component = (_props: Props) => null;\nif (import.meta.hot) import.meta.hot.accept();\n");
      writeFileSync(path.join(root, "src/control.js"), "export const control = 1;\nif (import.meta.hot) import.meta.hot.accept();\n");
      writeFileSync(path.join(fixture, "shared/types.d.ts"), "export interface Props { label: string }\n");
      const cache = startup === "validated-persistent";
      const seed = cache ? await child(script, { root, mode, cache, action: "seed" }, mode + "-" + startup + "-seed") : null;
      const cacheEntries = cache ? filesUnder(path.join(root, ".cache")).length : 0;
      if (cache && !cacheEntries) throw new Error("Missing watcher seed cache");
      const observed = await child(script, { root, mode, cache, action: "observe" }, mode + "-" + startup + "-observe");
      if (!observed.watchedExternalAtStartup || !observed.externalEvents.some((event) => event.event === "change") || !observed.externalHotHooks.length || !observed.controlEvents.length || !observed.controlHotHooks.length) throw new Error("Missing actual watcher registration/event/hot hook: " + mode + "/" + startup);
      const oracle = await child(script, { root, mode, cache: false, action: "oracle" }, mode + "-" + startup + "-oracle");
      if (equal(observed.initial, oracle.metadata) || oracle.metadata?.props?.label?.type?.name !== "number") throw new Error("Ineffective external declaration edit");
      const processes = [observed.pid, oracle.pid, ...(seed ? [seed.pid] : [])];
      if (new Set(processes).size !== processes.length || observed.root !== oracle.root || (seed && seed.root !== observed.root)) throw new Error("Watcher process/path isolation failed");
      const row = { mode, startup, cacheEntries, seed, observed, oracle, status: equal(observed.after, oracle.metadata) ? "PASS" : "STALE_METADATA" };
      rows.push(row);
      console.log(mode + "/" + startup + ": " + row.status + ", external events=" + observed.externalEvents.length + ", control events=" + observed.controlEvents.length);
    } finally { removeFixture(fixture); }
  }
  if (!equal(evaluated, await identity())) throw new Error("Evaluated identity changed during watcher probes");
  const report = { schemaVersion: 1, identity: evaluated, rows, verdict: rows.some((r) => r.status === "STALE_METADATA") ? "CORRECTNESS_GAP" : "PASS" };
  writeJson(path.join(evidence, "watcher-results.json"), report);
  if (report.verdict === "CORRECTNESS_GAP") process.exitCode = 1;
}
if (process.argv[2] === "--child") {
  const manifest = json(process.argv[3]);
  writeJson(manifest.output, await observe(manifest));
} else await main();
