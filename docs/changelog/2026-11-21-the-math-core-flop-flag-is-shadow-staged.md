# The math core's PLO5 flop flag is back on the shadow stage (2026-11-21)

`omahaMathCorePlo5Flop` is listed again in `OPTION_SHADOW_STAGE`, for PLO5 cash flop decisions only, with `omahaMathCore` as its companion. It was taken out on 2026-11-20 because a re-decision with the core cost 50-125 ms on PLO5 postflop; the core's 2+3 evaluator is now table driven and it does no work on a street whose flag is off.

- **Scope.** Re-decided only in a PLO5 cash flop decision; never PLO4, PLO6, a tournament, a bomb pot or another street. No other core street flag is staged.
- **Cost.** On the recorded and generated PLO5 flop decisions, the staged re-decision (acted decision, then the re-decision with the flag and its companion, one breaker from a fresh process) measured p50 13.7 / p95 33.8 / max 58.8 ms over 239 re-decisions at load 18.6; the only two over 50 ms were among the first four of the process; the breaker (three over 50 ms in 20, or one over 150 ms) did not trip.
- **Switching.** Inert until its registry entry takes `shadow`: the option's release default is still decided by code, so the registry refuses `shadow` until it is classified release-default off (a separate switch-list change). It never acts on a decision: the stage runs after the answer is sent and changes nothing of it.
