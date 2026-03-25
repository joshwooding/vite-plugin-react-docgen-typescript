import * as React from "react";

interface AmbientDeclarationProps {
  /** Alert tone. */
  tone: AmbientDeclarationTone;
}

/**
 * A component that relies on an ambient declaration file.
 */
export const AmbientDeclarationComponent: React.FC<AmbientDeclarationProps> = (
  props,
) => <div data-tone={props.tone}>{props.children}</div>;
