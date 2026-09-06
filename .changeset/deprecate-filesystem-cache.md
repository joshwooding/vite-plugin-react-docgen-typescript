---
"@joshwooding/vite-plugin-react-docgen-typescript": patch
---

Deprecate `fileSystemCache` and annotate its options interface with `@deprecated`.
Remove `fileSystemCache` from configuration or set it to `false`. In-memory
transform caching and TypeScript program reuse continue. Existing boolean and
object configurations, including custom directories, still work; the default
remains `false`.

A 60-run recheck on two Windows fixtures across both stable modes found
insufficient startup benefit and slower edit processing with disk persistence.
These results support simplifying the feature, without promising a speedup for
every consumer.

Removal is intended for a later breaking release, after at least one published
compatible release carrying this notice. No removal version or date is set.
