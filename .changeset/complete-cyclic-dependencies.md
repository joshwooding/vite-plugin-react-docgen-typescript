---
"@joshwooding/vite-plugin-react-docgen-typescript": patch
---

Track complete component dependencies through cyclic imports regardless of transform order, so edits to shared types refresh every affected component's docgen metadata.

Follow the compiler's resolved declaration targets and import/require modes, including referenced-project path mappings and unresolved conditional targets.
