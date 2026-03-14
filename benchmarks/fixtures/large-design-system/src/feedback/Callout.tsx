import type { StatusTone, TestIdentifiable } from "@design/foundations/index";
import { Inline, Text } from "@primitives/index";

export interface CalloutProps extends TestIdentifiable {
  /** Short, action-oriented message shown inline with related content. */
  message: string;
  /** Semantic tone used to categorize the callout. */
  tone: StatusTone;
}

/** Inline feedback message used in dense design-system checklists. */
export const Callout = ({ message, testId, tone }: CalloutProps) => {
  return (
    <Inline align="center" gap="xs" testId={testId}>
      <Text content={tone.toUpperCase()} role="caption" weight="strong" />
      <Text content={message} role="body" />
    </Inline>
  );
};
