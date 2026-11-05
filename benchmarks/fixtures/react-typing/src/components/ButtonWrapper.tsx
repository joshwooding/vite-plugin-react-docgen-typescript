import { Button, type ButtonProps } from "./Button";

export interface ButtonWrapperProps extends ButtonProps {
  /** Accessible name for the wrapped action. */
  label: string;
}

/** Wrapper importing its native and shared props from Button. */
export function ButtonWrapper({ label, ...props }: ButtonWrapperProps) {
  return <Button aria-label={label} {...props} />;
}
