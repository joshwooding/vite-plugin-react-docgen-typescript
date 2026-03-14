import type { TestIdentifiable } from "@design/foundations/index";
import type { ColorToken, PaddingToken } from "@tokens/index";

export interface BoxProps extends TestIdentifiable {
  /** Host element used by layout and surface primitives. */
  as?: "article" | "div" | "section";
  /** Background token applied by composed surfaces. */
  background?: ColorToken;
  /** Named padding token used by dense design-system containers. */
  padding?: PaddingToken;
  /** Optional composed content rendered inside the primitive. */
  children?: unknown;
}

/** Low-level layout primitive for spacing and background token application. */
export const Box = ({
  as = "div",
  background = "surface-default",
  children,
  padding = "md",
  testId,
}: BoxProps) => {
  const Element = as;

  return (
    <Element
      data-background={background}
      data-padding={padding}
      data-testid={testId}
    >
      {children}
    </Element>
  );
};
