import type { TestIdentifiable } from "@design/foundations/index";
import { Inline, Text } from "@primitives/index";

export interface FieldLabelProps extends TestIdentifiable {
  /** Visible field label used by form controls and filters. */
  label: string;
  /** Optional hint shown next to the label in compact forms. */
  hint?: string;
  /** Indicates whether the control is required. */
  required?: boolean;
}

/** Shared form label used by design-system field controls. */
export const FieldLabel = ({
  hint,
  label,
  required = false,
  testId,
}: FieldLabelProps) => {
  return (
    <Inline align="center" gap="xs" testId={testId}>
      <Text
        content={`${label}${required ? " *" : ""}`}
        role="label"
        weight="strong"
      />
      {hint ? (
        <Text content={hint} role="caption" tone="foreground-muted" />
      ) : null}
    </Inline>
  );
};
