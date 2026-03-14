import type { FieldState, TestIdentifiable } from "@design/foundations/index";
import { InputField, ToggleField } from "@forms/index";
import { Stack, Surface } from "@primitives/index";

export interface SettingsSectionProps extends TestIdentifiable {
  /** Section title shown above the grouped controls. */
  title: string;
  /** Short description of the settings group. */
  content: string;
  /** Search-like field used by dense settings forms. */
  inputState: FieldState<string>;
  /** Current enabled state for the section toggle. */
  enabled: boolean;
}

/** Settings composition built from published field primitives. */
export const SettingsSection = ({
  content,
  enabled,
  inputState,
  testId,
  title,
}: SettingsSectionProps) => {
  return (
    <Surface content={content} testId={testId} title={title}>
      <Stack gap="sm">
        <InputField label="Display name" state={inputState} />
        <ToggleField checked={enabled} label="Enable previews" />
      </Stack>
    </Surface>
  );
};
