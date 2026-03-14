import { AccountOverview, NotificationPreferences } from "@components/index";
import type {
  AccountRecord,
  ActionDefinition,
  NotificationPreference,
  TestIdentifiable,
  TrendMetric,
} from "@shared/index";

export interface ExecutiveSummaryProps extends TestIdentifiable {
  /** Account featured at the top of the summary. */
  account: AccountRecord;
  /** Rollup metrics used by leadership views. */
  metrics: readonly TrendMetric[];
  /** Current notification routing for the highlighted account. */
  preferences: readonly NotificationPreference[];
  /** Save action delegated to the preferences card. */
  saveAction: ActionDefinition<{ changedCount: number }>;
}

/** Executive view combining account health and preference state. */
export const ExecutiveSummary = ({
  account,
  metrics,
  preferences,
  saveAction,
  testId,
}: ExecutiveSummaryProps) => {
  return (
    <div data-testid={testId}>
      <AccountOverview account={account} metrics={metrics} />
      <NotificationPreferences
        preferences={preferences}
        saveAction={saveAction}
      />
    </div>
  );
};
