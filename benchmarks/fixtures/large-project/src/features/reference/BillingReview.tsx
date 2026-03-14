import { AccountOverview, FilterToolbar, MetricTable } from "@components/index";
import type {
  AccountRecord,
  ActionDefinition,
  FieldState,
  FilterDefinition,
  TestIdentifiable,
  TrendMetric,
} from "@shared/index";

export interface BillingReviewProps extends TestIdentifiable {
  /** Account under review for the current billing cycle. */
  account: AccountRecord;
  /** Query state used to filter cost dimensions. */
  query: FieldState<string>;
  /** Available billing and contract filters. */
  filters: readonly FilterDefinition[];
  /** Metrics used by finance and account teams. */
  metrics: readonly TrendMetric[];
  /** Action used to export the review package. */
  exportAction: ActionDefinition<{ scope: string }>;
}

/** Billing review screen combining search, context, and metrics. */
export const BillingReview = ({
  account,
  exportAction,
  filters,
  metrics,
  query,
  testId,
}: BillingReviewProps) => {
  return (
    <div data-testid={testId}>
      <FilterToolbar
        filters={filters}
        primaryAction={exportAction}
        query={query}
        scopeLabel="Billing"
      />
      <AccountOverview account={account} metrics={metrics} />
      <MetricTable caption="Billing metrics" metrics={metrics} />
    </div>
  );
};
