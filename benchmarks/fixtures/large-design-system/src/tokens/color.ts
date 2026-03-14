export type ColorToken =
  | "foreground-default"
  | "foreground-muted"
  | "foreground-accent"
  | "surface-default"
  | "surface-raised"
  | "surface-highlight"
  | "border-strong";

export const COLOR_TOKENS: Record<ColorToken, string> = {
  "border-strong": "#8b949e",
  "foreground-accent": "#0f62fe",
  "foreground-default": "#111827",
  "foreground-muted": "#4b5563",
  "surface-default": "#ffffff",
  "surface-highlight": "#eef4ff",
  "surface-raised": "#f7f8fa",
};
