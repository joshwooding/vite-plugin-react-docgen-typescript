import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const evidence = path.join(repo, "plans/027-evidence");
export const raw = path.join(repo, ".yarn/simplification-evidence/027");
export const salt = path.join(raw, "salt-ds");
export const dist = path.join(
  repo,
  "packages/vite-plugin-react-docgen-typescript/dist/index.mjs",
);
export const requirePlugin = createRequire(dist);
export const requireSalt = createRequire(path.join(salt, "package.json"));
export const config = path.join(salt, "packages/core/tsconfig.json");
export const modes = ["default", "projectService"];
export const json = (file) => JSON.parse(readFileSync(file, "utf8"));
export const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
};
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const slash = (value) => value.replaceAll("\\", "/");
export const relative = (file) => slash(path.relative(salt, file));
export const filesUnder = (directory) =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(file) : [file];
    })
    .sort();
export const targets = filesUnder(path.join(salt, "packages/core/src")).filter(
  (file) =>
    file.endsWith(".tsx") &&
    !slash(file).includes("/__tests__/") &&
    !/\.(?:test|spec)\./.test(file),
);
export const git = (cwd, args) =>
  execFileSync("git", ["-c", "core.longpaths=true", ...args], {
    cwd,
    windowsHide: true,
    maxBuffer: 20_000_000,
  })
    .toString()
    .trim();
export const sourceTreeHash = () =>
  hash(
    ["core", "icons", "styles", "window"]
      .flatMap((name) => filesUnder(path.join(salt, "packages", name, "src")))
      .map((file) => relative(file) + ":" + hash(readFileSync(file)))
      .join("\n"),
  );
export function identity() {
  const source = path.join(
    repo,
    "packages/vite-plugin-react-docgen-typescript/src",
  );
  const packageJson = json(
    path.join(raw, "consumer-dependencies/package.json"),
  );
  return {
    pluginCommit: git(repo, ["rev-parse", "HEAD"]),
    saltCommit: git(salt, ["rev-parse", "HEAD"]),
    saltSourceSha256: sourceTreeHash(),
    pluginSourceSha256: hash(
      filesUnder(source)
        .map(
          (file) =>
            slash(path.relative(source, file)) + ":" + hash(readFileSync(file)),
        )
        .join("\n"),
    ),
    pluginBuildSha256: hash(readFileSync(dist)),
    pluginLockSha256: hash(readFileSync(path.join(repo, "yarn.lock"))),
    saltLockSha256: hash(readFileSync(path.join(salt, "yarn.lock"))),
    consumerLockSha256: hash(
      readFileSync(path.join(raw, "consumer-dependencies/package-lock.json")),
    ),
    configSha256: hash(readFileSync(config)),
    targetsSha256: hash(targets.map(relative).join("\n")),
    targetCount: targets.length,
    workspaceLinks: Object.fromEntries(
      ["core", "icons", "styles", "window"].map((name) => [
        name,
        realpathSync(path.join(salt, "node_modules/@salt-ds", name)),
      ]),
    ),
    selectedConfigHashes: Object.fromEntries(
      ["core", "icons", "styles", "window"]
        .map((name) => [
          name,
          path.join(salt, "packages", name, "tsconfig.json"),
        ])
        .filter(([, file]) => existsSync(file))
        .map(([name, file]) => [name, hash(readFileSync(file))]),
    ),
    node: process.version,
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
    },
    pluginDependencies: Object.fromEntries(
      ["typescript", "react-docgen-typescript", "vite"].map((name) => [
        name,
        {
          version: json(requirePlugin.resolve(name + "/package.json")).version,
          path: realpathSync(requirePlugin.resolve(name + "/package.json")),
        },
      ]),
    ),
    consumerDependencies: Object.fromEntries(
      Object.keys(packageJson.dependencies).map((name) => {
        const manifest = path.join(salt, "node_modules", name, "package.json");
        return [
          name,
          { version: json(manifest).version, path: realpathSync(manifest) },
        ];
      }),
    ),
  };
}
export const edits = {
  component: {
    file: path.join(salt, "packages/core/src/button/Button.tsx"),
    before: "If `true`, the button will be disabled.",
    after:
      "If `true`, the button will be disabled. Profile documentation update.",
  },
  shared: {
    file: path.join(
      salt,
      "packages/core/src/status-indicator/ValidationStatus.ts",
    ),
    before: "  info: string;",
    after: "  info: string;\n  profilePending: string;",
  },
};
export function applyEdit(name) {
  const edit = edits[name];
  const original = readFileSync(edit.file, "utf8");
  if (original.split(edit.before).length !== 2)
    throw new Error("Ambiguous or ineffective mutation: " + name);
  writeFileSync(edit.file, original.replace(edit.before, edit.after));
  return () => writeFileSync(edit.file, original);
}
export const options = (mode) => ({
  tsconfigPath: config,
  include: ["packages/core/src/**/*.tsx"],
  exclude: ["**/__tests__/**", "**/*.test.*", "**/*.spec.*"],
  docgenMode: mode === "projectService" ? "project-service" : "legacy",
  fileSystemCache: false,
  shouldExtractLiteralValuesFromEnum: true,
});
export const context = {
  addWatchFile() {},
  warn(message) {
    throw new Error("Plugin warning: " + message);
  },
};
export function metadata(result) {
  const code = typeof result === "string" ? result : (result?.code ?? "");
  return [...code.matchAll(/__docgenInfo\s*=\s*(\{[^\r\n]*\})/g)]
    .map((match) => {
      const doc = JSON.parse(match[1]);
      return {
        displayName: doc.displayName,
        description: doc.description,
        props: Object.fromEntries(
          Object.entries(doc.props)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([name, prop]) => [
              name,
              {
                name: prop.name,
                description: prop.description,
                required: prop.required,
                type: prop.type,
                defaultValue: prop.defaultValue,
              },
            ]),
        ),
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}
export const docSummary = (documents) => ({
  fileCount: Object.keys(documents).length,
  metadataFileCount: Object.values(documents).filter((docs) => docs.length)
    .length,
  componentCount: Object.values(documents).reduce(
    (count, docs) => count + docs.length,
    0,
  ),
  sha256: hash(JSON.stringify(documents)),
  files: Object.fromEntries(
    Object.entries(documents).map(([file, docs]) => [
      file,
      {
        sha256: hash(JSON.stringify(docs)),
        displayNames: docs.map((doc) => doc.displayName),
      },
    ]),
  ),
});
export const verifyIdentity = (actual, expected) =>
  assert.deepEqual(actual, expected, "Oracle/workload identity mismatch");
export const verifyMetadata = (documents, oracle, stage) =>
  assert.equal(
    docSummary(documents).sha256,
    oracle.summary.sha256,
    "Stale or divergent metadata at " + stage,
  );
export function sentinel(documents) {
  const get = (file, name, prop) =>
    documents["packages/core/src/" + file]?.find(
      (doc) => doc.displayName === name,
    )?.props[prop];
  return {
    buttonDisabled: get("button/Button.tsx", "Button", "disabled"),
    buttonOnClick: get("button/Button.tsx", "Button", "onClick"),
    bannerStatus: get("banner/Banner.tsx", "Banner", "status"),
    dialogStatus: get("dialog/Dialog.tsx", "Dialog", "status"),
    indicatorStatus: get(
      "status-indicator/StatusIndicator.tsx",
      "StatusIndicator",
      "status",
    ),
  };
}
