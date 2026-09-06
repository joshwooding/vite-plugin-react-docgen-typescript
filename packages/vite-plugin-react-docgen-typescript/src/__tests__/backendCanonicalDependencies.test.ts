import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalyzeResult, DocgenBackend } from "../docgen/backend";
import { createLegacyBackendFactory } from "../docgen/legacyBackend";
import { resolveFileSelection } from "../utils/fileSelection";
import type { Options } from "../utils/options";

const componentSource = `declare namespace JSX { interface Element {} }
import type { LeftProps } from "./Left";
import type { RightProps } from "./Right";
export const Component = (_props: LeftProps & RightProps & AmbientProps): JSX.Element =>
  null as unknown as JSX.Element;
`;
const sharedSource = (description: string) =>
  `export interface SharedProps {\n /** ${description} */\n tone: "base" | "quiet";\n }`;

const createFixture = () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "vite-rdt-canonical-"));
  const root = path.join(temporaryRoot, "project");
  const alias = path.join(temporaryRoot, "alias");
  mkdirSync(root);
  symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  const files = {
    "Component.tsx": componentSource,
    "Unrelated.tsx": `declare namespace JSX { interface Element {} }
export const Unrelated = (_props: { own: boolean }): JSX.Element =>
  null as unknown as JSX.Element;`,
    "Left.ts": 'export type { SharedProps as LeftProps } from "@props";',
    "Right.ts": 'export type { SharedProps as RightProps } from "@props";',
    "first/Shared.ts": sharedSource("Initial tone."),
    "second/Shared.ts": sharedSource("Second project tone."),
    "first/ambient.d.ts": 'interface AmbientProps { ambient: "first"; }',
    "second/ambient.d.ts": 'interface AmbientProps { ambient: "second"; }',
  };
  for (const [name, source] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  const configPath = path.join(root, "tsconfig.json");
  const writeConfig = (variant: "first" | "second") => {
    const source = JSON.stringify({
      compilerOptions: {
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@props": [`./${variant}/Shared.ts`] },
        skipLibCheck: true,
        target: "ES2020",
        types: [],
      },
      files: [
        "Component.tsx",
        "Unrelated.tsx",
        "Left.ts",
        "Right.ts",
        `${variant}/Shared.ts`,
        `${variant}/ambient.d.ts`,
      ],
    });
    writeFileSync(configPath, source);
    return source;
  };
  writeConfig("first");
  const physical = (file: string) => path.join(realpathSync.native(root), file);
  const request = (revision: number, file = "Component.tsx") => ({
    fileName: `${path.join(alias, file)}?direct#fragment`,
    revision,
    source: readFileSync(path.join(root, file), "utf8"),
  });
  return {
    alias,
    configPath,
    physical,
    request,
    root,
    temporaryRoot,
    writeConfig,
  };
};

type Fixture = ReturnType<typeof createFixture>;

const createBackend = (fixture: Fixture, options: Options) => {
  const config: Options = { ...options, tsconfigPath: fixture.configPath };
  return createLegacyBackendFactory(config).create({
    rootDir: fixture.root,
    selection: resolveFileSelection(fixture.root, config),
  });
};

const expectedDependencies = (
  fixture: Fixture,
  variant: "first" | "second",
  missing = false,
  unrelated = false,
) =>
  (unrelated
    ? ["Unrelated.tsx", `${variant}/ambient.d.ts`]
    : [
        "Component.tsx",
        "Left.ts",
        "Right.ts",
        `${variant}/ambient.d.ts`,
        ...(missing ? [] : [`${variant}/Shared.ts`]),
      ]
  )
    .map(fixture.physical)
    .sort();

const expectValidation = async (
  backend: DocgenBackend,
  fixture: Fixture,
  result: AnalyzeResult,
  dependencies: readonly string[],
) => {
  const validation = await backend.prepareCacheValidation?.(
    fixture.request(result.revision),
  );
  expect(result.dependencies).toEqual(dependencies);
  expect(validation?.dependencies).toEqual(dependencies);
  expect(validation?.dependencies).not.toBe(result.dependencies);
  expect(result.dependencies).toEqual([...new Set(result.dependencies)].sort());
};

