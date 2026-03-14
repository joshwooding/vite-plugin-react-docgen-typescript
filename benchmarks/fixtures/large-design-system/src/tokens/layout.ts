export type GapToken = "none" | "xs" | "sm" | "md" | "lg" | "xl";
export type PaddingToken = "xs" | "sm" | "md" | "lg";

export const GAP_SCALE: Record<GapToken, number> = {
  lg: 24,
  md: 16,
  none: 0,
  sm: 12,
  xl: 32,
  xs: 8,
};
