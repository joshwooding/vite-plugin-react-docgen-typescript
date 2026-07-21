import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { backendParityCorpus } from "../../../packages/vite-plugin-react-docgen-typescript/src/__tests__/support/backendParityCorpus.ts";
import type { DocgenBackendFactory } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/backend.ts";
import { createLegacyBackendFactory } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/legacyBackend.ts";
import {
  createTypescript6ControlFactory,
  Typescript6ControlBackend,
} from "../src/legacyLanguageServiceBackend.ts";

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
  const rootDir = mkdtempSync(path.join(tmpdir(), "vprdts-control-extractor-"));
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

const runFactory = async (
  factory: DocgenBackendFactory,
  rootDir: string,
  fileName: string,
) => {
  const backend = await factory.create({ rootDir, selection });
  const project = await backend.initialize();
  const source = (await import("node:fs")).readFileSync(fileName, "utf-8");
  const result = await backend.analyze({ fileName, revision: 0, source });
  await backend.dispose();
  return { project, result };
};

describe("TypeScript 6 direct extractor control", () => {
  for (const fixture of backendParityCorpus) {
    test(`extractor public contract: ${fixture.name}`, async () => {
      const { fileName, rootDir } = materialize(fixture);
      const options = fixture.options ?? {};
      const [legacy, control] = await Promise.all([
        runFactory(createLegacyBackendFactory(options), rootDir, fileName),
        runFactory(createTypescript6ControlFactory(options), rootDir, fileName),
      ]);
      expect(legacy.result.status).toBe("ok");
      expect(control.result.status).toBe("ok");
      if (legacy.result.status !== "ok" || control.result.status !== "ok")
        return;

      expect(tokenize(legacy.result.components, rootDir)).toEqual(
        fixture.expectedComponents,
      );
      expect(tokenize(control.result.components, rootDir)).toEqual(
        fixture.expectedComponents,
      );
      expect(tokenize(control.result.dependencies, rootDir)).toEqual(
        fixture.expectedDependencies,
      );
      expect(tokenize(control.project.trackedFiles, rootDir)).toEqual(
        fixture.expectedProjectFiles,
      );
    });
  }

  test.each([
    true,
    false,
  ])("registry=%s shares one persistent language-service session and stays fresh", async (documentRegistry) => {
    const fixture = backendParityCorpus[1];
    const { fileName, rootDir } = materialize(fixture);
    const propsFile = path.join(rootDir, "props.ts");
    const backend = new Typescript6ControlBackend({
      options: { documentRegistry, shouldExtractValuesFromUnion: true },
      rootDir,
      selection,
    });
    await backend.initialize();
    const source = String(fixture.files["Components.tsx"]);
    await backend.analyze({ fileName, revision: 0, source });
    const update = await backend.update({
      affectedComponentFiles: [fileName],
      change: {
        fileName: propsFile,
        kind: "change",
        revision: 1,
        source: String(fixture.files["props.ts"]).replace(
          '"calm" | "strong"',
          '"calm" | "strong" | "fresh"',
        ),
      },
    });
    expect(update.status).toBe("ready");
    const result = await backend.analyze({ fileName, revision: 1, source });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(JSON.stringify(result.components)).toContain("fresh");
    }
    expect(backend.instrumentation.languageServicesCreated).toBe(1);
    await backend.dispose();
  });
});
