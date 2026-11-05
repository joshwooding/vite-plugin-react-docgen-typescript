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
  "project-reference:both-project-service-precedence": [],
  "project-reference:default": [],
  "project-reference:project-service": [],
  "project-reference:watch": [],
  "same-project:both-project-service-precedence": [],
  "same-project:default": [],
  "same-project:project-service": [],
  "same-project:watch": [],
};
