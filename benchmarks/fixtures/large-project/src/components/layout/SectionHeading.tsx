import type { TestIdentifiable } from "@shared/index";

export interface SectionHeadingProps extends TestIdentifiable {
  /** Short label used to group related workflow sections. */
  eyebrow?: string;
  /** Primary section title. */
  title: string;
  /** Optional action labels rendered next to the heading. */
  actions?: readonly string[];
}

/** Lightweight heading used by dense workflow sections. */
export const SectionHeading = ({
  actions = [],
  eyebrow,
  testId,
  title,
}: SectionHeadingProps) => {
  return (
    <header data-testid={testId}>
      {eyebrow ? <small>{eyebrow}</small> : null}
      <h3>{title}</h3>
      {actions.length > 0 ? (
        <nav>
          {actions.map((action) => (
            <span key={action}>{action}</span>
          ))}
        </nav>
      ) : null}
    </header>
  );
};
