import type {
  DrawerSection,
  TestIdentifiable,
  TokenReference,
} from "@design/foundations/index";
import { PageHeader } from "@design/navigation/index";
import { Drawer } from "@design/overlays/index";
import { Banner } from "@feedback/index";
import { Inline, Stack, Text } from "@primitives/index";

export interface TokenAuditBoardProps extends TestIdentifiable {
  /** Tokens currently under audit in the review board. */
  tokens: readonly TokenReference[];
  /** Drawer sections describing audit workflow stages. */
  sections: readonly DrawerSection[];
}

/** Audit board recipe used to review token migrations and usage. */
export const TokenAuditBoard = ({
  sections,
  testId,
  tokens,
}: TokenAuditBoardProps) => {
  return (
    <Stack gap="md" testId={testId}>
      <PageHeader
        eyebrow="Tokens"
        summary="Track migration status and ownership for token changes."
        title="Token audit board"
      />
      <Banner
        message="Audit high-traffic tokens before promoting them to stable."
        title="Review queue"
        tone="success"
      />
      <Drawer sections={sections} title="Audit sections" />
      <Inline gap="sm">
        {tokens.map((token) => (
          <Text
            key={token.name}
            content={token.name}
            role="caption"
            tone="foreground-muted"
          />
        ))}
      </Inline>
    </Stack>
  );
};
