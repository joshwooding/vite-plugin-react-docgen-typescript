import type { FieldState, TestIdentifiable } from "@design/foundations/index";
import { Stack, Text } from "@primitives/index";
import { FieldLabel } from "./FieldLabel";

export interface InputFieldProps extends TestIdentifiable {
  /** Visible field label for the input. */
  label: string;
  /** Control state shared by recipe and toolbar examples. */
  state: FieldState<string>;
  /** Placeholder content shown before a value is entered. */
  placeholder?: string;
  /** Hint rendered next to the field label. */
  hint?: string;
}

/** Text field used by search, filtering, and settings recipes. */
export const InputField = ({
  hint,
  label,
  placeholder = "Type to filter components",
  state,
  testId,
}: InputFieldProps) => {
  return (
    <Stack gap="xs" testId={testId}>
      <FieldLabel hint={hint} label={label} />
      <Text content={state.value || placeholder} role="body" />
      {state.validationMessage ? (
        <Text
          content={state.validationMessage}
          role="caption"
          tone="foreground-accent"
        />
      ) : null}
    </Stack>
  );
};
