export type Density = "compact" | "regular" | "comfortable";
export type SurfaceTone = "neutral" | "brand" | "positive" | "critical";
export type StatusTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "critical";

export interface AnalyticsMeta {
  area: string;
  eventName: string;
  tags?: readonly string[];
}

export interface ActionDefinition<TPayload> {
  label: string;
  payload: TPayload;
  analytics: AnalyticsMeta;
}

export interface BaseSurfaceProps {
  title: string;
  subtitle?: string;
  density?: Density;
  tone?: SurfaceTone;
}

export interface TestIdentifiable {
  testId?: string;
}

export interface TrendMetric {
  label: string;
  value: string;
  delta: string;
  direction: "up" | "down" | "flat";
}
