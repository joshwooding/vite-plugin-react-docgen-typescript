interface RichMetadataProps {
  /**
   * Visual variant.
   *
   * @default pill
   * @remarks Used by the design system controls.
   */
  variant?: "pill" | "modern";
}

/**
 * Component with richer docgen metadata.
 *
 * @status beta
 * @see https://example.com/rich-metadata
 */
export const RichMetadataComponent = ({
  variant = "pill",
}: RichMetadataProps) => <button data-variant={variant}>{variant}</button>;
