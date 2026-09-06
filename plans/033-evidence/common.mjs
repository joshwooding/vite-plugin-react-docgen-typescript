import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
export const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export const evidence = path.join(repo, "plans/033-evidence");
export const raw = path.join(repo, ".yarn/simplification-evidence/033");
export const json = (file) => JSON.parse(readFileSync(file, "utf8"));
export const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const slash = (value) => value.replaceAll("\\", "/");
export const [workload, variant] = process.argv.slice(2);
assert(["salt", "shallow"].includes(workload));
assert(["baseline", "candidate"].includes(variant));
export const setup = json(path.join(raw, "setup.json"));
export const root = setup[workload];
export const artifact = setup.artifactRoots[variant];
export const dist = path.join(artifact, "dist/index.mjs");
export const requirePlugin = createRequire(dist);
export const relative = (file) => slash(path.relative(root, file));
export const filesUnder = (directory) =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(file) : [file];
    })
    .sort();
const sourceFiles = () =>
  workload === "salt"
    ? ["core", "icons", "styles", "window"].flatMap((name) =>
        filesUnder(path.join(root, "packages", name, "src")),
      )
    : filesUnder(path.join(root, "src"));
export const targets = filesUnder(
  path.join(root, workload === "salt" ? "packages/core/src" : "src"),
).filter(
  (file) =>
    file.endsWith(".tsx") &&
    !slash(file).includes("/__tests__/") &&
    !/\.(?:test|spec)\./.test(file),
);
export const config = path.join(
  root,
  workload === "salt" ? "packages/core/tsconfig.json" : "tsconfig.json",
);
function retainNativeDisabled(prop) {
  return (
    prop.name === "disabled" ||
    !prop.parent?.fileName.replaceAll("\\", "/").includes("node_modules")
  );
}
const parserOptions =
  workload === "shallow"
    ? {
        propFilter: retainNativeDisabled,
        shouldExtractLiteralValuesFromEnum: true,
        shouldRemoveUndefinedFromOptional: true,
      }
    : { shouldExtractLiteralValuesFromEnum: true };
export const options = (mode) => ({
  tsconfigPath: config,
  include: [
    workload === "salt" ? "packages/core/src/**/*.tsx" : "src/**/*.tsx",
  ],
  exclude:
    workload === "salt"
      ? ["**/__tests__/**", "**/*.test.*", "**/*.spec.*"]
      : [],
  docgenMode: mode === "projectService" ? "project-service" : "legacy",
  fileSystemCache: false,
  ...parserOptions,
});
export function identity() {
  const manifest = (name, from) => {
    const file = createRequire(from).resolve(`${name}/package.json`);
    return { version: json(file).version, path: realpathSync(file) };
  };
  return {
    workload,
    root,
    node: process.version,
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpu: os.cpus()[0].model,
      logicalCpus: os.cpus().length,
    },
    sourceSha256: hash(
      sourceFiles()
        .map((file) => `${relative(file)}:${hash(readFileSync(file))}`)
        .join("\n"),
    ),
    configSha256: hash(readFileSync(config)),
    targetsSha256: hash(targets.map(relative).join("\n")),
    targetCount: targets.length,
    parserOptions: {
      ...parserOptions,
      propFilter:
        workload === "shallow"
          ? retainNativeDisabled.toString()
          : "plugin-default",
    },
    pluginLockSha256: hash(readFileSync(path.join(repo, "yarn.lock"))),
    consumerLockSha256:
      workload === "salt"
        ? hash(readFileSync(path.join(setup.dependencies, "package-lock.json")))
        : null,
    saltLockSha256:
      workload === "salt"
        ? hash(readFileSync(path.join(root, "yarn.lock")))
        : null,
    selectedConfigHashes:
      workload === "salt"
        ? Object.fromEntries(
            ["core", "icons", "styles", "window"].map((name) => [
              name,
              hash(
                readFileSync(
                  path.join(root, "packages", name, "tsconfig.json"),
                ),
              ),
            ]),
          )
        : null,
    workspaceLinks:
      workload === "salt"
        ? Object.fromEntries(
            ["core", "icons", "styles", "window"].map((name) => [
              name,
              realpathSync(path.join(root, "node_modules/@salt-ds", name)),
            ]),
          )
        : null,
    pluginDependencies: Object.fromEntries(
      ["typescript", "react-docgen-typescript", "vite"].map((name) => [
        name,
        manifest(name, dist),
      ]),
    ),
    consumerDependencies: Object.fromEntries(
      (workload === "salt"
        ? Object.keys(
            json(path.join(setup.dependencies, "package.json")).dependencies,
          )
        : ["react", "@types/react"]
      ).map((name) => {
        const file = path.join(root, "node_modules", name, "package.json");
        return [
          name,
          { version: json(file).version, path: realpathSync(file) },
        ];
      }),
    ),
    artifact: {
      variant,
      root: artifact,
      files: Object.fromEntries(
        filesUnder(artifact).map((file) => [
          slash(path.relative(artifact, file)),
          hash(readFileSync(file)),
        ]),
      ),
    },
  };
}
export const workloadIdentity = ({ artifact: _artifact, ...rest }) => rest;
export const verifyIdentity = (actual, expected) =>
  assert.deepEqual(actual, expected, "Workload/artifact identity mismatch");
export const edits =
  workload === "salt"
    ? {
        component: {
          file: path.join(root, "packages/core/src/button/Button.tsx"),
          before: "If `true`, the button will be disabled.",
          after:
            "If `true`, the button will be disabled. Profile documentation update.",
        },
        shared: {
          file: path.join(
            root,
            "packages/core/src/status-indicator/ValidationStatus.ts",
          ),
          before: "  info: string;",
          after: "  info: string;\n  profilePending: string;",
        },
      }
    : {
        component: {
          file: path.join(root, "src/components/Button.tsx"),
          before: "Native button with shared action styling.",
          after: "Updated native button with shared action styling.",
        },
        shared: {
          file: path.join(root, "src/shared.ts"),
          before: '"primary" | "quiet"',
          after: '"primary" | "quiet" | "profilePending"',
        },
      };
export function applyEdit(name) {
  const edit = edits[name];
  const original = readFileSync(edit.file, "utf8");
  assert.equal(
    original.split(edit.before).length,
    2,
    `Ambiguous or ineffective mutation: ${name}`,
  );
  writeFileSync(edit.file, original.replace(edit.before, edit.after));
  return () => writeFileSync(edit.file, original);
}
export const context = {
  addWatchFile() {},
  warn(message) {
    throw new Error(`Plugin warning: ${message}`);
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
export const verifyMetadata = (documents, oracle, stage) =>
  assert.equal(
    docSummary(documents).sha256,
    oracle.summary.sha256,
    `Stale or divergent metadata at ${stage}`,
  );
export const oraclePath = (mode, stage) =>
  path.join(evidence, "oracles", `${workload}-${mode}-${stage}.json`);
