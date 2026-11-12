# Public Multi-Board Pacing

The approved real-time upgrade's public-complexity timing used `wetness` after
the strategic multi-board path replaced it with the texture of the board on
which the hero had the highest private equity. With the same two public boards
and the same final call, changing only the hero's cards therefore changed this
timing input.

`HorseLogic` now retains the primary public board's texture before selecting
the strategic style board. Public-complexity pacing uses that retained value;
the strategy still evaluates its strongest board. Single-board pacing, the
explicit legacy timing ablation, action-size gravity, Hollywood balancing,
random-number consumption and turn-deadline clamps retain their existing paths.
This closes the private strongest-board dependency in the public-complexity
input; it does not claim all policy-dependent timing or random streams are
independent of private holdings.

The regression in `HorseMultiStreetDynamicPlan.test.ts` runs the real decision
producer and timing consumer with two holdings on identical public boards.
Both decisions call 20 with no fallback. It fixes only the timing random seed
to separate this dependency from earlier Monte Carlo draws. Before the fix it
failed with 1,396 ms versus 1,263 ms; afterward the timings agree. The complete
multi-street, decision-gravity, PLO overhaul and Hold'em overhaul suites passed
64 tests. Production activation and live verification remain separate release
requirements.
