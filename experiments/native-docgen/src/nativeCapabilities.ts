import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isIdentifier, type Node } from "typescript7/unstable/ast";
import type {
  API as StableAPI,
  Snapshot as StableSnapshot,
} from "typescript7/unstable/async";

export type NativeAlias = "typescript7" | "typescript7next";

export interface NativeCapabilityResult {
  alias: NativeAlias;
  firstMissing?: string;
  subpaths: readonly string[];
  version: string;
}

type NativeAsyncModule = typeof import("typescript7/unstable/async");

const require = createRequire(import.meta.url);

export const loadNativeAsync = async (
  alias: NativeAlias,
): Promise<NativeAsyncModule> =>
  alias === "typescript7"
    ? import("typescript7/unstable/async")
    : (import(
        "typescript7next/unstable/async"
      ) as unknown as Promise<NativeAsyncModule>);

export const readNativeVersion = (alias: NativeAlias): string => {
  const packagePath = require.resolve(`${alias}/package.json`);
  return JSON.parse(readFileSync(packagePath, "utf-8")).version as string;
};

const findIdentifier = (root: Node, text: string): Node | undefined => {
  if (isIdentifier(root) && root.text === text) return root;
  let found: Node | undefined;
  root.forEachChild((child) => {
    if (found) return found;
    found = findIdentifier(child, text);
    return found;
  });
  return found;
};

export const probeNativeCapabilities = async ({
  alias,
  configFile,
  rootDir,
}: {
  alias: NativeAlias;
  configFile: string;
  rootDir: string;
}): Promise<NativeCapabilityResult> => {
  const version = readNativeVersion(alias);
  const subpaths = [
    `${alias}/unstable/async`,
    `${alias}/unstable/fs`,
    `${alias}/unstable/ast`,
    `${alias}/unstable/ast/is`,
  ] as const;
  let api: StableAPI | undefined;
  let snapshot: StableSnapshot | undefined;
  let step = "module loading";

  try {
    const [{ API, SignatureKind }, fsModule] = await Promise.all([
      loadNativeAsync(alias),
      alias === "typescript7"
        ? import("typescript7/unstable/fs")
        : import("typescript7next/unstable/fs"),
    ]);
    if (typeof fsModule.createVirtualFileSystem !== "function") {
      throw new Error("createVirtualFileSystem is unavailable");
    }

    step = "API/session creation";
    api = new API({ collectTiming: true, cwd: rootDir });
    step = "tsconfig parsing";
    const parsed = await api.parseConfigFile(configFile);
    if (parsed.fileNames.length === 0) throw new Error("no configured files");

    step = "snapshot/project discovery";
    snapshot = await api.updateSnapshot({ openProjects: [configFile] });
    const project =
      snapshot.getProject(configFile) ?? snapshot.getProjects()[0];
    if (!project) throw new Error("no project");

    step = "program/source discovery";
    const sourceFileName = parsed.fileNames.find((fileName) =>
      fileName.endsWith("component.tsx"),
    );
    if (!sourceFileName) throw new Error("component source is absent");
    const sourceFile = await project.program.getSourceFile(sourceFileName);
    if (!sourceFile) throw new Error("component source cannot be loaded");

    step = "AST/symbol operations";
    const identifier = findIdentifier(sourceFile, "CapabilityComponent");
    if (!identifier) throw new Error("component identifier is absent");
    const symbol = await project.checker.getSymbolAtLocation(identifier);
    if (!symbol) throw new Error("component symbol is absent");
    if (symbol.declarations.length === 0)
      throw new Error("component declarations are absent");

    step = "type/checker operations";
    const type = await project.checker.getTypeOfSymbolAtLocation(
      symbol,
      identifier,
    );
    const signatures = await project.checker.getSignaturesOfType(
      type,
      SignatureKind.Call,
    );
    if (signatures.length === 0) throw new Error("call signature is absent");
    const parameters = await signatures[0].getParameters();
    if (parameters.length === 0) throw new Error("props parameter is absent");
    const parameterDeclaration =
      await parameters[0].declarations[0]?.resolve(project);
    if (!parameterDeclaration) throw new Error("props declaration is absent");
    const propsType = await project.checker.getTypeOfSymbolAtLocation(
      parameters[0],
      parameterDeclaration,
    );
    const properties = await project.checker.getPropertiesOfType(propsType);
    if (properties[0]?.name !== "tone")
      throw new Error("props properties are absent");
    if (!(await project.checker.typeToString(propsType)))
      throw new Error("type string is absent");

    step = "documentation/tag operations";
    if (!(await symbol.getDocumentationComment(project.checker)))
      throw new Error("documentation is absent");
    const tags = await properties[0].getJsDocTags(project.checker);
    if (!tags.some((tag) => tag.name === "remarks"))
      throw new Error("JSDoc tags are absent");

    step = "timing/bulk operations";
    const timing = await api.getTimingInfo();
    if (!timing.enabled) throw new Error("timing collection is unavailable");

    return { alias, subpaths, version };
  } catch (error) {
    return {
      alias,
      firstMissing: `${step}: ${error instanceof Error ? error.message : String(error)}`,
      subpaths,
      version,
    };
  } finally {
    await snapshot?.dispose().catch(() => undefined);
    await api?.close().catch(() => undefined);
  }
};
