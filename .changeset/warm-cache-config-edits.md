---
"@joshwooding/vite-plugin-react-docgen-typescript": patch
---

Invalidate cached docgen metadata when a TypeScript config changes after loading persistent cache entries, including before the compiler backend starts.

Register cached config paths with Vite's watcher so edits to custom configs and extended configs outside the Vite root trigger invalidation.
