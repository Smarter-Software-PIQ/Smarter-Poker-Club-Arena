# People vs Horses results

One question, answered the same way every time: **are real people winning or losing against the
Horses, per game, and is the difference bigger than luck?**

`scripts/ops/person-vs-horse-results.mjs` is a read-only report. Run it before any Horse rule is
switched on or off, and again after, with the switch instant as `--split-at`. It changes nothing.

After any Horse switch change or engine cutover, also run `scripts/ops/horse-exploit-report.mjs
--split-at <time> --gate` at +3 h (`docs/ops/horse-exploit-report.md`). It judges the Horses' own
fold, call and bluff rates against break-even, which has thousands of decisions an hour while this
report waits days for person-hands. A gate finding (exit 1) is a rollback trigger.

For a list of every recent switch or settings change with people's results before and after each
one, run `scripts/ops/option-people-impact.mjs` first (`docs/ops/option-people-impact.md`); it finds
the change worth a closer look, and this report then judges it.

## Run it

```bash
# The last 7 days, every game, cash and tournaments reported apart
node scripts/ops/person-vs-horse-results.mjs

# One game, before and after a switch change
node scripts/ops/person-vs-horse-results.mjs --games plo5 --mode cash \
  --since 2026-11-16T00:00:00Z --until 2026-11-23T00:00:00Z \
  --split-at 2026-11-22T03:13:56Z

# The gate a switch runbook calls
node scripts/ops/person-vs-horse-results.mjs --games plo5 --mode cash \
  --split-at 2026-11-22T03:13:56Z --gate

# Hands where an option changed a Horse decision, against hands where it did not
node scripts/ops/person-vs-horse-results.mjs --games nlh --mode cash \
  --since 2026-11-27T00:00:00Z --by-option-receipt cashDefenceTrimColdCalls
```

