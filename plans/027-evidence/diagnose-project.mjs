import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  salt,
  dist,
  evidence,
  requirePlugin,
  options,
  context,
  metadata,
  writeJson,
} from "./common.mjs";
const [mode, label] = process.argv.slice(2);
if (!["default", "projectService"].includes(mode) || !label)
  throw new Error("Usage: diagnose-project.mjs <mode> <label>");
// Explicitly untimed diagnostic: preload the parser to observe its actual Program provider.
const ts = requirePlugin("typescript");
const parser = requirePlugin(
  path.join(
    path.dirname(requirePlugin.resolve("react-docgen-typescript")),
    "parser.js",
  ),
);
const original = parser.withCompilerOptions;
const observed = [];
parser.withCompilerOptions = (...args) => {
  const instance = original(...args),
    parse = instance.parseWithProgramProvider;
  instance.parseWithProgramProvider = (files, provider) =>
    parse(files, () => {
      const program = provider();
      const compilerOptions = program.getCompilerOptions();
      observed.push({
        configFilePath: compilerOptions.configFilePath,
        paths: compilerOptions.paths,
        rootFileCount: program.getRootFileNames().length,
        programFileCount: program.getSourceFiles().length,
        resolution: Object.fromEntries(
          ["react", "@salt-ds/icons", "@salt-ds/styles", "@salt-ds/window"].map(
            (name) => [
              name,
              ts.resolveModuleName(name, target, compilerOptions, ts.sys)
                .resolvedModule?.resolvedFileName ?? null,
            ],
          ),
        ),
      });
      return program;
    });
  return instance;
};
const target = path.join(
  salt,
  "packages/core/src/status-indicator/StatusIndicator.tsx",
);
process.chdir(salt);
const { default: createPlugin } = await import(pathToFileURL(dist));
const plugin = createPlugin(options(mode));
try {
  await plugin.configResolved({ command: "serve", root: salt });
  const docs = metadata(
    await plugin.transform.call(context, readFileSync(target, "utf8"), target),
  );
  const result = { mode, label, observed, docs };
  writeJson(
    path.join(evidence, "diagnostics", mode + "-" + label + ".json"),
    result,
  );
  console.log(
    JSON.stringify(
      {
        mode,
        label,
        observed,
        props: docs.map((doc) => Object.keys(doc.props)),
      },
      null,
      2,
    ),
  );
} finally {
  await plugin.closeBundle();
}
