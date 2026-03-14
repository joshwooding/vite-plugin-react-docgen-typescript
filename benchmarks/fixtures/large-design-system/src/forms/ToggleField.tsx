import type { TestIdentifiable } from "@design/foundations/index";
import { Inline, Text } from "@primitives/index";
import { FieldLabel } from "./FieldLabel";

export interface ToggleFieldProps extends TestIdentifiable {
  /** Visible label for the toggle control. */
  label: string;
  /** Indicates whether the toggle is switched on. */
  checked: boolean;
  /** Supporting hint rendered next to the label. */
  hint?: string;
}

/** Toggle control used by filter panels and settings forms. */
export const ToggleField = ({
  checked,
  hint,
  label,
  testId,
}: ToggleFieldProps) => {
  return (
    <Inline align="center" gap="sm" testId={testId}>
      <FieldLabel hint={hint} label={label} />
      <Text
        content={checked ? "On" : "Off"}
        role="caption"
        tone="foreground-muted"
      />
    </Inline>
  );
};
