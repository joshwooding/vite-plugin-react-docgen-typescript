import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  config,
  context,
  dist,
  evidence,
  identity,
  metadata,
  options,
  requirePlugin,
  root,
  variant,
  workload,
  writeJson,
} from "./common.mjs";

const [, , mode] = process.argv.slice(2);
assert(["default", "projectService"].includes(mode));
// Untimed: observe the actual parser Program, never import this helper from driver.mjs.
const ts = requirePlugin("typescript");
const parser = requirePlugin(
  path.join(
    path.dirname(requirePlugin.resolve("react-docgen-typescript")),
    "parser.js",
  ),
);
const original = parser.withCompilerOptions;
const observed = [];
const target = path.join(
  root,
  workload === "salt"
    ? "packages/core/src/status-indicator/StatusIndicator.tsx"
    : "src/components/Button.tsx",
);
parser.withCompilerOptions = (...args) => {
  const instance = original(...args),
    parse = instance.parseWithProgramProvider;
  instance.parseWithProgramProvider = (files, provider) =>
    parse(files, () => {
      const program = provider();
      const compilerOptions = program.getCompilerOptions();
      observed.push({
        configFilePath: compilerOptions.configFilePath,
        paths: compilerOptions.paths ?? null,
        rootFileCount: program.getRootFileNames().length,
        programFileCount: program.getSourceFiles().length,
        resolution: Object.fromEntries(
          (workload === "salt"
            ? ["react", "@salt-ds/icons", "@salt-ds/styles", "@salt-ds/window"]
            : ["react"]
          ).map((name) => [
            name,
            ts.resolveModuleName(name, target, compilerOptions, ts.sys)
              .resolvedModule?.resolvedFileName ?? null,
          ]),
        ),
        errors: ts
          .getPreEmitDiagnostics(program)
          .filter((d) => d.category === ts.DiagnosticCategory.Error)
          .map((d) => ({
            code: d.code,
            message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
          })),
      });
      return program;
    });
  return instance;
};
process.chdir(root);
const { default: createPlugin } = await import(pathToFileURL(dist));
const plugin = createPlugin(options(mode));
try {
  await plugin.configResolved({ command: "serve", root });
  const docs = metadata(
    await plugin.transform.call(context, readFileSync(target, "utf8"), target),
  );
  const result = {
    workload,
    variant,
    mode,
    identity: identity(),
    observed,
    docs,
  };
  writeJson(
    path.join(
      evidence,
      "diagnostics",
      `${[workload, variant, mode].join("-")}.json`,
    ),
    result,
  );
  assert.equal(observed.length, 1);
  assert.equal(path.resolve(observed[0].configFilePath), path.resolve(config));
  assert.equal(observed[0].rootFileCount, workload === "salt" ? 401 : 4);
  assert.equal(observed[0].errors.length, 0);
  assert(Object.values(observed[0].resolution).every(Boolean));
  if (workload === "salt") {
    assert.equal(observed[0].programFileCount, 1190);
    for (const name of ["icons", "styles", "window"])
      assert(
        observed[0].resolution[`@salt-ds/${name}`].startsWith(
          `${root.replaceAll("\\", "/")}/packages/${name}/`,
        ),
      );
    for (const prop of ["color", "size", "status"]) assert(docs[0].props[prop]);
  } else for (const prop of ["intent", "disabled"]) assert(docs[0].props[prop]);
  console.log(
    JSON.stringify({
      workload,
      variant,
      mode,
      observed,
      props: docs.map((doc) => Object.keys(doc.props)),
    }),
  );
} finally {
  await plugin.closeBundle();
}
