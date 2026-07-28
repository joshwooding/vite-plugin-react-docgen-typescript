export type DocgenJsonPrimitive = boolean | null | number | string;
export type DocgenJsonValue =
  | DocgenJsonPrimitive
  | readonly DocgenJsonValue[]
  | { readonly [key: string]: DocgenJsonValue };

export interface DocgenParent {
  readonly fileName: string;
  readonly name: string;
}

export interface DocgenPropType {
  readonly name: string;
  readonly raw?: string;
  readonly value?: DocgenJsonValue;
}

export interface DocgenProp {
  readonly declarations?: readonly DocgenParent[];
  readonly defaultValue: DocgenJsonValue | null;
  readonly description: string;
  readonly name: string;
  readonly parent?: DocgenParent;
  readonly required: boolean;
  readonly tags?: Readonly<Record<string, DocgenJsonValue>>;
  readonly type: DocgenPropType;
}

export interface DocgenMethodParameter {
  readonly description?: string | null;
  readonly name: string;
  readonly type: { readonly name: string };
}

export interface DocgenMethod {
  readonly description: string;
  readonly docblock: string;
  readonly modifiers: readonly string[];
  readonly name: string;
  readonly params: readonly DocgenMethodParameter[];
  readonly returns?: {
    readonly description?: string | null;
    readonly type?: string;
  } | null;
}

export interface DocgenComponent {
  readonly description: string;
  readonly displayName: string;
  readonly filePath: string;
  readonly methods: readonly DocgenMethod[];
  readonly props: Readonly<Record<string, DocgenProp>>;
  readonly tags?: Readonly<Record<string, DocgenJsonValue>>;
  readonly targetExpression: string | null;
}
