export type Density = "compact" | "regular" | "spacious";
export type Emphasis = "subtle" | "default" | "strong";
export type TextRole = "body" | "label" | "title" | "caption" | "eyebrow";
export type StatusTone = "info" | "success" | "warning" | "critical";

export interface TestIdentifiable {
  testId?: string;
}

export interface ActionDescriptor<TPayload> {
  label: string;
  payload: TPayload;
  analyticsKey: string;
}

export interface FieldState<TValue> {
  value: TValue;
  dirty: boolean;
  validationMessage?: string;
}

export interface FilterOption {
  id: string;
  label: string;
  count?: number;
}

export interface DrawerSection {
  id: string;
  title: string;
  description: string;
}

export interface TokenReference {
  name: string;
  category: "color" | "layout" | "typography";
  usage: string;
}
