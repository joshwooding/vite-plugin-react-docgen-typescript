import type { SemanticFailureCode } from "./importedTypeHmrContract";

export const EXACT_LEGACY_HMR_ROW_KEYS = [
  "project-reference:both-project-service-precedence",
  "project-reference:default",
  "project-reference:project-service",
  "project-reference:watch",
  "same-project:both-project-service-precedence",
  "same-project:default",
  "same-project:project-service",
  "same-project:watch",
] as const;

export type LegacyHmrRowKey = (typeof EXACT_LEGACY_HMR_ROW_KEYS)[number];

export const legacyHmrExpectedFailures: Record<
  LegacyHmrRowKey,
  readonly SemanticFailureCode[]
> = {
  // issue #57: referenced project, both flags/project-service precedence. Delivery,
  // core invalidation, and metadata freshness fail; component-touch recovery is
  // fresh, proving the fixture is healthy. Plan 008 may remove these entries.
  "project-reference:both-project-service-precedence": [
    "delivery:first-edit",
    "delivery:second-edit",
    "freshness:first-edit",
    "freshness:second-edit",
    "invalidation:first-edit",
    "invalidation:second-edit",
  ],
  // issue #57: referenced project, default mode. Delivery, core invalidation,
  // and metadata freshness fail; component-touch recovery is fresh, proving the
  // fixture is healthy. Plan 008 may remove these entries.
  "project-reference:default": [
    "delivery:first-edit",
    "delivery:second-edit",
    "freshness:first-edit",
    "freshness:second-edit",
    "invalidation:first-edit",
    "invalidation:second-edit",
  ],
  // issue #57: referenced project, project-service mode. Delivery, core
  // invalidation, and metadata freshness fail; component-touch recovery is
  // fresh, proving the fixture is healthy. Plan 008 may remove these entries.
  "project-reference:project-service": [
    "delivery:first-edit",
    "delivery:second-edit",
    "freshness:first-edit",
    "freshness:second-edit",
    "invalidation:first-edit",
    "invalidation:second-edit",
  ],
  // issue #57: referenced project, watch mode. Delivery, core invalidation, and
  // metadata freshness fail; component-touch recovery is fresh, proving the
  // fixture is healthy. Plan 008 may remove these entries.
  "project-reference:watch": [
    "delivery:first-edit",
    "delivery:second-edit",
    "freshness:first-edit",
    "freshness:second-edit",
    "invalidation:first-edit",
    "invalidation:second-edit",
  ],
  // issue #57: same project, both flags/project-service precedence. Delivery,
  // core invalidation, and metadata freshness fail; component-touch recovery is
  // fresh, proving the fixture is healthy. Plan 008 may remove these entries.
  "same-project:both-project-service-precedence": [
    "delivery:first-edit",
    "delivery:second-edit",
    "freshness:first-edit",
    "freshness:second-edit",
    "invalidation:first-edit",
    "invalidation:second-edit",
  ],
  // issue #57: same project, default mode. Delivery, core invalidation, and
  // metadata freshness fail; component-touch recovery is fresh, proving the
  // fixture is healthy. Plan 008 may remove these entries.
  "same-project:default": [
    "delivery:first-edit",
    "delivery:second-edit",
    "freshness:first-edit",
    "freshness:second-edit",
    "invalidation:first-edit",
    "invalidation:second-edit",
  ],
  // issue #57: same project, project-service mode. Delivery, core invalidation,
  // and metadata freshness fail; component-touch recovery is fresh, proving the
  // fixture is healthy. Plan 008 may remove these entries.
  "same-project:project-service": [
    "delivery:first-edit",
    "delivery:second-edit",
    "freshness:first-edit",
    "freshness:second-edit",
    "invalidation:first-edit",
    "invalidation:second-edit",
  ],
  // issue #57: same project, watch mode. Delivery, core invalidation, and
  // metadata freshness fail; component-touch recovery is fresh, proving the
  // fixture is healthy. Plan 008 may remove these entries.
  "same-project:watch": [
    "delivery:first-edit",
    "delivery:second-edit",
    "freshness:first-edit",
    "freshness:second-edit",
    "invalidation:first-edit",
    "invalidation:second-edit",
  ],
};
