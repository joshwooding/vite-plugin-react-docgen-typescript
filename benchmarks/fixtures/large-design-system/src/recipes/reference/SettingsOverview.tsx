import { SettingsSection } from "@composites/index";
import type { FieldState, TestIdentifiable } from "@design/foundations/index";
import { PageHeader } from "@design/navigation/index";
import { Banner } from "@feedback/index";
import { Stack } from "@primitives/index";

export interface SettingsOverviewProps extends TestIdentifiable {
  /** Shared state used by settings-field examples. */
  inputState: FieldState<string>;
}

/** Settings documentation recipe composed from field and feedback primitives. */
export const SettingsOverview = ({
  inputState,
  testId,
}: SettingsOverviewProps) => {
  return (
    <Stack gap="md" testId={testId}>
      <PageHeader
        eyebrow="Patterns"
        summary="Recommended layout for grouped settings controls."
        title="Settings overview"
      />
      <Banner
        message="Use compact density when a section holds more than four controls."
        title="Guidance"
        tone="info"
      />
      <SettingsSection
        content="Controls how design-system previews and examples are rendered."
        enabled={true}
        inputState={inputState}
        title="Preview preferences"
      />
    </Stack>
  );
};
