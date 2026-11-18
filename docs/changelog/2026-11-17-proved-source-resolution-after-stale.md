# Original source resolution after stale classification

The controller recorded a real resolved member and receipt but left an incident
`stale_unverified` when it had already aged under a source's historical
no-resolve classification. Its resolved-signal branch omitted this state.

The existing transition now admits that state only with an actual same-episode
resolved observation, original member identity, no unresolved member of the
current episode and authoritative original source evidence. Supported evidence
is the exact owner drift proof, or either original stuck-tournament notice from
`fn_sp_critical_scan` with a valid tournament identity and ended predicate.
Generic no-resolve sources stay unverified. Transition authorization, history,
freshness/episode checks and the original receipt/quiet clock remain enforced.

Installation admits only already-recorded matching source resolutions through
that same guarded transition. No signal is invented, no money changes and no
new schedule or manual controller tick is introduced. The maintained native
Stage B qualification reproduces the prior failure and exercises real intake,
unproved closure refusal, both source families, quiet verification and refiring.
