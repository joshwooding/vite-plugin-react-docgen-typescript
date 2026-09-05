import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import typescript, * as typescriptNamespace from "typescript";
import typescript6 from "typescript6";
import typescript7 from "typescript7";
import typescript43 from "typescript43";
import { describe, expect, it, vi } from "vitest";
import { createLegacyBackendFactory } from "../docgen/legacyBackend";
import { resolveFileSelection } from "../utils/fileSelection";
import type { Options } from "../utils/options";
import * as typescriptCompatibility from "../utils/typescriptCompatibility";
import {
  loadTypescript,
  normalizeTypescriptModule,
  validateTypescriptModule,
} from "../utils/typescriptCompatibility";

describe("TypeScript compatibility", () => {
  it.each([
    ["4.3", typescript43],
    ["6", typescript],
  ] as const)("analyzes and updates ordinary imported props with the real TypeScript %s backend", async (_version, compilerModule) => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-typescript43-"));
    const componentFile = path.join(root, "Component.tsx");
    const propsFile = path.join(root, "props.ts");
    const extraFiles = {
      "required.ts": "export const value = true;",
      "defined.ts": "export const value = true;",
      "named-defined.ts": "export const value = true;",
      "augmented.ts": "export interface Original { value: string; }",
      "augmentation.ts":
        'export {}; declare module "./augmented" { interface Original { extra: string; } }',
    };
    const source = `declare namespace JSX { interface Element {} }
import type { Props } from "./props";
declare function require(specifier: string): unknown;
declare function define(...args: unknown[]): void;
const required = require("./required");
define(["./defined"], () => {});
define("named", ["./named-defined"], () => {});
import "./augmentation";
export const Component = (_props: Props): JSX.Element => null as unknown as JSX.Element;
`;
    const propsSource = (revision: number) => `export interface Props {
  /** Tone ${revision}. */
  tone: "tone-${revision}";
}`;
    writeFileSync(componentFile, source);
    writeFileSync(propsFile, propsSource(0));
    for (const [file, content] of Object.entries(extraFiles)) {
      writeFileSync(path.join(root, file), content);
    }
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "preserve",
          module: "CommonJS",
          moduleResolution: "Node",
          target: "ES2020",
          skipLibCheck: true,
        },
        files: ["Component.tsx", "props.ts", ...Object.keys(extraFiles)],
      }),
    );
    const compiler = await loadTypescript(() =>
      Promise.resolve(compilerModule),
    );
    const load = vi
      .spyOn(typescriptCompatibility, "loadTypescript")
      .mockResolvedValue(compiler);
    const options: Options = { tsconfigPath: path.join(root, "tsconfig.json") };
    const backend = await createLegacyBackendFactory(options).create({
      rootDir: root,
      selection: resolveFileSelection(root, options),
    });
    try {
      expect(compiler.version).toBe(compilerModule.version);
      for (const revision of [0, 1]) {
        if (revision > 0) {
          const props = propsSource(revision);
          writeFileSync(propsFile, props);
          expect(
            (
              await backend.update({
                affectedComponentFiles: [componentFile],
                change: {
                  fileName: propsFile,
                  kind: "change",
                  revision,
                  source: props,
                },
              })
            ).status,
          ).toBe("ready");
        }
        const result = await backend.analyze({
          fileName: componentFile,
          revision,
          source,
        });
        expect(result.status).toBe("ok");
        if (result.status !== "ok") throw new Error(result.error.message);
        expect(result.components[0]?.props.tone).toMatchObject({
          description: `Tone ${revision}.`,
          type: { name: `"tone-${revision}"` },
        });
        expect(result.dependencies).toEqual(
          [
            componentFile,
            propsFile,
            ...Object.keys(extraFiles).map((file) => path.join(root, file)),
          ].sort(),
        );
        expect(result.unresolvedDependencies).toEqual([]);
      }
      expect(load).toHaveBeenCalled();
    } finally {
      await backend.dispose();
      load.mockRestore();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("accepts the real TypeScript 4.3 lower-bound module", () => {
    expect(validateTypescriptModule(typescript43).version).toBe("4.3.5");
  });

  it("accepts the direct TypeScript 6 compiler module", () => {
    expect(validateTypescriptModule(typescript).version).toMatch(/^6\.0\./);
  });

  it("accepts the official TypeScript 6 compatibility wrapper", () => {
    expect(validateTypescriptModule(typescript6).version).toMatch(/^6\.0\./);
  });

  it("rejects the real TypeScript 7 module with a controlled diagnostic", () => {
    expect(() => validateTypescriptModule(typescript7)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /@joshwooding\/vite-plugin-react-docgen-typescript.*TypeScript JavaScript compiler API.*>=4\.3 <7.*TypeScript 7\.0\.2.*missing:.*#typescript-compatibility/i,
        ),
      }),
    );
  });

  it("normalizes namespace and default module wrappers", () => {
    expect(normalizeTypescriptModule(typescriptNamespace)).toBe(typescript);
    expect(normalizeTypescriptModule(typescript)).toBe(typescript);
    expect(normalizeTypescriptModule({ default: typescript })).toBe(typescript);
    expect(validateTypescriptModule({ default: typescript })).toBe(typescript);
  });

  it.each([
    ["null", null],
    ["empty object", {}],
    ["version-only object", { version: "7.0.2" }],
  ])("rejects a malformed %s without a property-access error", (_, value) => {
    expect(() => validateTypescriptModule(value)).toThrowError(
      expect.objectContaining({
        message: expect.stringMatching(
          /TypeScript JavaScript compiler API.*>=4\.3 <7.*missing:.*#typescript-compatibility/i,
        ),
      }),
    );

    expect(() => validateTypescriptModule(value)).not.toThrowError(
      /Cannot read properties of undefined/i,
    );
  });

  it("preserves the cause of a compiler load failure", async () => {
    const cause = new Error("module resolution failed");
    const load = loadTypescript(() => Promise.reject(cause));

    await expect(load).rejects.toMatchObject({
      cause,
      message: expect.stringMatching(
        /could not load the optional TypeScript peer dependency.*>=4\.3 <7.*#typescript-compatibility/i,
      ),
    });
  });
});
