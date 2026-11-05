import type * as React from "react";
import type { ActionProps } from "../shared";

export type ButtonProps = React.ComponentPropsWithoutRef<"button"> &
  ActionProps;

/** Native button with shared action styling. */
export function Button({ intent = "primary", ...props }: ButtonProps) {
  return <button data-intent={intent} {...props} />;
}
