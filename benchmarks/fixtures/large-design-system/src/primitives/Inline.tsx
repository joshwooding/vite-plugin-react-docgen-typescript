import type { TestIdentifiable } from "@design/foundations/index";
import type { GapToken } from "@tokens/index";

export interface InlineProps extends TestIdentifiable {
  /** Horizontal alignment strategy for toolbar-style rows. */
  align?: "center" | "end" | "start" | "stretch";
  /** Gap token shared by navigation and toolbar primitives. */
  gap?: GapToken;
  /** Optional content rendered inside the inline layout. */
  children?: unknown;
}

/** Horizontal layout primitive shared by tabs, toolbars, and banners. */
export const Inline = ({
  align = "start",
  children,
  gap = "sm",
  testId,
}: InlineProps) => {
  return (
    <div data-align={align} data-gap={gap} data-testid={testId}>
      {children}
    </div>
  );
};
