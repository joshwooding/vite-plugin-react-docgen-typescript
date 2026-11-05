import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type ComponentDoc, Parser } from "react-docgen-typescript";
import {
  createServer,
  type HotPayload,
  normalizePath,
  type ViteDevServer,
} from "vite";
import { describe, expect, it, vi } from "vitest";
import createPlugin from "../index";

const waitUntil = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(25);
  return predicate();
};

describe.each([
  "legacy",
  "project-service",
] as const)("external type watches in %s", (docgenMode) => {
  it.each([
    { cache: false, references: false },
    { cache: true, references: false },
    { cache: false, references: true },
    { cache: true, references: true },
  ])("delivers external edits with persistence $cache and references $references", async ({
    cache,
    references,
  }) => {
    const fixture = mkdtempSync(
      path.join(tmpdir(), "vite-rdt-external-watch-"),
    );
    const root = path.join(fixture, "app");
    const external = path.join(fixture, "shared/types.d.ts");
    const control = path.join(root, "src/control.js");
    mkdirSync(path.join(root, "src"), { recursive: true });
    mkdirSync(path.dirname(external), { recursive: true });
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "preserve",
          module: "ESNext",
          moduleResolution: "Bundler",
          types: [],
        },
        include: ["src/**/*", "../shared/**/*.d.ts"],
      }),
    );
    writeFileSync(
      path.join(root, "src/Component.tsx"),
      "import type { Props } from '../../shared/types';\nexport const Component = (_props: Props) => null;\nif (import.meta.hot) import.meta.hot.accept();\n",
    );
    writeFileSync(
      path.join(root, "src/Other.tsx"),
      "export const Other = (_props: { unaffected: boolean }) => null;\nif (import.meta.hot) import.meta.hot.accept();\n",
    );
    writeFileSync(
      control,
      "export const control = 1;\nif (import.meta.hot) import.meta.hot.accept();\n",
    );
    writeFileSync(external, "export interface Props { label: string }\n");
    if (references) {
      const compilerOptions = {
        composite: true,
        jsx: "preserve",
        module: "ESNext",
        moduleResolution: "Bundler",
        types: [],
      };
      for (const name of ["ui-a", "ui-b"]) {
        const project = path.join(fixture, name);
        mkdirSync(project);
        writeFileSync(
          path.join(project, "tsconfig.json"),
          JSON.stringify({ compilerOptions, include: ["Component.tsx"] }),
        );
        writeFileSync(
          path.join(project, "Component.tsx"),
          `import type { Props } from "../shared/${name === "ui-a" ? "types" : "other"}";\nexport const Component = (_props: Props) => null;\nif (import.meta.hot) import.meta.hot.accept();\n`,
        );
      }
      writeFileSync(
        path.join(fixture, "shared/other.d.ts"),
        "export interface Props { label: string }\n",
      );
      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          files: [],
          references: [{ path: "../ui-a" }, { path: "../ui-b" }],
        }),
      );
    }
    const componentUrl = references
      ? `/@fs/${normalizePath(path.join(fixture, "ui-a/Component.tsx"))}`
      : "/src/Component.tsx";
    const otherUrl = references
      ? `/@fs/${normalizePath(path.join(fixture, "ui-b/Component.tsx"))}`
      : "/src/Other.tsx";
    const start = () =>
      createServer({
        root,
        configFile: false,
        appType: "custom",
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        plugins: [
          createPlugin({
            docgenMode,
            tsconfigPath: path.join(root, "tsconfig.json"),
            include: references ? ["../ui-*/**/*.tsx"] : ["src/**/*.tsx"],
            exclude: [],
            fileSystemCache: cache
              ? { directory: path.join(root, ".cache") }
              : false,
          }),
        ],
        server: { middlewareMode: true, fs: { allow: [fixture] } },
      });
    let server: ViteDevServer | undefined;
    const extract = vi.spyOn(Parser.prototype, "getComponentInfo");
    try {
      if (cache) {
        server = await start();
        expect((await server.transformRequest(componentUrl))?.code).toContain(
          "__docgenInfo",
        );
        await server.close();
      }
      extract.mockClear();
      server = await start();
      const active = server;
      const events: { event: string; file: string }[] = [];
      active.watcher.on("all", (event, file) =>
        events.push({ event, file: normalizePath(file) }),
      );
      const initial = await active.transformRequest(componentUrl);
      if (cache) expect(extract).not.toHaveBeenCalled();
      else expect(extract).toHaveBeenCalledTimes(1);
      const other = await active.transformRequest(otherUrl);
      expect(initial?.code).toContain('"name": "string"');
      await active.transformRequest("/src/control.js");
      expect(
        await waitUntil(() => {
          const watched = active.watcher.getWatched();
          return (
            watched[normalizePath(path.dirname(control))] ??
            watched[path.dirname(control)] ??
            []
          ).includes(path.basename(control));
        }),
        "in-root control is watched",
      ).toBe(true);
      await delay(150);
      writeFileSync(
        control,
        "export const control = 2;\nif (import.meta.hot) import.meta.hot.accept();\n",
      );
      expect(
        await waitUntil(() =>
          events.some(
            ({ event, file }) =>
              event === "change" && file === normalizePath(control),
          ),
        ),
        "real in-root event",
      ).toBe(true);
      writeFileSync(external, "export interface Props { label: number }\n");
      expect(
        await waitUntil(() =>
          events.some(
            ({ event, file }) =>
              event === "change" && file === normalizePath(external),
          ),
        ),
        "real external declaration event",
      ).toBe(true);
      let updated = initial;
      const deadline = Date.now() + 5000;
      do {
        updated = await active.transformRequest(componentUrl);
        if (updated?.code.includes('"name": "number"')) break;
        await delay(25);
      } while (Date.now() < deadline);
      expect(updated?.code).toContain('"name": "number"');
      expect((await active.transformRequest(otherUrl))?.code).toEqual(
        other?.code,
      );
      for (const action of ["delete", "recreate"] as const) {
        if (action === "delete") rmSync(external);
        else {
          // Re-adding a missing file uses asynchronous watcher registration.
          await delay(150);
          writeFileSync(
            external,
            "export interface Props { label: boolean }\n",
          );
        }
        expect(
          await waitUntil(() =>
            events.some(
              ({ event, file }) =>
                event === (action === "delete" ? "unlink" : "add") &&
                file === normalizePath(external),
            ),
          ),
          `real external ${action} event`,
        ).toBe(true);
        const deadline = Date.now() + 5000;
        let matches = false;
        do {
          const response = await active.transformRequest(componentUrl);
          matches =
            action === "delete"
              ? Boolean(response && !response.code.includes('"label"'))
              : Boolean(response?.code.includes('"name": "boolean"'));
          if (matches) break;
          await delay(25);
        } while (Date.now() < deadline);
        expect(matches, `fresh metadata after ${action}`).toBe(true);
        expect((await active.transformRequest(otherUrl))?.code).toEqual(
          other?.code,
        );
      }
    } finally {
      await server?.close();
      expect(server?.watcher.listenerCount("unlink") ?? 0).toBe(0);
      extract.mockRestore();
      rmSync(fixture, { recursive: true, force: true });
    }
  }, 30_000);
});

