import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Parser } from "react-docgen-typescript";
import { createServer, normalizePath, type ViteDevServer } from "vite";
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
