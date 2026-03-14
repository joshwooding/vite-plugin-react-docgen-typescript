import {
  ActionButton,
  SectionHeading,
  StatusBadge,
  SurfaceCard,
} from "@components/index";
import type {
  ActionDefinition,
  AlertItem,
  TestIdentifiable,
} from "@shared/index";

export interface AlertCenterProps extends TestIdentifiable {
  /** Active alerts currently visible in the center. */
  alerts: readonly AlertItem[];
  /** Action used to acknowledge or triage the current set. */
  acknowledgeAction: ActionDefinition<{ alertCount: number }>;
}

/** Alert queue summary used by operations and incident teams. */
export const AlertCenter = ({
  acknowledgeAction,
  alerts,
  testId,
}: AlertCenterProps) => {
  return (
    <div data-testid={testId}>
      <SectionHeading eyebrow="Monitoring" title="Alert center" />
      <SurfaceCard
        content="Prioritized alert summaries for the current operational window."
        details={alerts.map((alert) => alert.summary)}
        title="Active alerts"
        tone="critical"
      />
      <div>
        {alerts.map((alert) => (
          <StatusBadge
            key={alert.id}
            label={alert.title}
            tone={alert.severity === "high" ? "critical" : "warning"}
          />
        ))}
      </div>
      <ActionButton action={acknowledgeAction} emphasis="primary" />
    </div>
  );
};
