import type { TestIdentifiable } from "@design/foundations/index";
import type { GapToken } from "@tokens/index";

export interface StackProps extends TestIdentifiable {
  /** Vertical gap token used by card and drawer compositions. */
  gap?: GapToken;
  /** Optional content rendered by the stack. */
  children?: unknown;
  /** Indicates whether the layout should visually split after the first item. */
  splitAfterFirst?: boolean;
}

/** Vertical layout primitive used by cards, drawers, and recipes. */
export const Stack = ({
  children,
  gap = "md",
  splitAfterFirst = false,
  testId,
}: StackProps) => {
  return (
    <div data-gap={gap} data-split={splitAfterFirst} data-testid={testId}>
      {children}
    </div>
  );
};
