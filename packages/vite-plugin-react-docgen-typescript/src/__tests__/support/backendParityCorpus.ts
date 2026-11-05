export interface BackendParityFixture {
  expectedComponents: readonly unknown[];
  expectedDependencies: readonly string[];
  expectedProjectFiles: readonly string[];
  files: Readonly<Record<string, string>>;
  name: string;
  options?: Readonly<Record<string, boolean | string | readonly string[]>>;
  transformFile: string;
}

export const backendParityCorpus: readonly BackendParityFixture[] = [
  {
    name: "rich metadata and enum values",
    transformFile: "RichMetadata.tsx",
    files: {
      "RichMetadata.tsx": `interface RichMetadataProps {
  /**
   * Visual variant.
   *
   * @default pill
   * @remarks Used by the design system controls.
   */
  variant?: "pill" | "modern";
}

/**
 * Component with richer docgen metadata.
 *
 * @status beta
 * @see https://example.com/rich-metadata
 */
export const RichMetadataComponent = ({
  variant = "pill",
}: RichMetadataProps) => <button data-variant={variant}>{variant}</button>;
`,
    },
    options: { shouldExtractValuesFromUnion: true },
    expectedComponents: [
      {
        description: "Component with richer docgen metadata.",
        displayName: "RichMetadataComponent",
        filePath: "<fixture>/RichMetadata.tsx",
        methods: [],
        props: {
          variant: {
            defaultValue: { value: "pill" },
            declarations: [
              {
                fileName: "<fixture>/RichMetadata.tsx",
                name: "RichMetadataProps",
              },
            ],
            description: "Visual variant.",
            name: "variant",
            parent: {
              fileName: "<fixture>/RichMetadata.tsx",
              name: "RichMetadataProps",
            },
            required: false,
            tags: {
              default: "pill",
              remarks: "Used by the design system controls.",
            },
            type: {
              name: "enum",
              raw: '"pill" | "modern" | undefined',
              value: [
                { value: "undefined" },
                { value: '"pill"' },
                { value: '"modern"' },
              ],
            },
          },
        },
        tags: {
          see: "https://example.com/rich-metadata",
          status: "beta",
        },
        targetExpression: "RichMetadataComponent",
      },
    ],
    expectedDependencies: ["<fixture>/RichMetadata.tsx"],
    expectedProjectFiles: ["<fixture>/RichMetadata.tsx"],
  },
  {
    name: "imported props and multiple components",
    transformFile: "Components.tsx",
    files: {
      "Components.tsx": `declare namespace JSX {
  interface Element {}
}

import type { ImportedProps } from "./props";

/** Primary component. */
export const Primary = ({ tone }: ImportedProps): JSX.Element =>
  null as unknown as JSX.Element;

/** Secondary component. */
export function Secondary({ tone }: ImportedProps): JSX.Element {
  return null as unknown as JSX.Element;
}
`,
      "props.ts": `export interface ImportedProps {
  /** Imported tone. */
  tone: "calm" | "strong";
}
`,
    },
    options: { shouldExtractValuesFromUnion: true },
    expectedComponents: [
      {
        description: "Secondary component.",
        displayName: "Secondary",
        filePath: "<fixture>/Components.tsx",
        methods: [],
        props: {
          tone: {
            defaultValue: null,
            declarations: [
              { fileName: "<fixture>/props.ts", name: "ImportedProps" },
            ],
            description: "Imported tone.",
            name: "tone",
            parent: {
              fileName: "<fixture>/props.ts",
              name: "ImportedProps",
            },
            required: true,
            tags: {},
            type: {
              name: "enum",
              raw: '"calm" | "strong"',
              value: [{ value: '"calm"' }, { value: '"strong"' }],
            },
          },
        },
        tags: {},
        targetExpression: "Secondary",
      },
      {
        description: "Primary component.",
        displayName: "Primary",
        filePath: "<fixture>/Components.tsx",
        methods: [],
        props: {
          tone: {
            defaultValue: null,
            declarations: [
              { fileName: "<fixture>/props.ts", name: "ImportedProps" },
            ],
            description: "Imported tone.",
            name: "tone",
            parent: {
              fileName: "<fixture>/props.ts",
              name: "ImportedProps",
            },
            required: true,
            tags: {},
            type: {
              name: "enum",
              raw: '"calm" | "strong"',
              value: [{ value: '"calm"' }, { value: '"strong"' }],
            },
          },
        },
        tags: {},
        targetExpression: "Primary",
      },
    ],
    expectedDependencies: ["<fixture>/Components.tsx", "<fixture>/props.ts"],
    expectedProjectFiles: ["<fixture>/Components.tsx", "<fixture>/props.ts"],
  },
] as const;

export const emptyExtractionFixture = {
  fileName: "NoComponent.tsx",
  source: "export const answer = 42;\n",
} as const;

export const recoverableErrorFixture = {
  expectedDependencies: ["<fixture>/Recoverable.tsx", "<fixture>/props.ts"],
  files: {
    "Recoverable.tsx": `import type { RecoverableProps } from "./props";

export const Recoverable = (_props: RecoverableProps) => null;
`,
    "props.ts": `export interface RecoverableProps {
  /** Value retained for dependency discovery. */
  value: string;
}
`,
  },
  transformFile: "Recoverable.tsx",
} as const;
