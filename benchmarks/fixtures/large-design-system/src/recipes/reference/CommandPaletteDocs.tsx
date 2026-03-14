import { Toolbar } from "@composites/index";
import { EmptyState } from "@design/data/index";
import type {
  ActionDescriptor,
  FieldState,
  FilterOption,
  TestIdentifiable,
} from "@design/foundations/index";
import { PageHeader } from "@design/navigation/index";
import { Stack } from "@primitives/index";

export interface CommandPaletteDocsProps extends TestIdentifiable {
  /** Search state for command filtering examples. */
  query: FieldState<string>;
  /** Filter options representing command groups. */
  filters: readonly FilterOption[];
  /** Action used to open command registration guidance. */
  primaryAction: ActionDescriptor<string>;
}

/** Documentation recipe describing command-palette composition patterns. */
export const CommandPaletteDocs = ({
  filters,
  primaryAction,
  query,
  testId,
}: CommandPaletteDocsProps) => {
  return (
    <Stack gap="md" testId={testId}>
      <PageHeader
        actions={[primaryAction]}
        eyebrow="Recipes"
        summary="Compose search, filtering, and result states for command menus."
        title="Command palette docs"
      />
      <Toolbar filters={filters} primaryAction={primaryAction} query={query} />
      <EmptyState
        message="Search commands, intents, and keyboard shortcuts."
        title="Command examples"
      />
    </Stack>
  );
};
