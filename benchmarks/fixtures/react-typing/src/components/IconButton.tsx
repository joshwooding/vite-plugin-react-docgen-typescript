import type * as React from "react";
import type { ActionProps } from "../shared";

export type IconButtonProps = React.ComponentPropsWithoutRef<"button"> &
  ActionProps & { label: string };

/** Second consumer of the imported action union and native button props. */
export function IconButton({
  label,
  intent = "quiet",
  ...props
}: IconButtonProps) {
  return <button aria-label={label} data-intent={intent} {...props} />;
}
