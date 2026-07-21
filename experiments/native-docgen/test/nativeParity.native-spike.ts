import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { backendParityCorpus } from "../../../packages/vite-plugin-react-docgen-typescript/src/__tests__/support/backendParityCorpus.ts";
import { NativeDocgenBackend } from "../src/nativeBackend.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { force: true, recursive: true });
});

const selection = {
  exclude: [],
  hasIncludes: true,
  include: ["**/*.tsx"],
  matchesDocgenFile: (fileName: string) => fileName.endsWith(".tsx"),
};

const materialize = (fixture: (typeof backendParityCorpus)[number]) => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "vprdts-native-parity-"));
  roots.push(rootDir);
  for (const [relative, source] of Object.entries(fixture.files)) {
    const fileName = path.join(rootDir, relative);
    mkdirSync(path.dirname(fileName), { recursive: true });
    writeFileSync(fileName, source);
  }
  writeFileSync(
    path.join(rootDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        target: "ES2020",
      },
      files: Object.keys(fixture.files),
    }),
  );
  return { fileName: path.join(rootDir, fixture.transformFile), rootDir };
};

const tokenize = (value: unknown, rootDir: string): unknown => {
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\", "/");
    const root = rootDir.replaceAll("\\", "/");
    return normalized.startsWith(root)
      ? `<fixture>${normalized.slice(root.length)}`
      : normalized;
  }
  if (Array.isArray(value))
    return value.map((entry) => tokenize(entry, rootDir));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        tokenize(entry, rootDir),
      ]),
    );
  }
  return value;
};

describe.each([
  "typescript7",
  "typescript7next",
] as const)("%s native public-contract parity", (alias) => {
  for (const fixture of backendParityCorpus) {
    test(`parity: ${fixture.name}`, async () => {
      const { fileName, rootDir } = materialize(fixture);
      const backend = new NativeDocgenBackend({
        alias,
        options: fixture.options ?? {},
        rootDir,
        selection,
      });
      const project = await backend.initialize();
      const result = await backend.analyze({
        fileName,
        revision: 0,
        source: readFileSync(fileName, "utf-8"),
      });
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        const actual = tokenize(result.components, rootDir) as Array<{
          props: Record<string, { type: unknown }>;
        }>;
        if (fixture.name === "rich metadata and enum values") {
          expect(actual[0]?.props.variant?.type).toEqual({
            name: "enum",
            raw: '"modern" | "pill" | undefined',
            value: [
              { value: "undefined" },
              { value: '"modern"' },
              { value: '"pill"' },
            ],
          });
          const classified = structuredClone(actual);
          const expectedRich = fixture.expectedComponents[0] as {
            props: { variant: { type: unknown } };
          };
          classified[0].props.variant.type = expectedRich.props.variant.type;
          expect(classified).toEqual(fixture.expectedComponents);
        } else {
          expect(actual).toEqual(fixture.expectedComponents);
        }
        expect(tokenize(result.dependencies, rootDir)).toEqual(
          fixture.expectedDependencies,
        );
      }
      expect(tokenize(project.trackedFiles, rootDir)).toEqual(
        fixture.expectedProjectFiles,
      );
      await backend.dispose();
    });
  }
});

describe("native option diagnostics and local prop filtering", () => {
  test("componentNameResolver fails with a stable experimental diagnostic", async () => {
    const fixture = backendParityCorpus[0];
    const { fileName, rootDir } = materialize(fixture);
    const backend = new NativeDocgenBackend({
      alias: "typescript7",
      options: { componentNameResolver: () => "renamed" },
      rootDir,
      selection,
    });
    const result = await backend.analyze({
      fileName,
      revision: 0,
      source: readFileSync(fileName, "utf-8"),
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.message).toBe(
        "NATIVE_DOCGEN_UNSUPPORTED_OPTION: componentNameResolver requires legacy compiler symbols",
      );
    }
    await backend.dispose();
  });

  test("a local prop filter receives neutral values", async () => {
    const fixture = backendParityCorpus[0];
    const { fileName, rootDir } = materialize(fixture);
    const seen: string[] = [];
    const backend = new NativeDocgenBackend({
      alias: "typescript7",
      options: {
        propFilter({ componentName, prop }) {
          seen.push(`${componentName}.${prop.name}`);
          return false;
        },
        shouldExtractValuesFromUnion: true,
      },
      rootDir,
      selection,
    });
    const result = await backend.analyze({
      fileName,
      revision: 0,
      source: readFileSync(fileName, "utf-8"),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.components[0]?.props).toEqual({});
    expect(seen).toEqual(["RichMetadataComponent.variant"]);
    await backend.dispose();
  });
});
