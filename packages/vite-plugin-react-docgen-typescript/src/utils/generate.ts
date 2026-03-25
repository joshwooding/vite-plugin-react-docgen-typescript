/**
 * Copied from https://github.com/storybookjs/react-docgen-typescript-plugin/blob/74bb959f468fd6dee7cbc7c8b68cc01e4bcb343c/src/generateDocgenCodeBlock.ts
 * But refactored to remove deprecated functions.
 **/

import type { ComponentDoc, PropItem } from "react-docgen-typescript";
import type { ComponentDocWithTarget } from "./runtimeTarget";

export interface GeneratorOptions {
  filename: string;
  source: string;
  componentDocs: ComponentDocWithTarget[];
  setDisplayName: boolean;
  typePropName: string;
}

type SerializableDocgenValue =
  | null
  | boolean
  | number
  | string
  | SerializableDocgenValue[]
  | { [key: string]: SerializableDocgenValue };

const IDENTIFIER_PATH_PATTERN = /^[$A-Z_a-z][$\w]*(?:\.[$A-Z_a-z][$\w]*)*$/;
const LOOSE_EXPRESSION_PATTERN = /^[$A-Z_a-z0-9.-]+$/;

function getTargetExpression(targetExpression: string | null): string | null {
  if (!targetExpression) {
    return null;
  }

  if (IDENTIFIER_PATH_PATTERN.test(targetExpression)) {
    return targetExpression;
  }

  if (LOOSE_EXPRESSION_PATTERN.test(targetExpression)) {
    return targetExpression;
  }

  return null;
}

function sanitizeDocgenValue(
  value: unknown,
  seen = new WeakSet<object>(),
): SerializableDocgenValue | undefined {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const sanitizedItem = sanitizeDocgenValue(item, seen);
      return sanitizedItem === undefined ? [] : [sanitizedItem];
    });
  }

  if (typeof value !== "object") {
    return undefined;
  }

  if (seen.has(value)) {
    return undefined;
  }

  seen.add(value);

  const sanitizedEntries = Object.entries(value).flatMap(
    ([key, entryValue]) => {
      const sanitizedValue = sanitizeDocgenValue(entryValue, seen);
      return sanitizedValue === undefined
        ? []
        : [[key, sanitizedValue] as const];
    },
  );

  seen.delete(value);

  return Object.fromEntries(sanitizedEntries);
}

function createPropDefinition(
  prop: PropItem,
  options: GeneratorOptions,
): Record<string, unknown> {
  const declarations = sanitizeDocgenValue(prop.declarations);
  const parent = sanitizeDocgenValue(prop.parent);
  const tags = sanitizeDocgenValue(prop.tags) ?? {};
  const defaultValue = sanitizeDocgenValue(prop.defaultValue) ?? null;
  const type = sanitizeDocgenValue(prop.type) ?? { name: prop.type.name };

  return {
    defaultValue,
    ...(declarations ? { declarations } : {}),
    description: prop.description,
    name: prop.name,
    ...(parent ? { parent } : {}),
    required: prop.required,
    tags,
    [options.typePropName]: type,
  };
}

function serializeComponentDoc(
  componentDoc: ComponentDoc,
  options: GeneratorOptions,
): string {
  const props = Object.fromEntries(
    Object.entries(componentDoc.props).map(([propName, prop]) => [
      propName,
      createPropDefinition(prop, options),
    ]),
  );

  return JSON.stringify({
    description: componentDoc.description,
    displayName: componentDoc.displayName,
    filePath: componentDoc.filePath,
    methods: sanitizeDocgenValue(componentDoc.methods) ?? [],
    props,
    tags: sanitizeDocgenValue(componentDoc.tags) ?? {},
  });
}

function indentBlock(block: string): string {
  return block
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function createComponentCode(
  componentDoc: ComponentDocWithTarget,
  options: GeneratorOptions,
): string {
  const targetExpression = getTargetExpression(componentDoc.targetExpression);

  if (!targetExpression) {
    return "";
  }

  const statements: string[] = [];

  if (options.setDisplayName) {
    statements.push(
      `// @ts-ignore\n${targetExpression}.displayName = ${JSON.stringify(componentDoc.displayName)};`,
    );
  }

  statements.push(
    `// @ts-ignore\n${targetExpression}.__docgenInfo = ${serializeComponentDoc(componentDoc, options)};`,
  );

  return `try {\n${indentBlock(statements.join("\n"))}\n} catch (__react_docgen_typescript_loader_error) {}`;
}

export function generateDocgenCodeBlock(options: GeneratorOptions): {
  code: string;
  map: null;
} {
  const codeBlocks = options.componentDocs
    .map((componentDoc) => createComponentCode(componentDoc, options))
    .filter(Boolean)
    .join("\n");

  const code = codeBlocks
    ? `${options.source}${options.source.endsWith("\n") ? "" : "\n"}${codeBlocks}`
    : options.source;

  return {
    code,
    map: null,
  };
}