describe.each([
  "legacy",
  "project-service",
] as const)("canonical backend dependencies in %s", (docgenMode) => {
  it("preserves physical dependency identities through edits, deletion, recreation and config reset", async () => {
    const fixture = createFixture();
    const options: Options = { docgenMode };
    const backend = await createBackend(fixture, options);
    const snapshots: { dependencies: readonly string[]; expected: string[] }[] =
      [];
    let unrelatedComponents: unknown;
    const check = async (
      revision: number,
      variant: "first" | "second",
      description?: string,
    ) => {
      const result = await backend.analyze(fixture.request(revision));
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error(result.error.message);
      const expected = expectedDependencies(fixture, variant, !description);
      await expectValidation(backend, fixture, result, expected);
      expect(result.components).toHaveLength(1);
      if (description) {
        expect(result.components[0].props.tone.description).toBe(description);
        expect(result.components[0].props.ambient.type.name).toBe(
          `"${variant}"`,
        );
      } else {
        expect(result.components[0].props).not.toHaveProperty("tone");
        expect(result.unresolvedDependencies).toContain(
          fixture.physical(`${variant}/Shared.ts`),
        );
      }
      const fresh = await createBackend(fixture, options);
      try {
        const freshResult = await fresh.analyze(fixture.request(revision));
        expect(freshResult.status).toBe("ok");
        if (freshResult.status !== "ok")
          throw new Error(freshResult.error.message);
        expect(result.components).toEqual(freshResult.components);
        expect(result.dependencies).toEqual(freshResult.dependencies);
        expect(result.unresolvedDependencies).toEqual(
          freshResult.unresolvedDependencies,
        );
      } finally {
        await fresh.dispose();
      }
      snapshots.push({ dependencies: result.dependencies, expected });
      for (const snapshot of snapshots)
        expect(snapshot.dependencies).toEqual(snapshot.expected);
      const unrelated = await backend.analyze(
        fixture.request(revision, "Unrelated.tsx"),
      );
      expect(unrelated.status).toBe("ok");
      if (unrelated.status !== "ok") throw new Error(unrelated.error.message);
      expect(unrelated.dependencies).toEqual(
        expectedDependencies(fixture, variant, false, true),
      );
      unrelatedComponents ??= unrelated.components;
      expect(unrelated.components).toEqual(unrelatedComponents);
      return result;
    };
    const update = async (
      revision: number,
      kind: "change" | "create" | "delete",
      source?: string,
    ) => {
      const file = path.join(fixture.alias, "first/Shared.ts");
      if (kind === "delete") rmSync(file);
      else writeFileSync(file, source ?? "");
      const result = await backend.update({
        affectedComponentFiles: [fixture.request(revision).fileName],
        change:
          kind === "delete"
            ? { fileName: file, kind, revision }
            : { fileName: file, kind, revision, source: source ?? "" },
      });
      expect(result.status).toBe("ready");
      expect(
        await backend.prepareCacheValidation?.(fixture.request(revision - 1)),
      ).toBeUndefined();
    };
    try {
      await check(0, "first", "Initial tone.");
      await update(1, "change", sharedSource("Edited tone."));
      await check(1, "first", "Edited tone.");
      await update(2, "delete");
      await check(2, "first");
      await update(3, "create", sharedSource("Recreated tone."));
      await check(3, "first", "Recreated tone.");
      const source = fixture.writeConfig("second");
      expect(
        await backend.update({
          affectedComponentFiles: [fixture.request(4).fileName],
          change: {
            fileName: path.join(fixture.alias, "tsconfig.json"),
            kind: "change",
            revision: 4,
            source,
          },
        }),
      ).toEqual({ revision: 4, status: "project-reset" });
      await check(4, "second", "Second project tone.");
    } finally {
      await backend.dispose();
      rmSync(fixture.temporaryRoot, { force: true, recursive: true });
    }
  }, 60_000);

  it("returns the same canonical dependencies from parser errors, recovery and validation", async () => {
    const fixture = createFixture();
    let fail = true;
    const backend = await createBackend(fixture, {
      docgenMode,
      componentNameResolver: () => {
        if (fail) throw new Error("controlled canonical dependency failure");
        return undefined;
      },
    });
    try {
      for (const [revision, variant] of [
        [0, "first"],
        [1, "second"],
      ] as const) {
        if (revision > 0) {
          fixture.writeConfig(variant);
          expect(await backend.reset({ revision })).toEqual({
            revision,
            status: "reset",
          });
        }
        fail = true;
        const failed = await backend.analyze(fixture.request(revision));
        expect(failed.status).toBe("error");
        if (failed.status !== "error")
          throw new Error("Expected controlled parser failure");
        expect(failed.error.message).toBe(
          "controlled canonical dependency failure",
        );
        await expectValidation(
          backend,
          fixture,
          failed,
          expectedDependencies(fixture, variant),
        );
        fail = false;
        const recovered = await backend.analyze(fixture.request(revision));
        expect(recovered.status).toBe("ok");
        await expectValidation(
          backend,
          fixture,
          recovered,
          expectedDependencies(fixture, variant),
        );
        expect(failed.dependencies).toEqual(recovered.dependencies);
        expect(failed.dependencies).not.toBe(recovered.dependencies);
      }
    } finally {
      await backend.dispose();
      rmSync(fixture.temporaryRoot, { force: true, recursive: true });
    }
  }, 30_000);
});
