import type { TestIdentifiable, TrendMetric } from "@shared/index";

export interface MetricTableProps extends TestIdentifiable {
  /** Text announced by dense summary tables. */
  caption: string;
  /** Ordered metrics used for executive and operational summaries. */
  metrics: readonly TrendMetric[];
}

/** Dense metrics table used by feature summary cards. */
export const MetricTable = ({ caption, metrics, testId }: MetricTableProps) => {
  return (
    <table data-testid={testId}>
      <caption>{caption}</caption>
      <tbody>
        {metrics.map((metric) => (
          <tr key={metric.label}>
            <th>{metric.label}</th>
            <td>{metric.value}</td>
            <td data-direction={metric.direction}>{metric.delta}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};
