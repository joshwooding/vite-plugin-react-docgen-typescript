import type { AliasedImportColor } from "@fixtures/AliasedImport.types";
import * as React from "react";

interface AliasedImportProps {
  /** Button color. */
  color: AliasedImportColor;
}

/**
 * A component whose prop types are resolved through tsconfig paths.
 */
export const AliasedImportComponent: React.FC<AliasedImportProps> = (props) => (
  <button style={{ backgroundColor: props.color }}>{props.children}</button>
);
