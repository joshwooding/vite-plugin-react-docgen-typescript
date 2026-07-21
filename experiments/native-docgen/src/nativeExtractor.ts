import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import {
  isBindingElement,
  isFunctionDeclaration,
  isIdentifier,
  isObjectBindingPattern,
  isParameterDeclaration,
  isStringLiteral,
  isVariableStatement,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "typescript7/unstable/ast";
import type {
  Checker,
  JSDocTagInfo,
  Symbol as NativeSymbol,
  Project,
  Signature,
  Type,
} from "typescript7/unstable/async";
import { SignatureKind, SymbolFlags } from "typescript7/unstable/async";
import { normalizeBoundaryPaths } from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/pathIdentity.ts";
import type {
  DocgenComponent,
  DocgenJsonValue,
  DocgenParent,
  DocgenProp,
} from "../../../packages/vite-plugin-react-docgen-typescript/src/docgen/types.ts";

export interface NativeExtractorOptions {
  componentNameResolver?: unknown;
  propFilter?: (input: { componentName: string; prop: DocgenProp }) => boolean;
  shouldExtractValuesFromUnion?: boolean;
  skipPropsWithoutDoc?: boolean;
}

export interface NativeExtractionInstrumentation {
  checkerRequests: number;
  componentCount: number;
  propCount: number;
}

export interface NativeExtractionResult {
  components: readonly DocgenComponent[];
  dependencies: readonly string[];
  instrumentation: NativeExtractionInstrumentation;
}

interface Candidate {
  identifier: Node;
  name: string;
}

const hasModifier = (node: Node, modifier: SyntaxKind): boolean =>
  "modifiers" in node &&
  Array.isArray(node.modifiers) &&
  node.modifiers.some((value) => value.kind === modifier);

const findCandidates = (sourceFile: SourceFile): Candidate[] => {
  const functions: Candidate[] = [];
  const variables: Candidate[] = [];

  for (const statement of sourceFile.statements) {
    if (
      isFunctionDeclaration(statement) &&
      hasModifier(statement, SyntaxKind.ExportKeyword) &&
      statement.name &&
      /^[A-Z]/.test(statement.name.text)
    ) {
      functions.push({ identifier: statement.name, name: statement.name.text });
      continue;
    }

    if (
      isVariableStatement(statement) &&
      hasModifier(statement, SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          isIdentifier(declaration.name) &&
          /^[A-Z]/.test(declaration.name.text)
        ) {
          variables.push({
            identifier: declaration.name,
            name: declaration.name.text,
          });
        }
      }
    }
  }

  return [...functions, ...variables];
};

const tagsToRecord = (
  tags: readonly JSDocTagInfo[],
): Readonly<Record<string, DocgenJsonValue>> => {
  const values: Record<string, DocgenJsonValue> = {};

  for (const tag of tags) {
    const value = tag.text ?? "";
    const existing = values[tag.name];
    if (existing === undefined) {
      values[tag.name] = value;
    } else if (Array.isArray(existing)) {
      values[tag.name] = [...existing, value];
    } else {
      values[tag.name] = [existing, value];
    }
  }

  return values;
};

const parentForSymbol = async (
  symbol: NativeSymbol,
  canonicalFiles: ReadonlyMap<string, string>,
): Promise<DocgenParent | undefined> => {
  const parent = await symbol.getParent();
  const declaration = symbol.declarations[0];
  if (!parent || !declaration) return undefined;
  const declarationPath = path.resolve(declaration.path);
  return {
    fileName:
      canonicalFiles.get(declarationPath.toLowerCase()) ?? declarationPath,
    name: parent.name,
  };
};

const declarationsForSymbol = async (
  symbol: NativeSymbol,
  canonicalFiles: ReadonlyMap<string, string>,
): Promise<readonly DocgenParent[] | undefined> => {
  const parent = await symbol.getParent();
  if (!parent || symbol.declarations.length === 0) return undefined;

  return symbol.declarations.map((declaration) => {
    const declarationPath = path.resolve(declaration.path);
    return {
      fileName:
        canonicalFiles.get(declarationPath.toLowerCase()) ?? declarationPath,
      name: parent.name,
    };
  });
};

const defaultValueFor = async (
  signature: Signature,
  project: Project,
  propName: string,
): Promise<DocgenJsonValue | null> => {
  const declaration = await signature.declaration?.resolve(project);
  if (!declaration) return null;
  let result: DocgenJsonValue | null = null;

  const visit = (node: Node): void => {
    if (result !== null) return;
    if (isBindingElement(node)) {
      const bindingName = node.propertyName ?? node.name;
      if (
        bindingName &&
        isIdentifier(bindingName) &&
        bindingName.text === propName &&
        node.initializer
      ) {
        result = {
          value: isStringLiteral(node.initializer)
            ? node.initializer.text
            : node.initializer.getText(),
        };
        return;
      }
    }

    node.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  };

  if (
    isParameterDeclaration(declaration) &&
    isObjectBindingPattern(declaration.name)
  ) {
    visit(declaration.name);
  } else {
    visit(declaration);
  }
  return result;
};

