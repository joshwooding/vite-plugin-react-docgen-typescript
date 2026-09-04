---
"@joshwooding/vite-plugin-react-docgen-typescript": minor
---

Add an experimental `docgenMode: "native"` backend for TypeScript 7.1's
`typescript/unstable/sync` API, including imported-prop HMR and project-reference
support. Native requests are batched and project/path state is reused across
transforms. TypeScript 7.0 remains unsupported.
