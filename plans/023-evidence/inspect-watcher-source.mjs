// Reads primary installed source. It never invokes watcher internals.
import { readFileSync } from "node:fs";
import path from "node:path";
import { evidence, filesUnder, hash, writeJson } from "./common.mjs";

const inputs = process.argv.slice(2);
if (!inputs.length) throw new Error("Pass one or more installed Vite package directories");
const rows = inputs.map((root) => {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const declaration = path.join(root, "dist/node/index.d.ts");
  const bundles = filesUnder(path.join(root, "dist/node/chunks")).filter(file => file.endsWith(".js"));
  const watcherBundle = bundles.find(file => readFileSync(file, "utf8").includes("_handleRead(directory, initialAdd, wh, target, dir, depth, throttler)"));
  if (!watcherBundle) throw new Error("No matching primary watcher source in " + root);
  const declarationText = readFileSync(declaration, "utf8");
  const watcherText = readFileSync(watcherBundle, "utf8");
  const match = (file, text, pattern, context = 2) => {
    const lines = text.split(/\r?\n/);
    const index = lines.findIndex(line => pattern.test(line));
    if (index < 0) throw new Error("Missing source contract: " + pattern);
    return { file: path.relative(root, file).replaceAll("\\", "/"), line: index + 1, excerpt: lines.slice(Math.max(0, index - context), index + context + 1).join("\n") };
  };
  return {
    vite: manifest.version,
    declarationSha256: hash(declarationText),
    watcherBundleSha256: hash(watcherText),
    publicAdd: match(declaration, declarationText, /add\(paths: string \| ReadonlyArray<string>\): this/),
    publicDepth: match(declaration, declarationText, /depth\?: number/),
    publicIgnored: match(declaration, declarationText, /ignored\?:/),
    globalDepthRead: match(watcherBundle, watcherText, /(?:const oDepth = this\.fsw\.options\.depth|const oDepth = this\.fsw\.options\.depth;)/),
    filenameFilter: match(watcherBundle, watcherText, /item === target \|\| !target && !previous\.has\(item\)/),
    directoryThrottle: match(watcherBundle, watcherText, /this\.fsw\._throttle\(['"]readdir['"], directory, (?:1000|1e3)\)/),
    missingFallback: match(watcherBundle, watcherText, /this\.add\(sysPath\.dirname\(item\), sysPath\.basename\(_origAdd \|\| item\)\)/),
    viteDisablesGlobs: match(watcherBundle, watcherText, /disableGlobbing: true/),
  };
});
writeJson(path.join(evidence, "watcher-source-contracts.json"), { inspectedVersions: rows.map(row => row.vite), runtimePrototypeVersion: "8.1.5", rows });
console.log("Recorded watcher contracts for " + rows.map(row => row.vite).join(", "));
