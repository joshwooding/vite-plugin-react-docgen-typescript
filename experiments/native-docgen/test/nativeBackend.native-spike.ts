import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
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
