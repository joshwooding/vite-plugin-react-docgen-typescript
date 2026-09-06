---
"@joshwooding/vite-plugin-react-docgen-typescript": minor
---

Add an experimental `docgenMode: "native"` backend for TypeScript 7.1's
`typescript/unstable/sync` API, including imported-prop HMR and project-reference
support. Native requests are batched and project/path state is reused across
transforms. TypeScript 7.0 remains unsupported.

In the [6 September 2026 CI run](https://github.com/joshwooding/vite-plugin-react-docgen-typescript/actions/runs/34040796932),
the 188-component fixture used seven projects, ten shared-type edits and two
fresh processes per backend. Compared with ProjectService in that run, native
reduced total cold time by 48% on Linux and 26% on Windows, and edit p50 by 31%
and 11%, respectively. Post-edit retained RSS, including the native engine
process, was 13% and 14% lower. Both platforms produced exact metadata agreement
for all 188 components.

Results depend on the workload: in the separate 24-file fixture, native's full
session was 29% shorter on Linux but 35% longer on Windows. Cache-bypassed
reanalysis was about four times slower on native on both platforms. These CI
measurements are diagnostic and do not establish a speedup for every project.
