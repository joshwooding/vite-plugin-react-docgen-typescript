import { SectionHeading, StatusBadge, SurfaceCard } from "@components/index";
import type { AccountOwner, TestIdentifiable } from "@shared/index";

export interface WorkspaceRosterProps extends TestIdentifiable {
  /** Owners currently assigned to the workspace. */
  owners: readonly AccountOwner[];
  /** Label describing the active staffing posture. */
  staffingStatus: string;
}

/** Workspace staffing view used by operations and support teams. */
export const WorkspaceRoster = ({
  owners,
  staffingStatus,
  testId,
}: WorkspaceRosterProps) => {
  return (
    <div data-testid={testId}>
      <SectionHeading
        actions={["Invite owner", "Rebalance queue"]}
        eyebrow="Workspace"
        title="Roster"
      />
      <SurfaceCard
        content="Workspace ownership grouped by team for the active rotation."
        details={owners.map((owner) => `${owner.displayName} (${owner.team})`)}
        title="Workspace owners"
      />
      <StatusBadge label={staffingStatus} tone="info" />
    </div>
  );
};
