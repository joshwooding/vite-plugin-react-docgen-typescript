import type { FieldState } from "@shared/index";
import { FieldShell } from "./FieldShell";
import type { FieldShellProps } from "./FieldShell";

export interface TextInputProps
  extends Omit<FieldShellProps, "controlValue" | "validationMessage"> {
  /** Captured state passed through feature-specific form stores. */
  state: FieldState<string>;
  /** Placeholder copy used before a value is entered. */
  placeholder?: string;
}

/** Text entry control wrapped in the shared field shell. */
export const TextInput = ({
  placeholder = "Search accounts",
  state,
  ...fieldShellProps
}: TextInputProps) => {
  return (
    <FieldShell
      {...fieldShellProps}
      controlValue={state.value || placeholder}
      validationMessage={state.validationMessage}
    />
  );
};