| Option                                      | Meaning                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--since <ISO>` `--until <ISO>`             | The range. Default: the last 7 days. At most 92 days. Instants need a zone (`...Z`).                  |
| `--games plo4,plo5,...`                     | Games to read. Default: all.                                                                          |
| `--mode cash\|tournament\|all`              | Cash tables, tournaments, or both. They are always reported apart.                                    |
| `--split-at <ISO>[,<ISO>...]`               | Cut the range into windows at these instants and compare each window with the one before it. Up to 8. |
| `--by day\|hour\|player\|stake\|table-size` | Add a breakdown under each game. Days and hours are UTC.                                              |
| `--by-option-receipt <option>`              | Compare the hands where that option's receipt fired against the hands where it did not, see below.    |
| `--json`                                    | The same report as JSON.                                                                              |
| `--gate`                                    | Exit code for a runbook, see below. Needs `--split-at`.                                               |
| `--sql`                                     | Print the query and stop.                                                                             |
| `--from-json <file>`                        | Build the report from saved query output.                                                             |

## What is counted

- **Hands** come from `hand_history`: every hand with `has_human` in the range, of the asked mode
  (`tournament_id` null is cash) and games (`game_variant`, `nlh` when empty).
- **Who sat in a hand** comes from `hand_history.players`. One person in one hand is a
  **person-hand**.
- **People** are accounts whose `profiles.is_horse` is not true.
- Accounts whose profile `status` is `deleted` are left out. This is the only deleted or test
  marker the `profiles` table has (checked 2026-11-23: `status` is `active` or `deleted`; there is
  no test, demo or internal column). The report prints how many person-hands this left out.
- Only hands where **at least one Horse was dealt in** (fewer people in the hand than players in
  `hand_history.players`). A hand with people only says nothing about the Horses. The report prints
  how many person-hands this left out.
- The result of a person-hand is `ca_hand_facts.net / big_blind`: net chips for the hand, after
  rake, in big blinds. People's results in a hand are added up, so chips that only moved between
  two people cancel and what is left is people against Horses, less the rake the people paid.
- "Showdown" is `ca_hand_facts.went_to_showdown`.

Tournament results are in tournament chips, not money. They are reported under their own heading
and are never mixed with cash.

## Where the result comes from, and why (decided 2026-11-24)

The result is read from **`ca_hand_facts`**, one row per seat per hand, looked up by its primary
key `(hand_id, user_id)` for every person `hand_history` seats in the hand.

- **Not `ca_hand_player_stat`** (what this report read until 2026-11-24). That table is a cache of
  each player's newest ~1,000 hands: `ca_roll_hand_stats_forward()` ends every run by deleting a
  player's rows past the newest 1,000 (`ca_prune_hand_player_stat` does the same on demand). So
  the totals for a past window shrank as people kept playing. PLO5 cash 2026-11-22T03:13:56Z to
  22:12:30Z read 829 hands on 2026-11-23 and only 242 person-hands (-455.2 bb) on 2026-11-24, after
  its busiest person had played more than 1,000 newer hands; 2026-11-17T06:00Z to
  2026-11-22T03:13:56Z had kept 1,845 of 6,211 person-hands.
- **Not `ca_hand_player_facts`** (the function that fills that cache, which recomputes from
  `hand_history`). It is wrong on bomb pots. A bomb pot's forced bet is logged as
  `bomb_ante` (`dead: true`, no blind posts); the function counts neither `bomb_ante` nor any
  action it does not name, and because the log has no blind posts it books the small or big blind
  the seat's position implies although nobody posted one. On PLO5 cash 2026-11-22T03:13:56Z to
  22:12:30Z the two sources disagree on 16 person-hands, all 16 of them timed bomb pots (ante 6,
  big blind 2). Replayed from the raw actions:
  - hand `41c06d33`: six antes of 6, turn bet 27 called twice, river bet 98 called twice: 36 + 81 +
    294 = 411, the stored `pot_size`. The person anted 6, checked the flop and folded the turn: the
    result is -6. `ca_hand_facts` says -6; the function says 0.
  - hand `b06f6fc5`: six antes of 6, flop 9 x 4, turn 26 x 3: 36 + 36 + 78 = 150 = `pot_size`. The
    person (small blind seat) anted 6 and folded the flop: -6. `ca_hand_facts` says -6; the function
    says -1 (a small blind of 1 that was never posted, and no ante).
  - the other 14 (`f13cc64a`, `42bc618e`, `a8a4287d`, `11d5f038`, `28091def` and nine more) differ
    by the ante (6) when the person sat outside the blinds, and by 4 or 5 in the small or big blind
    seat, where the function adds a blind nobody posted.
  - Over all 829 hands of that window, `ca_hand_facts.invested` summed over the seats equals the
    stored `pot_size` on 829 of 829; the function's money put in does so on 813 of 813 ordinary
    hands and 0 of 16 bomb pots.
- So the function misstates people's results in bomb pots (in that window it overstated them by
  85 chips, 42.5 bb). It belongs to another lane and is not changed here; the defect is reported
  in the pull request that made this change.
- `ca_hand_facts` is written by the `hand_history` insert trigger and keeps its rows: no
  retention job deletes from it (checked 2026-11-24; the hourly `prune-ca-hand-facts` job only
  blanks Horse hole cards, it reports `deleted: 0`), and corrections go through
  `ca_hand_fact_revisions`. For every person `hand_history` seats in a `has_human` hand there is a
  row: 12,461 of 12,461 person-hands of nlh, plo4, plo5 and plo6 cash in the 7 days to
  2026-11-23T15:31Z.

### The guard

The query also counts the person-hands `hand_history` has for the range (`expected`) and how many
of them `ca_hand_facts` holds (`found`). If `found` is lower, or the query output has no counts
(such as a file saved by the old report), the report prints no totals and no gate answer and exits 70. A truncated source can never produce a verdict again.

## What `net` means (verified)

Checked on 2026-11-24 for every person-hand of PLO5 cash between 2026-11-22T03:13:56Z and
2026-11-22T22:12:30Z (833 person-hands in 829 hands):

- `net = returned - invested` in 833 of 833.
- `returned` equals the amounts `hand_history.winners` awards that person in 833 of 833. Those
  awards are already net of rake (a 10.00 pot with 0.50 rake awards 9.50).
- `big_blind` and `players_dealt` equal the hand's `big_blind` and the number of players in
  `hand_history.players` in 833 of 833. Every seat of all 829 hands, Horses too, has a row, and the
  seats' `invested` adds up to the stored `pot_size` in 829 of 829.
- In the 7 days to 2026-11-23 there were 11,483 person-hands in 11,346 hands (checked 2026-11-23):
  none from a deleted account and none without a Horse dealt in.

So `net` is the per-hand net chips for that player, after rake, bomb-pot antes included. The
report groups hands by `hand_history.created_at` (`ca_hand_facts.played_at` is a different
instant and is not used).

## Luck

A person's hands in one sitting are not independent: the same person, the same opponents, the
same mood. Treating them as independent makes the result look far more certain than it is. The
standard error and the 95% interval of bb/100 are therefore computed by **clustering on
person-session**: one person, one game, cash or tournament, hands no more than 30 minutes apart. A
sitting never crosses a split instant.

With `G` sittings, `N` person-hands, mean `m` bb per hand, and each sitting's total `s_g` and size
`n_g`:

```
Var(m) = G / (G - 1) * sum over sittings of (s_g - m * n_g)^2 / N^2
SE of bb/100 = 100 * sqrt(Var(m))        95% interval = bb/100 +/- 1.96 * SE
```

"SD per hand" is the plain standard deviation of a person-hand in big blinds. With fewer than two
sittings there is no standard error and the report says `n/a`.

For two windows: difference = later bb/100 minus earlier bb/100, its SE is the root of the two
squared SEs, and `z` is the difference divided by that SE.

## The verdict rules (fixed)

Each comparison prints one line. The rules are applied in this order and are constants in
`person-vs-horse-results-lib.mjs`; a test pins them.

1. **too few hands to judge**: either window has fewer than 2,000 person-hands, or one person
   played more than 60% of either window's hands, or either window has fewer than two sittings.
2. **no measurable change**: `|z|` is below 2.
3. **people doing better than before** (`z` is 2 or more) or **people doing worse than before**
   (`z` is -2 or less).

## The gate

`--gate` prints the report and a last line, and exits:

| Exit | Meaning                                                                                                                                                       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Clean: every comparison is "no measurable change" or "people doing worse than before".                                                                        |
| 1    | People are measurably better than before a split, in at least one game. This wins over 2.                                                                     |
| 2    | Too few hands to judge in at least one comparison, or no hands at all.                                                                                        |
| 64   | A wrong argument. Not a gate answer.                                                                                                                          |
| 70   | The read failed (for example it ran past 60 seconds), or the result source holds fewer person-hands than `hand_history` has for the range. Not a gate answer. |

Name the games the switch governs with `--games`. With every game in the range, a small game makes
the answer 2.

## Read-only, and how it reads

- One `WITH ... SELECT` through `supabase db query --linked` on the linked project, the same route
  as the other read-only ops reports. It never reads `.env` or a database credential.
- The SELECT is sent behind two fixed settings: `SET TRANSACTION READ ONLY` (the database itself
  refuses a write) and `SET LOCAL statement_timeout = '60s'`.
- Always bounded by `hand_history.created_at >= since AND created_at < until`, through the
  `has_human` partial index, with the mode and games filtered on that same scan. Each seated
  person's result is then one primary-key probe into `ca_hand_facts` (a `LATERAL ... LIMIT 1`: as a
  plain join the planner hashes all of `ca_hand_facts`, over 100 million rows, and runs past the
  timeout). Everything is summed in SQL to one row per sitting.
- Measured 2026-11-24 on production for 7 days: nlh, plo4, plo5 and plo6 cash with `--by hour`
  in 2.5 s; every game, cash and tournaments, with `--by player` in 9.4 s.
- No name, full account id, hand id or card leaves the database. A person appears as the first
  four characters of the account id, and only with `--by player`.

## By option receipt (2026-11-25)

`--by-option-receipt <option>` answers: in the hands where this Horse option changed a decision,
did people do better or worse than in the hands where it did not? Same range, games and mode, same
counting. The two "windows" of the report are then groups of hands, not times: window 1 is the
hands with no receipt of that option, window 2 the hands with one. The clustered standard error
and the "too few hands to judge" rules are the ones above, unchanged. It cannot be combined with
`--split-at` or `--gate`.

A receipt is one row of `public.ca_horse_hand_receipts (hand_id, receipt, decisions)`, written by
the engine after the hand's own save, only for hands a person was dealt into: the option's name,
the kind of action before and after it acted (`cashDefenceTrimColdCalls:call>fold`) and how many
decisions of the hand. Never a card, a strength or an amount. Options that record one are listed
in `server/src/engine/HorseHandOptionReceipts.ts` (`holdemTournamentAllInCallIsPriced`,
`cashDefenceTrimColdCalls`).

Read it with these in mind:

- Receipts exist only for hands played after the feature shipped. An earlier hand counts as "did
  not fire", so start `--since` at or after that release.
- The option fires in particular spots (an overcall, an all-in call). Hands with a receipt differ
  from hands without one in more than the option, so a difference is not by itself its effect.
- A receipt says the option changed a Horse's decision in the hand, not that the person was in the
  pot with that Horse.
- The two groups can share a sitting, so they are less independent than two windows in time.
- Table hands and Lightning hands both record receipts; each is written after its own hand save.

## Limits

- Before and after is not a controlled experiment. Different people play on different days, and
  other changes land in the same games.
- The same person can be in both windows, so the two windows are not fully independent. The rule
  that one person may not exceed 60% of a window is the guard against one person's run deciding
  the answer.
- A switch acts only on the decisions it governs. Every other hand in the game dilutes it, so "no
  measurable change" and "too few hands to judge" are the usual honest answers on a few thousand
  hands.
- An account whose profile row no longer exists cannot be found by this read.
- A hand is read only if `hand_history.has_human` is set. On 2026-11-24 no person-hand in the
  ranges checked was in a hand without it; the guard cannot catch a hand that is missing that
  flag.
- Lightning tables are not separated from table play.

## Checked against production (2026-11-24)

PLO5 cash, `--since 2026-11-17T06:00:00Z --split-at 2026-11-22T03:13:56Z,2026-11-22T22:12:30Z,2026-11-23T15:31:00Z`,
read 2026-11-24T05:36Z:

| Window                            | Hands | Person-hands | People | Top person |   bb won | bb/100 | SE of bb/100 | 95% interval     |
| --------------------------------- | ----: | -----------: | -----: | ---------: | -------: | -----: | -----------: | ---------------- |
| Nov 17 06:00Z to 03:13:56Z Nov 22 | 6,049 |        6,211 |     11 |        64% |   +232.7 |   +3.7 |         97.3 | -186.9 to +194.4 |
| 03:13:56Z to 22:12:30Z Nov 22     |   829 |          833 |      2 |        85% | +2,007.6 | +241.0 |        195.0 | -141.2 to +623.2 |
| 22:12:30Z Nov 22 to 15:31Z Nov 23 |   256 |          256 |      2 |        93% | -2,143.9 | -837.5 |         35.6 | -907.2 to -767.7 |

The 2026-11-23 version of this section (read from `ca_hand_player_stat`) showed 2,056
person-hands before 03:13:56Z Nov 22: the cache had already dropped the older hands. The middle
window is now +2,007.6 bb, not +2,050.1: the 42.5 bb difference is the 16 bomb-pot antes (85 chips
at a big blind of 2) the old source missed. Every comparison is still "too few hands to judge".
