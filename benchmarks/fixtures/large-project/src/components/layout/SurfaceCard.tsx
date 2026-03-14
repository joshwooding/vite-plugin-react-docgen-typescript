import type { BaseSurfaceProps, TestIdentifiable } from "@shared/index";

export interface SurfaceCardProps extends BaseSurfaceProps, TestIdentifiable {
  /** Primary body copy displayed inside operational cards. */
  content: string;
  /** Optional composed content rendered below the summary details. */
  children?: unknown;
  /** Optional bullet list used for checklist-style summaries. */
  details?: readonly string[];
  /** Highlights important cards during incident response. */
  highlight?: boolean;
}

/** Reusable surface wrapper for overview and operations content. */
export const SurfaceCard = ({
  children,
  content,
  details = [],
  density = "regular",
  highlight = false,
  subtitle,
  testId,
  title,
  tone = "neutral",
}: SurfaceCardProps) => {
  return (
    <section
      data-density={density}
      data-highlight={highlight}
      data-testid={testId}
      data-tone={tone}
    >
      <header>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      <p>{content}</p>
      {details.length > 0 ? (
        <ul>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      {children}
    </section>
  );
};
