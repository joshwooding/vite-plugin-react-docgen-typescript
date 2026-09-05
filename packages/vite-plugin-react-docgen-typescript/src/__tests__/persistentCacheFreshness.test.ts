import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Parser } from "react-docgen-typescript";
import { describe, expect, it, vi } from "vitest";
import { createLegacyBackendFactory } from "../docgen/legacyBackend";
import { createPlugin } from "../plugin";
import type { Options } from "../utils/options";

describe.each([
  "legacy",
  "project-service",
] as const)("persistent project membership in %s", (docgenMode) => {
  it.each([
    "global",
    "augmentation",
    "type-root",
    "module-to-global",
    "missing-baseline",
    "malformed-baseline",
    "noncanonical-baseline",
    "unsupported-validation",
    "unchanged",
  ])("validates %s against a fresh same-path analysis", async (kind) => {
    const root = mkdtempSync(path.join(tmpdir(), "vite-rdt-freshness-"));
    const component = path.join(root, "src/Component.tsx");
    const global =
      kind === "global" || kind === "type-root" || kind === "module-to-global";
    mkdirSync(path.dirname(component), { recursive: true });
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "preserve",
          module: "ESNext",
          moduleResolution: "Bundler",
          types: [],
          ...(kind === "type-root"
            ? { types: ["added"], typeRoots: ["./type-roots"] }
            : {}),
        },
        include: ["src/**/*"],
      }),
    );
    writeFileSync(
      component,
      `${global ? "" : "import type { Props } from './types';\n"}export const Component = (_props: ${global ? "GlobalProps" : "Props"}) => null;\n`,
    );
    writeFileSync(
      path.join(root, "src/types.ts"),
      "export interface Props { label: string }\n",
    );
    writeFileSync(
      path.join(root, "src/globals.d.ts"),
      "interface GlobalProps { label: string }\n",
    );
    writeFileSync(path.join(root, "src/unrelated.d.ts"), "export {};\n");
    const analyze = vi.fn();
    const extract = vi.spyOn(Parser.prototype, "getComponentInfo");
    const hit = vi.fn();
    const initialized = vi.fn();
    const validated = vi.fn();
    const transform = async (cache: boolean) => {
      const options: Options = {
        docgenMode,
        tsconfigPath: "tsconfig.json",
        include: ["src/**/*.tsx"],
        exclude: [],
        fileSystemCache: cache
          ? { directory: path.join(root, ".cache") }
          : false,
      };
      const factory = createLegacyBackendFactory(options);
      const plugin = createPlugin(options, {
        ...factory,
        async create(context) {
          const backend = await factory.create(context);
          const original = backend.analyze;
          backend.analyze = async (input) => {
            analyze();
            return original(input);
          };
          const originalInitialize = backend.initialize;
          backend.initialize = async () => {
            const state = await originalInitialize();
            initialized(state);
            return state;
          };
          const prepare = backend.prepareCacheValidation;
          backend.prepareCacheValidation =
            kind === "unsupported-validation"
              ? undefined
              : async (input) => {
                  const state = await prepare?.(input);
                  validated(state);
                  return state;
                };
          const recordHit = backend.recordCacheHit;
          backend.recordCacheHit = (input) => {
            hit(input);
            recordHit(input);
          };
          return backend;
        },
      });
      try {
        // @ts-expect-error Focused harness supplies the fields used by the plugin.
        await plugin.configResolved?.({ command: "serve", root });
        const result = await plugin.transform?.call(
          {
            addWatchFile: vi.fn(),
            warn: (message: string) => {
              throw new Error(message);
            },
          } as never,
          readFileSync(component, "utf8"),
          component,
        );
        return typeof result === "object" && result ? result.code : result;
      } finally {
        if (typeof plugin.closeBundle === "function")
          await plugin.closeBundle.call({} as never);
      }
    };
    try {
      const seed = await transform(true);
      expect(seed).toContain('"label"');
      if (kind === "global")
        writeFileSync(
          path.join(root, "src/added.d.ts"),
          "interface GlobalProps { added: boolean }\n",
        );
      if (kind === "augmentation")
        writeFileSync(
          path.join(root, "src/added.d.ts"),
          "import './types';\ndeclare module './types' { interface Props { added: boolean } }\nexport {};\n",
        );
      if (kind === "module-to-global")
        writeFileSync(
          path.join(root, "src/unrelated.d.ts"),
          "interface GlobalProps { added: boolean }\n",
        );
      if (kind === "type-root") {
        mkdirSync(path.join(root, "type-roots/added"), { recursive: true });
        writeFileSync(
          path.join(root, "type-roots/added/index.d.ts"),
          "interface GlobalProps { added: boolean }\n",
        );
      }
      if (kind.endsWith("baseline")) {
        const cacheDir = path.join(
          root,
          ".cache",
          readdirSync(path.join(root, ".cache"))[0],
        );
        const entryPath = path.join(cacheDir, readdirSync(cacheDir)[0]);
        const entry = JSON.parse(readFileSync(entryPath, "utf8"));
        if (kind === "missing-baseline") delete entry.proof.trackedFiles;
        if (kind === "malformed-baseline") entry.proof.trackedFiles = [null];
        if (kind === "noncanonical-baseline")
          entry.proof.trackedFiles.reverse();
        writeFileSync(entryPath, JSON.stringify(entry));
      }
      analyze.mockClear();
      extract.mockClear();
      initialized.mockClear();
      const cached = await transform(true);
      if (kind === "unchanged") {
        expect(analyze).not.toHaveBeenCalled();
        expect(extract).not.toHaveBeenCalled();
        expect(hit).toHaveBeenCalledWith({
          cache: "persistent",
          fileName: component,
        });
      } else {
        expect(analyze).toHaveBeenCalledTimes(1);
      }
      if (kind === "type-root" && docgenMode === "project-service") {
        const added = path.join(root, "type-roots/added/index.d.ts");
        expect(initialized.mock.calls[0][0].trackedFiles).not.toContain(added);
        expect(validated.mock.calls[0][0].project.trackedFiles).toContain(
          added,
        );
      }
      const oracle = await transform(false);
      if (
        ["global", "augmentation", "type-root", "module-to-global"].includes(
          kind,
        )
      )
        expect(oracle).toContain('"added"');
      expect(cached).toEqual(oracle);
    } finally {
      extract.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
