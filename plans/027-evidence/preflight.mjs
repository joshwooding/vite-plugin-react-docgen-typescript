import { readFileSync } from "node:fs";
import path from "node:path";
import {
  config,
  salt,
  raw,
  evidence,
  requirePlugin,
  targets,
  relative,
  writeJson,
  identity,
} from "./common.mjs";
const ts = requirePlugin("typescript");
const loaded = ts.readConfigFile(config, ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(
  loaded.config,
  ts.sys,
  path.dirname(config),
);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const errors = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].filter(
  (d) => d.category === ts.DiagnosticCategory.Error,
);
const resolution = Object.fromEntries(
  [
    "react",
    "@salt-ds/icons",
    "@salt-ds/styles",
    "@salt-ds/window",
    "@floating-ui/react",
  ].map((name) => [
    name,
    ts.resolveModuleName(
      name,
      path.join(salt, "packages/core/src/button/Button.tsx"),
      parsed.options,
      ts.sys,
    ).resolvedModule?.resolvedFileName,
  ]),
);
const result = {
  identity: identity(),
  rootFileCount: parsed.fileNames.length,
  programFileCount: program.getSourceFiles().length,
  targets: targets.map(relative),
  resolution,
  errors: errors.map((d) => ({
    file: d.file?.fileName,
    start: d.start,
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  })),
};
writeJson(path.join(evidence, "preflight.json"), result);
console.log(
  JSON.stringify(
    {
      targets: targets.length,
      rootFiles: result.rootFileCount,
      programFiles: result.programFileCount,
      resolution,
      errorCount: errors.length,
      errors: result.errors.slice(0, 10),
    },
    null,
    2,
  ),
);
if (errors.length || Object.values(resolution).some((value) => !value))
  process.exitCode = 1;
