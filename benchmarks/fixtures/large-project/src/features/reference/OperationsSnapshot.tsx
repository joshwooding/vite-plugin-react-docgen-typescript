import { FilterToolbar, MetricTable, SurfaceCard } from "@components/index";
import type {
  ActionDefinition,
  FieldState,
  FilterDefinition,
  TestIdentifiable,
  TrendMetric,
} from "@shared/index";

export interface OperationsSnapshotProps extends TestIdentifiable {
  /** Toolbar query state for operational searches. */
  query: FieldState<string>;
  /** Filters that scope the operational dataset. */
  filters: readonly FilterDefinition[];
  /** Snapshot metrics rendered below the toolbar. */
  metrics: readonly TrendMetric[];
  /** Action used to export the currently filtered view. */
  exportAction: ActionDefinition<{ scope: string }>;
}

/** Operational overview stitched together from dense shared primitives. */
export const OperationsSnapshot = ({
  exportAction,
  filters,
  metrics,
  query,
  testId,
}: OperationsSnapshotProps) => {
  return (
    <div data-testid={testId}>
      <FilterToolbar
        filters={filters}
        primaryAction={exportAction}
        query={query}
        scopeLabel="Operations"
      />
      <SurfaceCard
        content="Daily rollup for queue health, staffing, and escalations."
        details={["Escalations refreshed every 15 minutes."]}
        title="Operations snapshot"
      />
      <MetricTable caption="Operations metrics" metrics={metrics} />
    </div>
  );
};
