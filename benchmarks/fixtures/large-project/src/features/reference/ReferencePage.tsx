import { SurfaceCard } from "@components/index";
import type {
  AccountOwner,
  AccountRecord,
  ActionDefinition,
  AlertItem,
  FieldState,
  FilterDefinition,
  NotificationPreference,
  TestIdentifiable,
  TrendMetric,
} from "@shared/index";
import { AlertCenter } from "./AlertCenter";
import { BillingReview } from "./BillingReview";
import { ExecutiveSummary } from "./ExecutiveSummary";
import { OperationsSnapshot } from "./OperationsSnapshot";
import { WorkspaceRoster } from "./WorkspaceRoster";

export interface ReferencePageProps extends TestIdentifiable {
  /** Shared account model passed into the composed reference page. */
  account: AccountRecord;
  /** Metrics reused across the reference feature pack. */
  metrics: readonly TrendMetric[];
  /** Search state propagated into analytical views. */
  query: FieldState<string>;
  /** Shared filter definitions used by multiple toolbars. */
  filters: readonly FilterDefinition[];
  /** Notification settings for the highlighted account. */
  preferences: readonly NotificationPreference[];
  /** Workspace owners displayed in the staffing view. */
  owners: readonly AccountOwner[];
  /** Alerts currently displayed by the alert center. */
  alerts: readonly AlertItem[];
  /** Save action for preference updates. */
  saveAction: ActionDefinition<{ changedCount: number }>;
  /** Export action used by analytical views. */
  exportAction: ActionDefinition<{ scope: string }>;
  /** Acknowledge action used by alert operations. */
  acknowledgeAction: ActionDefinition<{ alertCount: number }>;
}

/** Reference page that composes multiple high-traffic enterprise views. */
export const ReferencePage = ({
  account,
  acknowledgeAction,
  alerts,
  exportAction,
  filters,
  metrics,
  owners,
  preferences,
  query,
  saveAction,
  testId,
}: ReferencePageProps) => {
  return (
    <main data-testid={testId}>
      <SurfaceCard
        content="Synthetic enterprise page used to benchmark larger type graphs."
        details={["Path aliases", "Barrel exports", "Composite components"]}
        title="Large-project reference page"
        tone="brand"
      />
      <ExecutiveSummary
        account={account}
        metrics={metrics}
        preferences={preferences}
        saveAction={saveAction}
      />
      <OperationsSnapshot
        exportAction={exportAction}
        filters={filters}
        metrics={metrics}
        query={query}
      />
      <WorkspaceRoster owners={owners} staffingStatus="Balanced" />
      <AlertCenter acknowledgeAction={acknowledgeAction} alerts={alerts} />
      <BillingReview
        account={account}
        exportAction={exportAction}
        filters={filters}
        metrics={metrics}
        query={query}
      />
    </main>
  );
};
