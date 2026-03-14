export type FieldSize = "sm" | "md" | "lg";

export interface FieldState<TValue> {
  value: TValue;
  touched: boolean;
  validationMessage?: string;
}

export interface FilterDefinition {
  id: string;
  label: string;
  placeholder?: string;
}
