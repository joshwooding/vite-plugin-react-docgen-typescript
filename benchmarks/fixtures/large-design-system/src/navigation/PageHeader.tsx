import type {
  ActionDescriptor,
  TestIdentifiable,
} from "@design/foundations/index";
import { Inline, Stack, Text } from "@primitives/index";

export interface PageHeaderProps extends TestIdentifiable {
  /** Primary title for the documented design-system page. */
  title: string;
  /** Optional eyebrow shown above the title. */
  eyebrow?: string;
  /** Short summary describing the page contents. */
  summary?: string;
  /** Action descriptors rendered alongside the page title. */
  actions?: readonly ActionDescriptor<string>[];
}

/** Page header used by recipes and documentation-style surfaces. */
export const PageHeader = ({
  actions = [],
  eyebrow,
  summary,
  testId,
  title,
}: PageHeaderProps) => {
  return (
    <Stack gap="sm" testId={testId}>
      {eyebrow ? (
        <Text content={eyebrow} role="eyebrow" tone="foreground-muted" />
      ) : null}
      <Inline align="center" gap="md">
        <Text content={title} role="title" weight="strong" />
        {actions.map((action) => (
          <Text
            key={action.analyticsKey}
            content={action.label}
            role="caption"
          />
        ))}
      </Inline>
      {summary ? <Text content={summary} role="body" /> : null}
    </Stack>
  );
};
