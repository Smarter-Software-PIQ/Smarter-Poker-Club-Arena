# The Checkpoint Guard Runs As The Process

Release 41730448462-1 (59b0d5dc) reached its 22:55 UTC break. The bounded census passed. The retained checkpoint guard then refused `retained_process_actor_unproven` at preflight, before touching any table (attemptedTables 0, checkpointOutcome not_started), and the old engine was recovered.

**Cause.** The guard requires `currentTournamentDataAuthority() === null`. Inspector evaluates it on the predecessor's main thread. On Node 22 a tournament manager's AsyncLocalStorage store can sit on whatever resource is current at that moment, so the guard inherited a foreign tournament authority. The predecessor's own `dataActorContext.ts` documents this leak and provides `bindToProcessRoot`, which its root-bound timers already use.

**Fix.** The guard call now runs through the predecessor's `bindToProcessRoot`. Every check is unchanged, and every bound manager method still enters its own authority. A predecessor without `bindToProcessRoot` runs the guard exactly as before. A regression test uses a real AsyncLocalStorage with a leaked store to show:

- the new declaration sees no authority;
- the old declaration inherited the leaked one;
- the fallback is unchanged.

**Window.** A new fixed owner window, `2026-11-03-phase1-plo-horse-55-2330z`, runs 23:30 UTC November 3 to 05:30 UTC November 4, with Chicago minute 53 notice and minute 55 activation. It is issued under Dan's standing :55 reset order, and its activation floor witness binds it. Every earlier entry is unchanged.
