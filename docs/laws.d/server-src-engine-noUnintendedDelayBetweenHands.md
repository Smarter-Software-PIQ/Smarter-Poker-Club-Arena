# server/src/engine/noUnintendedDelayBetweenHands.law.test.ts

Dan 2026-11-18: "i just don't want any 'un intended delays'". Every intended beat keeps its length; between one hand's settlement (`hand_history.ended_at`, HAND_COMPLETE) and the next HAND_START (`started_at`) the gap is `owedBetweenHandsMs(shape)` plus at most `ENGINE_BETWEEN_HANDS_BUDGET_MS` (250 ms of in-process work and jitter). The law pins the waterfall per shape, measures the real dealHand at 150 ms per round trip (the F06 state read, `fn_f06_begin_hand` and, since 2026-11-19, the seq-0 save of the prepared hand ride under the rest: a tournament hand starts within rest + 80 ms), and names every await between the hold and the deal, on which side of the rest it runs, so a new wait fails CI. Production grading: `scripts/sql/hand-gap-unintended-delay.sql`.

Waterfall at the player's default Animation Speed (the engine holds 1x for every seat), in milliseconds:

| shape                                    | showdown read        | display beat | bets sweep | pot push | award stagger | muck | rest (Rabbit Hunt)          | owed        |
| ---------------------------------------- | -------------------- | ------------ | ---------- | -------- | ------------- | ---- | --------------------------- | ----------- |
| fold win                                 | -                    | -            | 500        | 1100     | -             | 250  | 1500                        | 3350        |
| heads-up showdown, chips on the river    | 1400                 | 1500         | 500        | 1100     | -             | 250  | 1500                        | 6250        |
| heads-up showdown, river checked through | 1400                 | 1500         | -          | 1100     | -             | 250  | 1500                        | 5750        |
| all-in run out                           | 1400                 | 2000         | -          | 1100     | -             | 250  | 1500                        | 6250        |
| each extra hand shown                    | +350 (cap 2200 read) |              |            |          |               |      |                             | +350        |
| each extra paid pot group                |                      |              |            |          | +900          |      |                             | +900        |
| cash bust, rebuy pause (horse or human)  |                      |              |            |          |               |      | max(1500, pause up to 5000) | up to +3500 |

Measured on production 2026-11-18 (classic tables, Lightning excluded): cash fold p50 3.35 s (engine about 5 ms over owed), cash showdown 6.25 s, tournament fold 3.85 s (about 0.5 s of F06 round trips after the rest, moved under the rest by this law's PR), tournament showdown 7.29 s (the unplayed 500 ms sweep on 97% of them, removed in #11302).

Not before (2026-11-23): both beats end on their own deadline. A Node timer counts whole milliseconds on libuv's loop clock, not on Date.now(), so one `setTimeout(deadline - Date.now())` can wake 1-2 ms before the wall clock reads the deadline; that started a measured deal at rest - 1 ms (CI `expected 1499 to be >= 1500`, PR #11817). `ServerTableEngineBase.sleepUntil` waits out a residue of at most `NODE_TIMER_EARLY_WAKE_MAX_MS` with one padded timer and never waits a larger residue (a wall clock stepped back never stretches a beat); the law models every sleep waking that early and pins both rest paths, the completion hold and the clock-step bound.
