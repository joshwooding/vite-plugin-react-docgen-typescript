import type {
  ActionDefinition,
  FieldState,
  FilterDefinition,
  TestIdentifiable,
} from "@shared/index";
import { ActionButton } from "../actions/ActionButton";
import { StatusBadge } from "../data/StatusBadge";
import { TextInput } from "../forms/TextInput";

export interface FilterToolbarProps extends TestIdentifiable {
  /** Search field state shared by filtering and quick-jump flows. */
  query: FieldState<string>;
  /** Available filter chips shown alongside the main search field. */
  filters: readonly FilterDefinition[];
  /** Summary label describing the current result scope. */
  scopeLabel: string;
  /** Primary action rendered at the end of the toolbar. */
  primaryAction: ActionDefinition<{ scope: string }>;
}

/** Search and filter toolbar used across analytical feature pages. */
export const FilterToolbar = ({
  filters,
  primaryAction,
  query,
  scopeLabel,
  testId,
}: FilterToolbarProps) => {
  return (
    <div data-testid={testId}>
      <TextInput
        description="Searches the indexed account and event sets."
        label="Query"
        state={query}
      />
      <div>
        {filters.map((filter) => (
          <StatusBadge
            key={filter.id}
            label={filter.label}
            subtle={true}
            tone="info"
          />
        ))}
      </div>
      <StatusBadge label={scopeLabel} tone="neutral" />
      <ActionButton action={primaryAction} emphasis="primary" />
    </div>
  );
};
