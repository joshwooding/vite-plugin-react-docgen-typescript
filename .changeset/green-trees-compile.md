---
"@joshwooding/vite-plugin-react-docgen-typescript": minor
---

Add an experimental `docgenMode: "native"` backend for TypeScript 7.1's
`typescript/unstable/sync` API, including imported-prop HMR and project-reference
support. Native requests are batched and project/path state is reused across
transforms. TypeScript 7.0 remains unsupported.

In the CI benchmark covering 188 components and shared fan-out edits, the
optimized ProjectService backend reduced median edit time by 90% on Linux and
94% on Windows compared with the previous implementation. The native backend
then reduced median edit time by a further 58% on Linux and 49% on Windows,
reduced cold analysis time by 51% and 40%, and used about 37% less retained
memory after cold analysis. Results vary by project and environment.
