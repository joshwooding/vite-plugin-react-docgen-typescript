// Read-only observation after npm install, before the unchanged verifier cleans up.
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const originalSpawnSync = childProcess.spawnSync;
childProcess.spawnSync = function (command, args, options) {
  const result = Reflect.apply(originalSpawnSync, this, [
    command,
    args,
    options,
  ]);
  if (args?.includes("install") && result.status === 0) {
    const modules = path.join(options.cwd, "node_modules");
    const names = [
      "typescript",
      "vite",
      "react-docgen-typescript",
      "glob",
      "@joshwooding/vite-plugin-react-docgen-typescript",
    ];
    const versions = Object.fromEntries(
      names.map((name) => [
        name,
        JSON.parse(
          readFileSync(path.join(modules, name, "package.json"), "utf8"),
        ).version,
      ]),
    );
    const dist = path.join(modules, names.at(-1), "dist");
    const distFiles = {};
    const walk = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
        (a, b) => a.name.localeCompare(b.name),
      )) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else
          distFiles[path.relative(dist, file).split(path.sep).join("/")] =
            createHash("sha256").update(readFileSync(file)).digest("hex");
      }
    };
    walk(dist);
    writeFileSync(
      process.env.PLAN029_DEPENDENCY_RECORD,
      `${JSON.stringify({ versions, distFiles }, null, 2)}\n`,
    );
  }
  return result;
};
syncBuiltinESMExports();
