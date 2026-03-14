import { Toolbar } from "@composites/index";
import { EmptyState, StatCard } from "@design/data/index";
import type {
  ActionDescriptor,
  FieldState,
  FilterOption,
  TestIdentifiable,
} from "@design/foundations/index";
import { PageHeader, Tabs } from "@design/navigation/index";
import { Inline, Stack } from "@primitives/index";

export interface ComponentGalleryProps extends TestIdentifiable {
  /** Search state used to filter the design-system catalog. */
  query: FieldState<string>;
  /** Filters representing component categories and maturity. */
  filters: readonly FilterOption[];
  /** Action rendered in the gallery header. */
  primaryAction: ActionDescriptor<string>;
}

/** Gallery page showing large published component catalogs. */
export const ComponentGallery = ({
  filters,
  primaryAction,
  query,
  testId,
}: ComponentGalleryProps) => {
  return (
    <Stack gap="md" testId={testId}>
      <PageHeader
        actions={[primaryAction]}
        eyebrow="Catalog"
        summary="Browse primitives, patterns, and composite recipes."
        title="Component gallery"
      />
      <Tabs
        activeItem="All components"
        items={["All components", "Stable", "Labs"]}
      />
      <Toolbar filters={filters} primaryAction={primaryAction} query={query} />
      <Inline gap="md">
        <StatCard delta="+18" title="Published components" value="64" />
        <StatCard
          delta="+7"
          title="Stable patterns"
          tone="success"
          value="21"
        />
      </Inline>
      <EmptyState
        action={primaryAction}
        message="Choose a component from the catalog to inspect props and tokens."
        title="Nothing selected"
      />
    </Stack>
  );
};
