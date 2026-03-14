import type { FieldSize, TestIdentifiable } from "@shared/index";

export interface FieldShellProps extends TestIdentifiable {
  /** Visible field label for search and settings forms. */
  label: string;
  /** Supporting copy used for dense enterprise forms. */
  description?: string;
  /** Density token shared across filter and settings controls. */
  size?: FieldSize;
  /** Validation message displayed below the control when needed. */
  validationMessage?: string;
  /** Indicates whether the form field is mandatory. */
  required?: boolean;
  /** Simplified control preview rendered by benchmark fixtures. */
  controlValue: string;
}

/** Shared field chrome used by input-heavy workflow screens. */
export const FieldShell = ({
  controlValue,
  description,
  label,
  required = false,
  size = "md",
  testId,
  validationMessage,
}: FieldShellProps) => {
  return (
    <label data-size={size} data-testid={testId}>
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {description ? <small>{description}</small> : null}
      <span>{controlValue}</span>
      {validationMessage ? <em>{validationMessage}</em> : null}
    </label>
  );
};