const typeForProp = async (
  checker: Checker,
  type: Type,
  options: NativeExtractorOptions,
  countRequest: () => void,
) => {
  countRequest();
  const raw = await checker.typeToString(type);
  let unionType = type;
  if (options.shouldExtractValuesFromUnion && !unionType.isUnionType()) {
    countRequest();
    const aliasSymbol = await unionType.getAliasSymbol();
    if (aliasSymbol) {
      countRequest();
      const declaredType = await checker.getDeclaredTypeOfSymbol(aliasSymbol);
      if (declaredType.isUnionType()) unionType = declaredType;
    }
  }
  if (!options.shouldExtractValuesFromUnion || !unionType.isUnionType()) {
    return { name: raw };
  }

  countRequest();
  const unionTypes = await unionType.getTypes();
  const value: Array<{ value: string }> = [];
  for (const unionType of unionTypes) {
    countRequest();
    value.push({ value: await checker.typeToString(unionType) });
  }

  return { name: "enum", raw, value };
};

const extractProps = async (
  checker: Checker,
  project: Project,
  signature: Signature,
  componentName: string,
  options: NativeExtractorOptions,
  instrumentation: NativeExtractionInstrumentation,
  canonicalFiles: ReadonlyMap<string, string>,
): Promise<Readonly<Record<string, DocgenProp>>> => {
  const props: Record<string, DocgenProp> = {};
  instrumentation.checkerRequests += 1;
  const parameters = await signature.getParameters();
  const parameter = parameters[0];
  const parameterDeclaration =
    await parameter?.declarations[0]?.resolve(project);
  if (!parameter || !parameterDeclaration) return props;

  instrumentation.checkerRequests += 1;
  const propsType = await checker.getTypeOfSymbolAtLocation(
    parameter,
    parameterDeclaration,
  );
  instrumentation.checkerRequests += 1;
  const properties = await checker.getPropertiesOfType(propsType);

  for (const property of properties) {
    const declaration = await property.declarations[0]?.resolve(project);
    if (!declaration) continue;
    instrumentation.checkerRequests += 1;
    const propertyType = await checker.getTypeOfSymbolAtLocation(
      property,
      declaration,
    );
    instrumentation.checkerRequests += 2;
    const [description, tags] = await Promise.all([
      property.getDocumentationComment(checker),
      property.getJsDocTags(checker),
    ]);
    const prop: DocgenProp = {
      defaultValue: await defaultValueFor(signature, project, property.name),
      description,
      name: property.name,
      required: (property.flags & SymbolFlags.Optional) === 0,
      tags: tagsToRecord(tags),
      type: await typeForProp(checker, propertyType, options, () => {
        instrumentation.checkerRequests += 1;
      }),
      ...((await parentForSymbol(property, canonicalFiles))
        ? { parent: await parentForSymbol(property, canonicalFiles) }
        : {}),
      ...((await declarationsForSymbol(property, canonicalFiles))
        ? {
            declarations: await declarationsForSymbol(property, canonicalFiles),
          }
        : {}),
    };

    if (options.skipPropsWithoutDoc && !description) continue;
    if (options.propFilter && !options.propFilter({ componentName, prop })) {
      continue;
    }
    props[property.name] = prop;
    instrumentation.propCount += 1;
  }

  return props;
};

const resolveRelativeImport = (
  containingFile: string,
  specifier: string,
  programFiles: ReadonlyMap<string, string>,
): string | undefined => {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(containingFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}.d.ts`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.d.ts"),
  ];
  return candidates
    .map((candidate) => programFiles.get(path.resolve(candidate).toLowerCase()))
    .find((candidate): candidate is string => Boolean(candidate));
};

const resolvePackageImport = (
  containingFile: string,
  specifier: string,
  programFiles: ReadonlyMap<string, string>,
): string | undefined => {
  const segments = specifier.split("/");
  const packageName = specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
  const packageSubpath = segments.slice(packageName.startsWith("@") ? 2 : 1);
  let directory = path.dirname(containingFile);

  while (true) {
    const packageRoot = path.join(directory, "node_modules", packageName);
    const packageJsonPath = path.join(packageRoot, "package.json");
    if (existsSync(packageJsonPath)) {
      let declaredTypes: string | undefined;
      try {
        const manifest = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
          exports?: { "."?: { types?: string } | string };
          types?: string;
          typings?: string;
        };
        const rootExport = manifest.exports?.["."];
        declaredTypes =
          manifest.types ??
          manifest.typings ??
          (typeof rootExport === "object" ? rootExport.types : undefined);
      } catch {
        // Candidate probing below remains deterministic for malformed manifests.
      }
      const base =
        packageSubpath.length > 0
          ? path.join(packageRoot, ...packageSubpath)
          : path.resolve(packageRoot, declaredTypes ?? "index");
      const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.mts`,
        `${base}.cts`,
        `${base}.d.ts`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
        path.join(base, "index.d.ts"),
      ];
      return candidates
        .map((candidate) => {
          const resolved = path.resolve(candidate);
          const direct = programFiles.get(resolved.toLowerCase());
          if (direct) return direct;
          try {
            return programFiles.get(
              realpathSync.native(resolved).toLowerCase(),
            );
          } catch {
            return undefined;
          }
        })
        .find((candidate): candidate is string => Boolean(candidate));
    }

    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
};

