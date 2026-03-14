import type { StatusTone, TestIdentifiable } from "@design/foundations/index";
import { Inline, Surface, Text } from "@primitives/index";

export interface StatCardProps extends TestIdentifiable {
  /** Summary metric title. */
  title: string;
  /** Current value rendered with title emphasis. */
  value: string;
  /** Delta shown next to the primary value. */
  delta?: string;
  /** Tone used to communicate positive or negative change. */
  tone?: StatusTone;
}

/** Summary metric card used by gallery and audit recipes. */
export const StatCard = ({
  delta,
  testId,
  title,
  tone = "info",
  value,
}: StatCardProps) => {
  return (
    <Surface content={value} density="compact" testId={testId} title={title}>
      <Inline gap="xs">
        <Text content={tone} role="caption" tone="foreground-muted" />
        {delta ? <Text content={delta} role="label" weight="strong" /> : null}
      </Inline>
    </Surface>
  );
};
