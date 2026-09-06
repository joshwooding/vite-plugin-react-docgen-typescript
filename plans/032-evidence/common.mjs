import path from "node:path";
import { fileURLToPath } from "node:url";
export * from "../../.yarn/.codex-worktrees/plan029/vite-plugin-react-docgen-typescript/plans/029-evidence/common.mjs";
export const evidence = path.dirname(fileURLToPath(import.meta.url));
export const raw = path.join(evidence, "raw");
export const frozenEvidence = path.resolve(evidence, "../../.yarn/.codex-worktrees/plan029/vite-plugin-react-docgen-typescript/plans/029-evidence");
