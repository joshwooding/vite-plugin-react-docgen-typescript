import type {
  ActionDescriptor,
  FieldState,
  FilterOption,
  TestIdentifiable,
} from "@design/foundations/index";
import { InputField } from "@forms/index";
import { Inline, Text } from "@primitives/index";

export interface ToolbarProps extends TestIdentifiable {
  /** Search state used to filter the current recipe or gallery. */
  query: FieldState<string>;
  /** Filter options shown next to the query control. */
  filters: readonly FilterOption[];
  /** Primary action rendered at the end of the toolbar. */
  primaryAction: ActionDescriptor<string>;
}

/** Toolbar composition used by galleries, docs pages, and audit boards. */
export const Toolbar = ({
  filters,
  primaryAction,
  query,
  testId,
}: ToolbarProps) => {
  return (
    <Inline align="center" gap="md" testId={testId}>
      <InputField label="Search" state={query} />
      {filters.map((filter) => (
        <Text
          key={filter.id}
          content={filter.label}
          role="caption"
          tone="foreground-muted"
        />
      ))}
      <Text content={primaryAction.label} role="label" weight="strong" />
    </Inline>
  );
};