export const collectNativeDependencies = async (
  project: Project,
  entryFile: string,
): Promise<readonly string[]> => {
  const names = await project.program.getSourceFileNames();
  const programFiles = new Map<string, string>();
  for (const fileName of names) {
    const resolved = path.resolve(fileName);
    programFiles.set(resolved.toLowerCase(), resolved);
    try {
      programFiles.set(realpathSync.native(resolved).toLowerCase(), resolved);
    } catch {
      // Virtual overlay files have no physical identity yet.
    }
  }
  const visited = new Set<string>();
  const pending = [path.resolve(entryFile)];

  while (pending.length > 0) {
    const fileName = pending.pop();
    if (!fileName || visited.has(fileName)) continue;
    const sourceFile = await project.program.getSourceFile(fileName);
    if (
      !sourceFile ||
      (await project.program.isSourceFileDefaultLibrary(sourceFile))
    ) {
      continue;
    }
    visited.add(fileName);

    for (const importNode of sourceFile.imports) {
      const moduleSymbol =
        await project.checker.getSymbolAtLocation(importNode);
      let foundSymbolPath = false;
      for (const declaration of moduleSymbol?.declarations ?? []) {
        const dependency = programFiles.get(
          path.resolve(declaration.path).toLowerCase(),
        );
        if (dependency) {
          pending.push(dependency);
          foundSymbolPath = true;
        }
      }

      if (!foundSymbolPath) {
        const match = importNode.getText(sourceFile).match(/^['"](.+)['"]$/);
        const dependency = match?.[1]
          ? match[1].startsWith(".")
            ? resolveRelativeImport(fileName, match[1], programFiles)
            : resolvePackageImport(fileName, match[1], programFiles)
          : undefined;
        if (dependency) pending.push(dependency);
      }
    }

    for (const reference of sourceFile.referencedFiles) {
      const dependency = path.resolve(
        path.dirname(fileName),
        reference.fileName,
      );
      if (programFiles.has(dependency.toLowerCase())) pending.push(dependency);
    }
  }

  return normalizeBoundaryPaths(
    [...visited].map((fileName) => {
      try {
        return realpathSync.native(fileName);
      } catch {
        return fileName;
      }
    }),
  );
};

export const extractNativeComponents = async ({
  fileName,
  options,
  project,
  sourceFile,
}: {
  fileName: string;
  options: NativeExtractorOptions;
  project: Project;
  sourceFile: SourceFile;
}): Promise<NativeExtractionResult> => {
  if (options.componentNameResolver !== undefined) {
    throw new Error(
      "NATIVE_DOCGEN_UNSUPPORTED_OPTION: componentNameResolver requires legacy compiler symbols",
    );
  }

  const instrumentation: NativeExtractionInstrumentation = {
    checkerRequests: 0,
    componentCount: 0,
    propCount: 0,
  };
  const components: DocgenComponent[] = [];
  const canonicalFiles = new Map(
    (await project.program.getSourceFileNames()).map((programFile) => [
      path.resolve(programFile).toLowerCase(),
      path.resolve(programFile),
    ]),
  );

  for (const candidate of findCandidates(sourceFile)) {
    instrumentation.checkerRequests += 1;
    const symbol = await project.checker.getSymbolAtLocation(
      candidate.identifier,
    );
    if (!symbol) continue;
    instrumentation.checkerRequests += 1;
    const type = await project.checker.getTypeOfSymbolAtLocation(
      symbol,
      candidate.identifier,
    );
    instrumentation.checkerRequests += 1;
    const signatures = await project.checker.getSignaturesOfType(
      type,
      SignatureKind.Call,
    );
    const signature = signatures[0];
    if (!signature) continue;

    instrumentation.checkerRequests += 2;
    const [description, tags] = await Promise.all([
      symbol.getDocumentationComment(project.checker),
      symbol.getJsDocTags(project.checker),
    ]);
    components.push({
      description,
      displayName: candidate.name,
      filePath: path.resolve(fileName),
      methods: [],
      props: await extractProps(
        project.checker,
        project,
        signature,
        candidate.name,
        options,
        instrumentation,
        canonicalFiles,
      ),
      tags: tagsToRecord(tags),
      targetExpression: candidate.name,
    });
    instrumentation.componentCount += 1;
  }

  return {
    components,
    dependencies: await collectNativeDependencies(project, fileName),
    instrumentation,
  };
};
