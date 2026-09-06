# Plan 037: verified TypeScript 7 restack

The agreed review order is #87 (benchmark tooling), #89 (reviewed performance and
correctness changes), then the existing #86 (experimental TypeScript 7).
The native branch starts from `5b496e9484dc6cc4eca9734ff8a732b063686795`
and incorporates performance base `b196f305800586eecd45d12f3af7cef00a7b83cc`.
The update preserves history and can be pushed without force.

## Final changes

Merge resolutions retain native batching, filtered Vite hooks and observational
benchmark controls alongside asynchronous cache validation, current config
watches, canonical dependency output and teardown guards. Fresh physical path
resolution is retained rather than the older native global realpath cache.

Review fixes preserve public `shouldSortUnions` typing and native lexical sorting,
track contributing direct/linked package declarations, honor standalone in-memory
source without changing disk or persistent state, retain imports introduced by
temporary source, and read complete defaultProps AST initializers. Asserted,
satisfies, parenthesized/non-null and nested assignments remain supported.

Two findings were rejected using direct legacy parity: the enum-only option does
extract ordinary literal unions, and aliased names/resolvers use the resolved
local symbol. Those existing semantics are unchanged. Anonymous inline prop
declaration provenance remains an existing experimental native follow-up;
the naming/union regression proofs use named Props interfaces to isolate scope.

The benchmark preserves cache lifecycle rules, counts complete HMR transforms,
adds native reanalysis, and rejects incompatible baseline schemas/timing profiles.
The complete source diff was reviewed in bounded pieces with coverage records;
no patch was truncated. Follow-up review records retain each accepted/rejected
finding and proof. Final runtime and tooling reviews are clean.

## Verification

The initial full suite passed 373/377. The four failures were an inherited test
wrapper assuming a callable transform hook. After adapting it to filtered hooks,
all 12 external-watch tests passed. The native file then grew from 21 to 33 tests;
all 33 pass. This covers 389 cases across the full and focused runs; final remote
CI checks the complete current head. Snapshots were not changed.

The final build, typecheck and full Biome check passed. The final packed artifact
SHA-256 is `344e7cced8c64b695c9b25533fd6fcf2010f15a8b5dd8c6bf240da54680177c7`.
Its isolated TypeScript 7.1.0-dev.20260903.1 / Vite 8.1.5 consumer passed edits and
membership changes in same-project and referenced-project configurations, with
zero leftover watcher handles. All five stable/compatibility modes passed an
isolated TS6.0.3 / Vite 8.1.5 packed check before the final native-only AST
correction; stable runtime source is unchanged.

The ProjectService/native ten-component/two-edit parity smoke passed after the
source/default-value fixes. The 24-file fixture instrumentation and complete HMR
session smoke passed during integration. Smoke timings ran alongside other work
and are not performance claims. The measured trunk comparison belongs to
[Plan 036](036-trunk-stack-comparison.md).

The performance base #89 has green CI, including both OS benchmarks and all ten
packed-runtime matrix rows. The restacked #86 remote CI follows the signed push.
Raw checks, archive members, source identities and review dispositions are in
[037-native-restack-evidence](037-native-restack-evidence).
