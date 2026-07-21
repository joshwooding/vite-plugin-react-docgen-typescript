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
import {
  type NativeAlias,
  probeNativeCapabilities,
} from "../src/nativeCapabilities.ts";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const createCapabilityFixture = () => {
  const rootDir = mkdtempSync(path.join(tmpdir(), "vprdts-native-capability-"));
  temporaryRoots.push(rootDir);
  const sourceDir = path.join(rootDir, "src");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(
    path.join(rootDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { jsx: "preserve", strict: true },
      include: ["src"],
    }),
  );
  writeFileSync(
    path.join(sourceDir, "component.tsx"),
    `export interface CapabilityProps {
  /** Tone value. @remarks capability-tag */
  tone: "calm" | "strong";
}

/** Capability component. */
export function CapabilityComponent(props: CapabilityProps) {
  return <button>{props.tone}</button>;
}
`,
  );
  return { configFile: path.join(rootDir, "tsconfig.json"), rootDir };
};

const selection = {
  exclude: [],
  hasIncludes: true,
  include: ["**/*.tsx"],
  matchesDocgenFile: (fileName: string) => fileName.endsWith(".tsx"),
};

const createBackend = (
  alias: NativeAlias,
  rootDir: string,
  options: { shouldExtractValuesFromUnion?: boolean } = {
    shouldExtractValuesFromUnion: true,
  },
) => new NativeDocgenBackend({ alias, options, rootDir, selection });

const unionValues = (
  result: Awaited<ReturnType<NativeDocgenBackend["analyze"]>>,
): string[] => {
  if (result.status !== "ok") return [];
  const value = result.components[0]?.props.tone?.type.value;
  return Array.isArray(value)
    ? value
        .map((entry) =>
          entry && typeof entry === "object" && "value" in entry
            ? String(entry.value)
            : "",
        )
        .filter(Boolean)
    : [];
};

describe.each([
  "typescript7",
  "typescript7next",
] as const)("%s capability", (alias: NativeAlias) => {
  test("capability inventory exposes the required high-level surface", async () => {
    const result = await probeNativeCapabilities({
      alias,
      ...createCapabilityFixture(),
    });
    expect(result).toMatchObject({
      alias,
      version: alias === "typescript7" ? "7.0.2" : "7.1.0-dev.20260719.1",
    });
    expect(result.firstMissing).toBeUndefined();
    expect(result.subpaths).toHaveLength(4);
  });
});

describe.each([
  "typescript7",
  "typescript7next",
] as const)("%s overlay snapshot lifecycle", (alias: NativeAlias) => {
  test("overlay source is analyzed without writing the user file", async () => {
    const { rootDir } = createCapabilityFixture();
    const fileName = path.join(rootDir, "src", "component.tsx");
    const diskSource = readFileSync(fileName, "utf-8");
    const source = diskSource.replace(
      'tone: "calm" | "strong";',
      'tone: "calm" | "strong" | "overlay";',
    );
    const backend = createBackend(alias, rootDir);

    const result = await backend.analyze({ fileName, revision: 1, source });

    expect(result.status).toBe("ok");
    expect(unionValues(result)).toContain('"overlay"');
    expect(readFileSync(fileName, "utf-8")).toBe(diskSource);
    await backend.dispose();
    expect(backend.instrumentation.snapshotsDisposed).toBe(
      backend.instrumentation.snapshotsAdded,
    );
  });

  test("virtual create and delete update existence and project membership", async () => {
    const { rootDir } = createCapabilityFixture();
    const backend = createBackend(alias, rootDir);
    await backend.initialize();
    const fileName = path.join(rootDir, "src", "Virtual.tsx");
    const source = `export interface VirtualProps { value: string }
export const VirtualComponent = (_props: VirtualProps) => null;
`;

    const created = await backend.update({
      affectedComponentFiles: [fileName],
      change: { fileName, kind: "create", revision: 1, source },
    });
    expect(created.status).toBe("pending");
    if (created.status !== "pending")
      throw new Error("pending create expected");
    const createCompletion = await created.ready;
    expect(createCompletion.status).toBe("ready");
    if (createCompletion.status === "ready") {
      expect(createCompletion.project.trackedFiles).toContain(
        path.resolve(fileName),
      );
    }
    expect(existsOnDisk(fileName)).toBe(false);

    const deleted = await backend.update({
      affectedComponentFiles: [fileName],
      change: { fileName, kind: "delete", revision: 2 },
    });
    if (deleted.status !== "pending")
      throw new Error("pending delete expected");
    const deleteCompletion = await deleted.ready;
    expect(deleteCompletion.status).toBe("ready");
    if (deleteCompletion.status === "ready") {
      expect(deleteCompletion.project.trackedFiles).not.toContain(
        path.resolve(fileName),
      );
    }
    await backend.dispose();
  });
});

