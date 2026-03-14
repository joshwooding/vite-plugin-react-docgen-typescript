import type { TestIdentifiable, TextRole } from "@design/foundations/index";
import type { ColorToken, FontWeightToken } from "@tokens/index";

export interface TextProps extends TestIdentifiable {
  /** String content rendered by the text primitive. */
  content: string;
  /** Semantic role used by composed design-system components. */
  role?: TextRole;
  /** Color token applied to the rendered text. */
  tone?: ColorToken;
  /** Shared font-weight token used by titles and labels. */
  weight?: FontWeightToken;
  /** Truncates long labels inside compact surfaces. */
  truncate?: boolean;
}

/** Foundational typography primitive shared across published components. */
export const Text = ({
  content,
  role = "body",
  testId,
  tone = "foreground-default",
  truncate = false,
  weight = "regular",
}: TextProps) => {
  return (
    <span
      data-role={role}
      data-testid={testId}
      data-tone={tone}
      data-truncate={truncate}
      data-weight={weight}
    >
      {content}
    </span>
  );
};
