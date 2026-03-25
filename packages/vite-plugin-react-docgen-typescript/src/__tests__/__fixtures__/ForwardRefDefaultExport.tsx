import * as React from "react";

interface ForwardRefDefaultExportProps {
  /** Button color. */
  color: "blue" | "green";
}

/**
 * A forwardRef component exported through a differently named file.
 */
const Button = React.forwardRef<
  HTMLButtonElement,
  ForwardRefDefaultExportProps
>((props, ref) => (
  <button ref={ref} style={{ backgroundColor: props.color }}>
    {props.children}
  </button>
));

export default Button;
