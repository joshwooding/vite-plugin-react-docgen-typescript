import type {
  ActionDescriptor,
  DrawerSection,
  FieldState,
  FilterOption,
  TestIdentifiable,
  TokenReference,
} from "@design/foundations/index";
import { Surface } from "@primitives/index";
import { CommandPaletteDocs } from "./CommandPaletteDocs";
import { ComponentGallery } from "./ComponentGallery";
import { ReleaseChecklist } from "./ReleaseChecklist";
import { SettingsOverview } from "./SettingsOverview";
import { TokenAuditBoard } from "./TokenAuditBoard";

export interface ReferencePageProps extends TestIdentifiable {
  /** Shared search state reused by recipe examples. */
  query: FieldState<string>;
  /** Shared settings state for settings examples. */
  inputState: FieldState<string>;
  /** Filter options used across galleries and release checklists. */
  filters: readonly FilterOption[];
  /** Action shown in toolbar-driven examples. */
  primaryAction: ActionDescriptor<string>;
  /** Sections shown in drawers and filter panels. */
  sections: readonly DrawerSection[];
  /** Tokens shown in audit-focused examples. */
  tokens: readonly TokenReference[];
}

/** Design-system reference page composed from multiple documentation recipes. */
export const ReferencePage = ({
  filters,
  inputState,
  primaryAction,
  query,
  sections,
  testId,
  tokens,
}: ReferencePageProps) => {
  return (
    <main data-testid={testId}>
      <Surface
        content="Synthetic design-system docs surface used to benchmark component-package scale."
        subtitle="Exercises primitives, composed controls, and recipe-style consumers."
        title="Large design-system reference page"
      />
      <ComponentGallery
        filters={filters}
        primaryAction={primaryAction}
        query={query}
      />
      <SettingsOverview inputState={inputState} />
      <ReleaseChecklist filters={filters} sections={sections} />
      <CommandPaletteDocs
        filters={filters}
        primaryAction={primaryAction}
        query={query}
      />
      <TokenAuditBoard sections={sections} tokens={tokens} />
    </main>
  );
};
