import typescript from "typescript";
import { describe, expect, it } from "vitest";
import { generateDocgenCodeBlock } from "../utils/generate";
import type { ComponentDocWithTarget } from "../utils/runtimeTarget";

const RESERVED_ROOTS = [
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield",
] as const;

const createComponentDoc = (
  targetExpression: string,
): ComponentDocWithTarget => ({
  description: "",
  displayName: "ExampleComponent",
  filePath: "/ExampleComponent.tsx",
  methods: [],
  props: {},
  targetExpression,
});

const generate = (targetExpression: string) =>
  generateDocgenCodeBlock({
    componentDocs: [createComponentDoc(targetExpression)],
    filename: "/ExampleComponent.tsx",
    setDisplayName: true,
    source: "const original = true;",
    typePropName: "type",
  });

describe("generateDocgenCodeBlock target validation", () => {
  it.each(RESERVED_ROOTS)("rejects the reserved root %s", (root) => {
    for (const targetExpression of [root, `${root}.Component`]) {
      expect(generate(targetExpression)).toEqual({
        code: "const original = true;",
        map: null,
      });
    }
  });

  it.each([
    "1Component",
    "Component-name",
    "Component()",
    'Component["child"]',
    ".Component",
    "Component..child",
  ])("rejects the malformed target %s", (targetExpression) => {
    expect(generate(targetExpression)).toEqual({
      code: "const original = true;",
      map: null,
    });
  });

  it.each([
    "Component",
    "$Component",
    "async",
    "type",
    "Components.Button",
    "Components.default",
  ])("generates syntax-valid code for %s", (targetExpression) => {
    const result = generate(targetExpression);

    expect(result.code).not.toBe("const original = true;");
    expect(result.code).toContain(`${targetExpression}.__docgenInfo`);

    const { diagnostics = [] } = typescript.transpileModule(
      `${result.code}\nexport {};`,
      {
        compilerOptions: {
          module: typescript.ModuleKind.ESNext,
          target: typescript.ScriptTarget.ESNext,
        },
        fileName: "generated.ts",
        reportDiagnostics: true,
      },
    );

    expect(
      diagnostics.map((diagnostic) =>
        typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
    ).toEqual([]);
  });
});
