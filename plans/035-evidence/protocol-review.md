# Plan035 protocol review

Root and an independent read-only reviewer inspected the existing benchmark,
Plan024 launcher/statistics/validation, and current cache ownership before any035
timing sample. Base: `ec7455ac7bf3986610b7f79291dd1acae644beba`, 2026-09-06.

The selected scope is the original16-file large-project and three-file react-typing
fixtures at scale1, both stable modes. The CLI supports only its four built-in
scenarios and a component-description edit; it has no consumer-root or Salt input.
Exported measurement helpers do not by themselves establish a faithful Salt
workload. A Salt adapter is outside this bounded recheck.

The existing reports verify positive persistent entries, description freshness,
selected React fields and affected counts. They do not directly prove accepted
persistent hits or equal affected identities. Plan035 adds untimed observations
of actual extraction calls and complete semantic output against fresh extraction,
plus actual affected/invalidated/transformed identities, before timing unchanged
benchmark processes. Instrumented controls never enter timing statistics.

The predeclared sample budget is60 initial measured CLI processes, with one
variance-triggered extension to ten samples for all three states of each affected
scenario/mode group; maximum120. Decision metrics are cold/HMR/session MAD>20%
of median. Persistent excess or zero denominators makes the decision INCONCLUSIVE.
Order rotates cache states by round, with one mode/one iteration per fresh process.
PIDs may be recycled across nonoverlapping process lifetimes; invocation IDs,
spawn/report PID agreement and nonoverlapping lifetimes establish fresh invocations.

The retention rule explicitly matches024's implemented global HMR veto:
at least one group must save both20% and100ms of restart cold time, and no reported
populate/restart group may regress HMR by both10% and10ms. Report per-group results
alongside this conservative aggregate. No new session-benefit rule is added.
Break-even remains a projection from population overhead and positive restart
session savings, with negative deltas reported honestly.

The existing full26-checkpoint restart and native watcher proof is retained, not
replaced with a smaller new test. Root verified current runtime Git content and
all archive/dist hashes against the completed033/034 proof in
`reused-runtime-proof.json`; the artifact is unchanged. Repeating those matrices
would add no new input. The selected-workload controls are the additional gate.

Cold means a fresh measured process and its initial plugin work. OS caches may
be warm; process launch, fixture copying and seed processes are excluded. HMR
is direct-plugin hook plus affected transforms, not browser latency. Neither this
scope nor a scalar retention verdict proves disk persistence useless universally.

Source references inspected: benchmark-playground.mjs42-190,234-275,382-429,
651-659,716-819,851-874,1096-1102; Plan024 summarize.mjs33-78,86-165;
src/plugin.ts348-375. The review identified protocol requirements, not new
production-code defects. No external review-service upload was performed.

Root pre-capture review also found that the initial control constructor placed
fixtures below the worktree, where large-project could inherit repository
node_modules/@types. The timed harness uses OS-temp fixtures. Controls must use
the same OS-temp topology and explicit React junction; this is a control-setup
correction before sampling, not a product change or a relaxed assertion. Root
also required the freeze gate to check uncommitted input drift against the base,
not only commit-to-commit history.
