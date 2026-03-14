import type {
  AccountRecord,
  TestIdentifiable,
  TrendMetric,
} from "@shared/index";
import { MetricTable } from "../data/MetricTable";
import { StatusBadge } from "../data/StatusBadge";
import { SurfaceCard } from "../layout/SurfaceCard";

export interface AccountOverviewProps extends TestIdentifiable {
  /** Current account record rendered in the overview panel. */
  account: AccountRecord;
  /** Key metrics summarising account health and spend. */
  metrics: readonly TrendMetric[];
}

/** Account summary card with metrics and health state. */
export const AccountOverview = ({
  account,
  metrics,
  testId,
}: AccountOverviewProps) => {
  return (
    <SurfaceCard
      content={`${account.owner.displayName} owns ${account.name} in ${account.region}.`}
      details={[
        `Monthly spend: ${account.monthlySpend}`,
        `Team: ${account.owner.team}`,
      ]}
      subtitle="Cross-functional summary for account reviews."
      testId={testId}
      title={account.name}
      tone={account.health === "risk" ? "critical" : "brand"}
    >
      <StatusBadge
        label={account.health}
        tone={account.health === "risk" ? "critical" : "success"}
      />
      <MetricTable caption={`${account.name} metrics`} metrics={metrics} />
    </SurfaceCard>
  );
};
