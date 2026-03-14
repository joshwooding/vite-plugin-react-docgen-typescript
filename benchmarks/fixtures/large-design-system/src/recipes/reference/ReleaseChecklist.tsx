import { FilterPanel } from "@composites/index";
import type {
  DrawerSection,
  FilterOption,
  TestIdentifiable,
} from "@design/foundations/index";
import { PageHeader } from "@design/navigation/index";
import { Callout } from "@feedback/index";
import { Stack } from "@primitives/index";

export interface ReleaseChecklistProps extends TestIdentifiable {
  /** Checklist filters surfaced in the release drawer. */
  filters: readonly FilterOption[];
  /** Release sections shown inside the drawer body. */
  sections: readonly DrawerSection[];
}

/** Release checklist recipe for design-system publishing workflows. */
export const ReleaseChecklist = ({
  filters,
  sections,
  testId,
}: ReleaseChecklistProps) => {
  return (
    <Stack gap="md" testId={testId}>
      <PageHeader
        eyebrow="Publishing"
        summary="Review change scope and packaging tasks before release."
        title="Release checklist"
      />
      <Callout
        message="Token, docs, and migration notes should ship in the same release group."
        tone="warning"
      />
      <FilterPanel filters={filters} sections={sections} />
    </Stack>
  );
};
