import type {
  DrawerSection,
  TestIdentifiable,
} from "@design/foundations/index";
import { Stack, Surface, Text } from "@primitives/index";

export interface DrawerProps extends TestIdentifiable {
  /** Drawer title shown above the section list. */
  title: string;
  /** Sections rendered inside the drawer body. */
  sections: readonly DrawerSection[];
  /** Optional content rendered below the section list. */
  children?: unknown;
}

/** Overlay-style drawer used by filter and audit recipes. */
export const Drawer = ({ children, sections, testId, title }: DrawerProps) => {
  return (
    <Surface
      content="Layered controls and contextual information."
      testId={testId}
      title={title}
    >
      <Stack gap="sm">
        {sections.map((section) => (
          <Stack key={section.id} gap="xs">
            <Text content={section.title} role="label" weight="strong" />
            <Text
              content={section.description}
              role="caption"
              tone="foreground-muted"
            />
          </Stack>
        ))}
        {children}
      </Stack>
    </Surface>
  );
};
