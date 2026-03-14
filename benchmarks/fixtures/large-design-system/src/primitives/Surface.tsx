import type {
  Density,
  Emphasis,
  TestIdentifiable,
} from "@design/foundations/index";
import type { ColorToken } from "@tokens/index";
import { Box } from "./Box";
import { Stack } from "./Stack";
import { Text } from "./Text";

export interface SurfaceProps extends TestIdentifiable {
  /** Title rendered by the surface header. */
  title: string;
  /** Supporting content describing the wrapped section. */
  subtitle?: string;
  /** Body copy used by simple reference surfaces. */
  content: string;
  /** Density token used by compact and spacious variants. */
  density?: Density;
  /** Emphasis level applied to section framing. */
  emphasis?: Emphasis;
  /** Background token used by raised and highlighted surfaces. */
  background?: ColorToken;
  /** Optional composed content rendered below the summary copy. */
  children?: unknown;
}

/** Framing primitive used by banners, drawers, and recipe sections. */
export const Surface = ({
  background = "surface-raised",
  children,
  content,
  density = "regular",
  emphasis = "default",
  subtitle,
  testId,
  title,
}: SurfaceProps) => {
  return (
    <Box
      background={background}
      padding={density === "compact" ? "sm" : "md"}
      testId={testId}
    >
      <Stack gap={density === "compact" ? "sm" : "md"}>
        <Text content={title} role="title" weight="strong" />
        {subtitle ? (
          <Text content={subtitle} role="caption" tone="foreground-muted" />
        ) : null}
        <Text content={content} role="body" />
        <div data-emphasis={emphasis}>{children}</div>
      </Stack>
    </Box>
  );
};
