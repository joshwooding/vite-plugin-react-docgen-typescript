import type { TestIdentifiable } from "@design/foundations/index";
import { Inline, Text } from "@primitives/index";

export interface TabsProps extends TestIdentifiable {
  /** Visible tab labels for the current navigation group. */
  items: readonly string[];
  /** Currently selected tab label. */
  activeItem: string;
}

/** Tabs primitive used by galleries, audits, and settings recipes. */
export const Tabs = ({ activeItem, items, testId }: TabsProps) => {
  return (
    <Inline gap="sm" testId={testId}>
      {items.map((item) => (
        <Text
          key={item}
          content={item}
          role="label"
          tone={item === activeItem ? "foreground-accent" : "foreground-muted"}
          weight={item === activeItem ? "strong" : "regular"}
        />
      ))}
    </Inline>
  );
};
