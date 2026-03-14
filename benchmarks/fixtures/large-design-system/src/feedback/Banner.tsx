import type { StatusTone, TestIdentifiable } from "@design/foundations/index";
import { Surface, Text } from "@primitives/index";

export interface BannerProps extends TestIdentifiable {
  /** Banner title shown at the top of the feedback surface. */
  title: string;
  /** Supporting message that describes the current state. */
  message: string;
  /** Status tone used to style the banner semantics. */
  tone: StatusTone;
}

/** High-level feedback surface used across documentation recipes. */
export const Banner = ({ message, testId, title, tone }: BannerProps) => {
  return (
    <Surface
      background={tone === "critical" ? "surface-highlight" : "surface-raised"}
      content={message}
      testId={testId}
      title={title}
    >
      <Text content={tone} role="caption" tone="foreground-muted" />
    </Surface>
  );
};