const removeExplicitWatchFixture = (fixture: string) => {
  const relative = path.relative(path.resolve(tmpdir()), path.resolve(fixture));
  if (
    path.isAbsolute(relative) ||
    relative.startsWith("..") ||
    !relative.startsWith("vite-rdt-explicit-watch-")
  )
    throw new Error(`Unsafe fixture cleanup: ${fixture}`);
  rmSync(fixture, { recursive: true, force: true });
};

const componentNames = ["Component", "Second", "Other"] as const;
type ComponentName = (typeof componentNames)[number];

const semanticMetadata = (code: string) => {
  const match = code.match(/__docgenInfo\s*=\s*(\{[^\r\n]*\})/);
  if (!match) return null;
  const doc: ComponentDoc = JSON.parse(match[1]);
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
};
type Metadata = ReturnType<typeof semanticMetadata>;

// This is deliberately consumer configuration: runtime plugin source is unchanged.
describe.each([
  "legacy",
  "project-service",
] as const)("explicit startup external directory in %s", (docgenMode) => {
  it.each([
    false,
    true,
  ])("refreshes two missing imports with absent-seeded cache %s", async (cache) => {
    const fixture = mkdtempSync(
      path.join(tmpdir(), "vite-rdt-explicit-watch-"),
    );
    const root = path.join(fixture, "app");
    const externalTypesDirectory = path.join(fixture, "shared-types");
    const control = path.join(root, "src/control.js");
    const firstFile = path.join(externalTypesDirectory, "types.d.ts");
    // The nested directory exists at startup; this makes no new-directory claim.
    const secondFile = path.join(
      externalTypesDirectory,
      cache ? "nested/index.ts" : "other.ts",
    );
    mkdirSync(path.dirname(control), { recursive: true });
    mkdirSync(path.join(externalTypesDirectory, "nested"), { recursive: true });
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          jsx: "preserve",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          types: [],
        },
        include: ["src/**/*"],
      }),
    );
    for (const [name, specifier] of [
      ["Component", "../../shared-types/types"],
      [
        "Second",
        cache ? "../../shared-types/nested" : "../../shared-types/other",
      ],
    ]) {
      writeFileSync(
        path.join(root, "src", `${name}.tsx`),
        `import type { Props } from '${specifier}';\nexport const ${name} = (_props: Props) => null;\nif (import.meta.hot) import.meta.hot.accept();\n`,
      );
    }
    writeFileSync(
      path.join(root, "src/Other.tsx"),
      "export const Other = (_props: { /** Stable description. */ unaffected: boolean }) => null;\nif (import.meta.hot) import.meta.hot.accept();\n",
    );
    writeFileSync(
      control,
      "export const control = 1;\nif (import.meta.hot) import.meta.hot.accept();\n",
    );
    const declaration = (type: string, description: string, optional = false) =>
      `export interface Props {\n/** ${description} */\nlabel${optional ? "?" : ""}: ${type};\n/** Stable default.\n * @default 7\n */\namount?: number;\n}\n`;
    const start = async (
      useCache: boolean,
      watch: boolean,
      docs: Record<string, Metadata>,
    ) => {
      const plugin = createPlugin({
        docgenMode,
        tsconfigPath: path.join(root, "tsconfig.json"),
        include: ["src/**/*.tsx"],
        exclude: [],
        fileSystemCache: useCache
          ? { directory: path.join(root, ".cache") }
          : false,
      });
      const transformHook =
        typeof plugin.transform === "function"
          ? plugin.transform
          : plugin.transform?.handler;
      if (typeof transformHook !== "function")
        throw new Error("Expected callable docgen transform");
      let configured = !watch;
      plugin.transform = async function (...args) {
        expect(
          configured,
          "directory recipe runs before the first transform",
        ).toBe(true);
        const result = await transformHook.apply(this, args);
        const name = path.basename(args[1].split("?")[0], ".tsx");
        if (componentNames.includes(name as ComponentName)) {
          docs[name] = semanticMetadata(
            String(typeof result === "string" ? result : (result?.code ?? "")),
          );
        }
        return result;
      };
      return createServer({
        root,
        configFile: false,
        appType: "custom",
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        plugins: [
          plugin,
          ...(watch
            ? [
                {
                  name: "watch-external-types",
                  apply: "serve" as const,
                  config() {
                    if (!statSync(externalTypesDirectory).isDirectory()) {
                      throw new Error(
                        "externalTypesDirectory must be an existing directory",
                      );
                    }
                  },
                  configureServer(server: ViteDevServer) {
                    server.watcher.add(normalizePath(externalTypesDirectory));
                    configured = true;
                  },
                },
              ]
            : []),
        ],
        server: { middlewareMode: true, ...(watch ? {} : { watch: null }) },
      });
    };
    const loadAll = async (active: ViteDevServer) => {
      for (const name of componentNames)
        await active.transformRequest(`/src/${name}.tsx`);
    };
    const oracle = async () => {
      const docs: Record<string, Metadata> = {};
      const fresh = await start(false, false, docs);
      try {
        await loadAll(fresh);
        return docs;
      } finally {
        await fresh.close();
      }
    };
    let server: ViteDevServer | undefined;
    const extract = vi.spyOn(Parser.prototype, "getComponentInfo");
    const events: { event: string; file: string }[] = [];
    try {
      if (cache) {
        server = await start(true, true, {});
        await loadAll(server);
        expect(extract).toHaveBeenCalledTimes(3);
        await server.close();
        server = undefined;
      }
      extract.mockClear();
      const docs: Record<string, Metadata> = {};
      server = await start(cache, true, docs);
      const active = server;
      active.watcher.on("all", (event, file) =>
        events.push({ event, file: normalizePath(file) }),
      );
      const payloads: HotPayload[] = [];
      const hot = active.environments.client.hot;
      const send = hot.send;
      hot.send = function (...args: [HotPayload] | [string, unknown?]) {
        if (typeof args[0] === "object")
          payloads.push(structuredClone(args[0]));
        return Reflect.apply(send, this, args);
      };
      await loadAll(active);
      expect(extract).toHaveBeenCalledTimes(cache ? 0 : 3);
      expect(docs.Component?.props).toEqual({});
      expect(docs.Second?.props).toEqual({});
      expect(docs.Other?.props.unaffected.type.name).toBe("boolean");
      expect(docs).toEqual(await oracle());
      await active.transformRequest("/src/control.js");
      expect(
        await waitUntil(() => {
          const watched = active.watcher.getWatched();
          return (
            Object.keys(watched).some(
              (directory) =>
                normalizePath(directory) ===
                normalizePath(path.dirname(secondFile)),
            ) &&
            (
              watched[normalizePath(path.dirname(control))] ??
              watched[path.dirname(control)] ??
              []
            ).includes(path.basename(control))
          );
        }),
        "control and chosen existing directory are registered",
      ).toBe(true);
      await delay(150);
      writeFileSync(
        control,
        "export const control = 2;\nif (import.meta.hot) import.meta.hot.accept();\n",
      );
      expect(
        await waitUntil(() =>
          events.some(
            ({ event, file }) =>
              event === "change" && file === normalizePath(control),
          ),
        ),
        "real in-root control",
      ).toBe(true);
      await delay(150);
      const mutate = async (
        phase: string,
        file: string,
        source: string | undefined,
        affected: ComponentName,
        type: string | undefined,
        description?: string,
        required = true,
      ) => {
        const previous = structuredClone(docs);
        events.length = 0;
        payloads.length = 0;
        if (source === undefined) rmSync(file);
        else writeFileSync(file, source);
        const eventType =
          source === undefined
            ? "unlink"
            : phase.includes("edit")
              ? "change"
              : "add";
        expect(
          await waitUntil(() =>
            events.some(
              (event) =>
                event.event === eventType && event.file === normalizePath(file),
            ),
          ),
          `real ${phase} event`,
        ).toBe(true);
        const expected = await oracle();
        if (type === undefined)
          expect(expected[affected]?.props.label).toBeUndefined();
        else {
          expect(expected[affected]?.props.label).toMatchObject({
            type: { name: type },
            description,
            required,
          });
          expect(expected[affected]?.props.amount.defaultValue).toEqual({
            value: "7",
          });
        }
        expect(
          expected[affected],
          `${phase} changes full semantic metadata`,
        ).not.toEqual(previous[affected]);
        for (const name of componentNames.filter((name) => name !== affected))
          expect(expected[name]).toEqual(previous[name]);
        const deadline = Date.now() + 5000;
        do {
          await loadAll(active);
          if (JSON.stringify(docs) === JSON.stringify(expected)) break;
          await delay(25);
        } while (Date.now() < deadline);
        expect(docs, `${phase} equals a fresh cache-disabled backend`).toEqual(
          expected,
        );
        // Keep observing after metadata is fresh so delayed unrelated updates cannot escape.
        await delay(200);
        expect(
          payloads.filter(
            (payload) =>
              payload.type === "full-reload" || payload.type === "error",
          ),
          phase,
        ).toEqual([]);
        const delivered = payloads.flatMap((payload) =>
          payload.type === "update"
            ? payload.updates.map((update) => update.path)
            : [],
        );
        expect(
          [...new Set(delivered)].sort(),
          `${phase} exact affected delivery`,
        ).toEqual([`/src/${affected}.tsx`]);
      };
      await mutate(
        "first-create",
        firstFile,
        declaration("string", "First created."),
        "Component",
        "string",
        "First created.",
      );
      await mutate(
        "second-create",
        secondFile,
        declaration("boolean", "Second created."),
        "Second",
        "boolean",
        "Second created.",
      );
      await mutate(
        "first-edit",
        firstFile,
        declaration("number", "First edited.", true),
        "Component",
        "number | undefined",
        "First edited.",
        false,
      );
      await mutate(
        "first-delete",
        firstFile,
        undefined,
        "Component",
        undefined,
      );
      await delay(150);
      await mutate(
        "first-recreate",
        firstFile,
        declaration("boolean", "First recreated."),
        "Component",
        "boolean",
        "First recreated.",
      );
      await active.close();
      expect(Object.keys(active.watcher.getWatched())).toEqual([]);
      expect(active.watcher.listenerCount("unlink")).toBe(0);
      const closedEventCount = events.length;
      writeFileSync(control, "export const control = 3;\n");
      writeFileSync(firstFile, declaration("string", "After close."));
      await delay(150);
      expect(events).toHaveLength(closedEventCount);
      server = undefined;
    } finally {
      await server?.close();
      extract.mockRestore();
      removeExplicitWatchFixture(fixture);
    }
  }, 60_000);
});
