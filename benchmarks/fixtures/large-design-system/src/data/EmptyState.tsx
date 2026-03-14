import type {
  ActionDescriptor,
  TestIdentifiable,
} from "@design/foundations/index";
import { Stack, Surface, Text } from "@primitives/index";

export interface EmptyStateProps extends TestIdentifiable {
  /** Empty-state title shown when no content is available. */
  title: string;
  /** Supporting message that explains the empty condition. */
  message: string;
  /** Optional action shown below the empty-state body. */
  action?: ActionDescriptor<string>;
}

/** Empty-state surface used by recipe pages and audits. */
export const EmptyState = ({
  action,
  message,
  testId,
  title,
}: EmptyStateProps) => {
  return (
    <Surface content={message} testId={testId} title={title}>
      <Stack gap="xs">
        {action ? (
          <Text content={action.label} role="label" weight="strong" />
        ) : null}
      </Stack>
    </Surface>
  );
};
