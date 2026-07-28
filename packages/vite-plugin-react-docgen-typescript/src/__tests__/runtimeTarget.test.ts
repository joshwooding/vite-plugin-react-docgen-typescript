import type { ComponentDoc } from "react-docgen-typescript";
import typescript, { type ExportSpecifier, type SourceFile } from "typescript";
import { describe, expect, it } from "vitest";
import { resolveComponentDocRuntimeTargets } from "../utils/runtimeTarget";

const VIRTUAL_ROOT = "C:/runtime-target-tests";

const normalizePath = (fileName: string) =>
  fileName.replaceAll("\\", "/").toLowerCase();

const createProgram = (sources: Record<string, string>) => {
  const compilerOptions = {
    jsx: typescript.JsxEmit.React,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.Node10,
    noLib: true,
    target: typescript.ScriptTarget.ESNext,
  };
  const sourceTextByPath = new Map(
    Object.entries(sources).map(([fileName, source]) => [
      normalizePath(fileName),
      source,
    ]),
  );
  const host = typescript.createCompilerHost(compilerOptions, true);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultGetSourceFile = host.getSourceFile.bind(host);
  const defaultReadFile = host.readFile.bind(host);

  host.fileExists = (fileName) =>
    sourceTextByPath.has(normalizePath(fileName)) ||
    defaultFileExists(fileName);
  host.getCurrentDirectory = () => VIRTUAL_ROOT;
  host.getSourceFile = (
    fileName,
    languageVersion,
    onError,
    shouldCreateNewSourceFile,
  ) => {
    const source = sourceTextByPath.get(normalizePath(fileName));

    return source === undefined
      ? defaultGetSourceFile(
          fileName,
          languageVersion,
          onError,
          shouldCreateNewSourceFile,
        )
      : typescript.createSourceFile(fileName, source, languageVersion, true);
  };
  host.readFile = (fileName) =>
    sourceTextByPath.get(normalizePath(fileName)) ?? defaultReadFile(fileName);

  return typescript.createProgram({
    host,
    options: compilerOptions,
    rootNames: Object.keys(sources),
  });
};

const findExportSpecifier = (
  sourceFile: SourceFile,
  exportedName: string,
): ExportSpecifier => {
  let match: ExportSpecifier | undefined;

  const visit = (node: typescript.Node) => {
    if (typescript.isExportSpecifier(node) && node.name.text === exportedName) {
      match = node;
      return;
    }

    typescript.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!match) {
    throw new Error(`Missing export specifier for ${exportedName}`);
  }

  return match;
};

const createComponentDoc = (
  displayName: string,
  expression?: typescript.Symbol,
): ComponentDoc => ({
  description: "",
  displayName,
  expression,
  filePath: `${VIRTUAL_ROOT}/index.tsx`,
  methods: [],
  props: {},
});

const resolveExportTarget = (
  source: string,
  exportedName: string,
  additionalSources: Record<string, string> = {},
) => {
  const indexPath = `${VIRTUAL_ROOT}/index.tsx`;
  const program = createProgram({
    [indexPath]: source,
    ...additionalSources,
  });
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(indexPath);

  if (!sourceFile) {
    throw new Error("Missing virtual index source file");
  }

  const specifier = findExportSpecifier(sourceFile, exportedName);
  const symbol = checker.getSymbolAtLocation(specifier.name);

  expect(symbol).toBeDefined();
  expect((symbol?.flags ?? 0) & typescript.SymbolFlags.Alias).not.toBe(0);

  if (!symbol) {
    throw new Error(`Missing symbol for ${exportedName}`);
  }

  return resolveComponentDocRuntimeTargets(
    [createComponentDoc(exportedName, symbol)],
    checker,
    sourceFile,
    typescript,
  )[0]?.targetExpression;
};

describe("resolveComponentDocRuntimeTargets", () => {
  it("does not target a cross-module default re-export", () => {
    expect(
      resolveExportTarget(
        'export { default as TimespanInput } from "./TimespanInput";',
        "TimespanInput",
        {
          [`${VIRTUAL_ROOT}/TimespanInput.tsx`]:
            "export default function TimespanInput() { return null; }",
        },
      ),
    ).toBeNull();
  });

  it("targets the local binding in a local default export list", () => {
    expect(
      resolveExportTarget(
        "const Local = () => null; export { Local as default };",
        "default",
      ),
    ).toBe("Local");
  });

  it("targets the local binding in a local named export list", () => {
    expect(
      resolveExportTarget(
        "const Local = () => null; export { Local as Public };",
        "Public",
      ),
    ).toBe("Local");
  });

  it.each([
    [
      "named variable",
      "Named.tsx",
      "export const Named = () => null;",
      "Named",
    ],
    [
      "named function",
      "FunctionComponent.tsx",
      "export function FunctionComponent() { return null; }",
      "FunctionComponent",
    ],
    [
      "named class",
      "ClassComponent.tsx",
      "export class ClassComponent {}",
      "ClassComponent",
    ],
    [
      "named default declaration",
      "DefaultComponent.tsx",
      "export default function DefaultComponent() { return null; }",
      "DefaultComponent",
    ],
  ])("retains the %s target", (_, fileName, source, displayName) => {
    const sourcePath = `${VIRTUAL_ROOT}/${fileName}`;
    const program = createProgram({ [sourcePath]: source });
    const sourceFile = program.getSourceFile(sourcePath);

    if (!sourceFile) {
      throw new Error(`Missing virtual source file ${fileName}`);
    }

    expect(
      resolveComponentDocRuntimeTargets(
        [createComponentDoc(displayName)],
        program.getTypeChecker(),
        sourceFile,
        typescript,
      )[0]?.targetExpression,
    ).toBe(displayName);
  });
});
