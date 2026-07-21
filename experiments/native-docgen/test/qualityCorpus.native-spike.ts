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

const QUALITY_LEDGER = {
  "discriminated unions": "unsupported/context-dependent",
  "false-positive one-parameter functions": "legacy defect retained",
  "forwardRef casts": "intentional improvement",
  "HOCs/factories": "intentional improvement",
  "inherited DOM-prop filtering": "unsupported/context-dependent",
  "methods/class components": "unsupported/context-dependent",
  "namespace/member imports": "unsupported/context-dependent",
  "Object.assign compound components": "intentional improvement",
  "polymorphic/default-generic": "intentional improvement",
} as const;

const createQualityFixture = () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "vprdts-native-quality-"));
  roots.push(rootDir);
  const sourceDir = path.join(rootDir, "src");
  mkdirSync(sourceDir, { recursive: true });
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
      files: ["src/quality.tsx"],
    }),
  );
  const fileName = path.join(sourceDir, "quality.tsx");
  writeFileSync(
    fileName,
    `// Compact patterns adapted for the spike from Flowbite (MIT), Reshaped
// (Apache-2.0), Park UI (MIT), Primer (MIT), and Mantine (MIT).
type Render<P> = (props: P) => unknown;
const forwardRef = <P,>(render: Render<P>) => render;
const withShell = <P,>(component: Render<P>) => component;

/** Forwarded component. */
export const Forwarded = forwardRef(({ tone }: { tone: "calm" | "strong" }) => tone);

/** Polymorphic component. */
export const Polymorphic = <T extends "button" | "a" = "button">({ as }: { as?: T }) => as;

/** Wrapped component. */
export const Wrapped = withShell(({ label }: { label: string }) => label);

/** Compound component. */
export const Compound = Object.assign(({ open }: { open?: boolean }) => open, {
  Item: ({ value }: { value: string }) => value,
});

/** A capitalized utility, not a React component. */
export function Utility(input: string): string { return input; }
`,
  );
  return { fileName, rootDir };
};

describe("native quality ledger", () => {
  test("quality categories are immutable and every wider gap is classified", () => {
    expect(QUALITY_LEDGER).toEqual({
      "discriminated unions": "unsupported/context-dependent",
      "false-positive one-parameter functions": "legacy defect retained",
      "forwardRef casts": "intentional improvement",
      "HOCs/factories": "intentional improvement",
      "inherited DOM-prop filtering": "unsupported/context-dependent",
      "methods/class components": "unsupported/context-dependent",
      "namespace/member imports": "unsupported/context-dependent",
      "Object.assign compound components": "intentional improvement",
      "polymorphic/default-generic": "intentional improvement",
    });
    expect(Object.values(QUALITY_LEDGER)).not.toContain("regression");
  });

  test("direct component-type path handles compact wrapper and compound patterns without probes", async () => {
    const { fileName, rootDir } = createQualityFixture();
    const backend = new NativeDocgenBackend({
      alias: "typescript7",
      options: { shouldExtractValuesFromUnion: true },
      rootDir,
      selection,
    });
    const result = await backend.analyze({
      fileName,
      revision: 0,
      source: readFileSync(fileName, "utf-8"),
    });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      const names = result.components.map(({ displayName }) => displayName);
      expect(names).toEqual([
        "Utility",
        "Forwarded",
        "Polymorphic",
        "Wrapped",
        "Compound",
      ]);
      expect(
        result.components.find(({ displayName }) => displayName === "Forwarded")
          ?.props,
      ).toHaveProperty("tone");
      expect(
        result.components.find(({ displayName }) => displayName === "Compound")
          ?.props,
      ).toHaveProperty("open");
    }
    expect(backend.instrumentation.snapshotsAdded).toBe(1);
    expect(backend.instrumentation.extractor.checkerRequests).toBeGreaterThan(
      0,
    );
    await backend.dispose();
  });
});

export { QUALITY_LEDGER };
