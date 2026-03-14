import type {
  DrawerSection,
  FilterOption,
  TestIdentifiable,
} from "@design/foundations/index";
import { Drawer } from "@design/overlays/index";
import { ToggleField } from "@forms/index";
import { Stack, Text } from "@primitives/index";

export interface FilterPanelProps extends TestIdentifiable {
  /** Available filter options shown in the side panel. */
  filters: readonly FilterOption[];
  /** Drawer sections describing the current filter groups. */
  sections: readonly DrawerSection[];
}

/** Side-panel recipe built from overlay and field primitives. */
export const FilterPanel = ({
  filters,
  sections,
  testId,
}: FilterPanelProps) => {
  return (
    <Drawer sections={sections} testId={testId} title="Filter panel">
      <Stack gap="sm">
        {filters.map((filter) => (
          <ToggleField
            key={filter.id}
            checked={Boolean(filter.count)}
            hint={filter.count ? `${filter.count} items` : undefined}
            label={filter.label}
          />
        ))}
        <Text
          content="Preview state only"
          role="caption"
          tone="foreground-muted"
        />
      </Stack>
    </Drawer>
  );
};
