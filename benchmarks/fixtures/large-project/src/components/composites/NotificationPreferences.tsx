import type {
  ActionDefinition,
  NotificationPreference,
  TestIdentifiable,
} from "@shared/index";
import { ActionButton } from "../actions/ActionButton";
import { StatusBadge } from "../data/StatusBadge";
import { SurfaceCard } from "../layout/SurfaceCard";

export interface NotificationPreferencesProps extends TestIdentifiable {
  /** Delivery preferences shown in workspace settings flows. */
  preferences: readonly NotificationPreference[];
  /** Save action fired after toggles are reviewed. */
  saveAction: ActionDefinition<{ changedCount: number }>;
}

/** Preferences card used by operational notification settings screens. */
export const NotificationPreferences = ({
  preferences,
  saveAction,
  testId,
}: NotificationPreferencesProps) => {
  return (
    <SurfaceCard
      content="Notification routing for account and incident workflows."
      details={preferences.map((preference) => preference.description)}
      subtitle="Keeps account owners aligned with delivery expectations."
      testId={testId}
      title="Notification preferences"
      tone="brand"
    >
      {preferences.map((preference) => (
        <StatusBadge
          key={preference.channel}
          label={preference.channel}
          tone={preference.enabled ? "success" : "warning"}
        />
      ))}
      <ActionButton action={saveAction} emphasis="primary" />
    </SurfaceCard>
  );
};