const existsOnDisk = (fileName: string): boolean => {
  try {
    readFileSync(fileName);
    return true;
  } catch {
    return false;
  }
};

describe("reference, revision, dependency, and dispose lifecycle", () => {
  const createReferenceFixture = () => {
    const commonRoot = mkdtempSync(
      path.join(tmpdir(), "vprdts-native-reference-"),
    );
    temporaryRoots.push(commonRoot);
    const rootDir = path.join(commonRoot, "app");
    const uiRoot = path.join(commonRoot, "ui");
    const sourceDir = path.join(uiRoot, "src");
    mkdirSync(rootDir, { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      path.join(rootDir, "tsconfig.json"),
      JSON.stringify({ files: [], references: [{ path: "../ui" }] }),
    );
    writeFileSync(
      path.join(uiRoot, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          composite: true,
          jsx: "preserve",
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ES2020",
        },
        files: ["src/Component.tsx", "src/Other.tsx", "src/props.ts"],
      }),
    );
    const component = path.join(sourceDir, "Component.tsx");
    const other = path.join(sourceDir, "Other.tsx");
    const props = path.join(sourceDir, "props.ts");
    writeFileSync(
      component,
      `import type { ImportedProps } from "./props";
export const DependentOne = ({ tone }: ImportedProps) => tone;
export const DependentTwo = ({ tone }: ImportedProps) => tone;
`,
    );
    writeFileSync(
      other,
      `export interface OtherProps { value: string }
export const Unrelated = ({ value }: OtherProps) => value;
`,
    );
    writeFileSync(
      props,
      `export interface ImportedProps {
  /** Initial tone. */
  tone: "base" | "quiet";
}
`,
    );
    return { component, other, props, rootDir };
  };

  test("referenced project observes two edits and exact selective dependencies", async () => {
    const fixture = createReferenceFixture();
    const backend = createBackend("typescript7", fixture.rootDir);
    const state = await backend.initialize();
    expect(state.configFiles).toHaveLength(2);
    expect(state.trackedFiles).toEqual(
      expect.arrayContaining([
        path.resolve(fixture.component),
        path.resolve(fixture.other),
        path.resolve(fixture.props),
      ]),
    );

    let revision = 1;
    for (const member of ["contrast", "emphasis"]) {
      const source = `export interface ImportedProps {
  /** ${member} tone. */
  tone: "base" | "quiet" | "${member}";
}
`;
      const update = await backend.update({
        affectedComponentFiles: [fixture.component],
        change: {
          fileName: fixture.props,
          kind: "change",
          revision,
          source,
        },
      });
      if (update.status !== "pending")
        throw new Error("pending update expected");
      expect((await update.ready).status).toBe("ready");
      const result = await backend.analyze({
        fileName: fixture.component,
        revision,
        source: readFileSync(fixture.component, "utf-8"),
      });
      expect(unionValues(result)).toContain(`"${member}"`);
      if (result.status === "ok") {
        expect(result.dependencies).toEqual([
          path.resolve(fixture.component),
          path.resolve(fixture.props),
        ]);
        expect(result.dependencies).not.toContain(path.resolve(fixture.other));
        expect(result.components).toHaveLength(2);
      }
      revision += 1;
    }
    await backend.dispose();
  });

  test("rapid revisions supersede older work and disposal settles pending work", async () => {
    const fixture = createReferenceFixture();
    const backend = createBackend("typescript7", fixture.rootDir);
    await backend.initialize();
    const first = await backend.update({
      affectedComponentFiles: [fixture.component],
      change: {
        fileName: fixture.props,
        kind: "change",
        revision: 1,
        source: readFileSync(fixture.props, "utf-8").replace("quiet", "first"),
      },
    });
    const second = await backend.update({
      affectedComponentFiles: [fixture.component],
      change: {
        fileName: fixture.props,
        kind: "change",
        revision: 2,
        source: readFileSync(fixture.props, "utf-8").replace("quiet", "second"),
      },
    });
    if (first.status !== "pending" || second.status !== "pending") {
      throw new Error("pending revisions expected");
    }
    await expect(first.ready).resolves.toMatchObject({
      revision: 1,
      status: "superseded",
      supersededBy: 2,
    });
    await expect(second.ready).resolves.toMatchObject({
      revision: 2,
      status: "ready",
    });

    const third = await backend.update({
      affectedComponentFiles: [fixture.component],
      change: {
        fileName: fixture.props,
        kind: "change",
        revision: 3,
        source: readFileSync(fixture.props, "utf-8").replace("quiet", "third"),
      },
    });
    if (third.status !== "pending")
      throw new Error("pending revision expected");
    await backend.dispose();
    await expect(third.ready).resolves.toMatchObject({
      revision: 3,
      status: "disposed",
    });
  });
});
