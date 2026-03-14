import type { StatusTone, TestIdentifiable } from "@shared/index";

export interface StatusBadgeProps extends TestIdentifiable {
  /** Concise status label shown in cards and tables. */
  label: string;
  /** Semantic tone mapped to the surrounding workflow state. */
  tone: StatusTone;
  /** Uses a lower-emphasis presentation inside dense surfaces. */
  subtle?: boolean;
}

/** Compact status label for health and workflow state. */
export const StatusBadge = ({
  label,
  tone,
  subtle = false,
  testId,
}: StatusBadgeProps) => {
  return (
    <span data-subtle={subtle} data-testid={testId} data-tone={tone}>
      {label}
    </span>
  );
};
