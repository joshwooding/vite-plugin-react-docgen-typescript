---
"@joshwooding/vite-plugin-react-docgen-typescript": patch
---

Validate persistent docgen cache entries against the current TypeScript program before reuse, so newly included declarations, global types, and module augmentations invalidate stale metadata after a restart.

Register existing external type dependencies with Vite's watcher so edits refresh affected components, including dependencies in referenced projects. External type files that are absent when the server starts remain a known watch limitation.
