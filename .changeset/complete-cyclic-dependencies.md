---
"@joshwooding/vite-plugin-react-docgen-typescript": patch
---

Track complete component dependencies through cyclic imports regardless of transform order, so edits to shared types refresh every affected component's docgen metadata.
