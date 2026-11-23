# People vs Horses results

One question, answered the same way every time: **are real people winning or losing against the
Horses, per game, and is the difference bigger than luck?**

`scripts/ops/person-vs-horse-results.mjs` is a read-only report. Run it before any Horse rule is
switched on or off, and again after, with the switch instant as `--split-at`. It changes nothing.

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
```

| Option                                      | Meaning                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `--since <ISO>` `--until <ISO>`             | The range. Default: the last 7 days. At most 92 days. Instants need a zone (`...Z`).                  |
| `--games plo4,plo5,...`                     | Games to read. Default: all.                                                                          |
| `--mode cash\|tournament\|all`              | Cash tables, tournaments, or both. They are always reported apart.                                    |
| `--split-at <ISO>[,<ISO>...]`               | Cut the range into windows at these instants and compare each window with the one before it. Up to 8. |
| `--by day\|hour\|player\|stake\|table-size` | Add a breakdown under each game. Days and hours are UTC.                                              |
| `--json`                                    | The same report as JSON.                                                                              |
| `--gate`                                    | Exit code for a runbook, see below. Needs `--split-at`.                                               |
| `--sql`                                     | Print the query and stop.                                                                             |
| `--from-json <file>`                        | Build the report from saved query output.                                                             |

## What is counted

- One row of `ca_hand_player_stat` per person per hand, called a **person-hand**.
- **People** are accounts whose `profiles.is_horse` is not true.
- Accounts whose profile `status` is `deleted` are left out. This is the only deleted or test
  marker the `profiles` table has (checked 2026-11-23: `status` is `active` or `deleted`; there is
  no test, demo or internal column). The report prints how many person-hands this left out.
- Only hands where **at least one Horse was dealt in** (fewer people in the hand than
  `n_players`). A hand with people only says nothing about the Horses. The report prints how many
  person-hands this left out.
- The result of a person-hand is `profit / big_blind`: net chips for the hand, after rake, in big
  blinds. People's results in a hand are added up, so chips that only moved between two people
  cancel and what is left is people against Horses, less the rake the people paid.

Tournament results are in tournament chips, not money. They are reported under their own heading
and are never mixed with cash.

## What `profit` means (verified)

Checked on 2026-11-23 against `hand_history` for every person-hand of PLO5 cash between
2026-11-22T03:13:56Z and 2026-11-22T22:12:30Z (833 person-hands in 829 hands):

- `profit = won_amt - my_blind - invested_actions` in 833 of 833.
- `won_amt` equals the amounts `hand_history.winners` awards that person in 833 of 833. Those
  awards are already net of rake (a 10.00 pot with 0.50 rake awards 9.50).
- `n_players` equals the number of players in `hand_history.players` in 833 of 833, and the row's
  `created_at` equals the hand's.
- Every person in `hand_history.players` has a stat row (833 of 833). Horses do not always have
  one, so a hand's rows do not add up to minus the rake and the Horse side is not read from this
  table.
- Independent check: `hand_history.players[].stack` is the stack after the hand. For a person's
  next hand at the same table, the change in that stack equals `profit` in 768 of 829 pairs. The
  other 61 were not traced one by one; adding chips between hands and leaving and rejoining a table
  would both produce them.
- In the 7 days to 2026-11-23 there were 11,483 person-hands in 11,346 hands: none from a deleted
  account, none without a Horse dealt in, and no stat row without a profile.

So `profit` is the per-hand net chips for that player, after rake. It is zero-sum with the other
players of the hand apart from rake.

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

| Exit | Meaning                                                                                   |
| ---- | ----------------------------------------------------------------------------------------- |
| 0    | Clean: every comparison is "no measurable change" or "people doing worse than before".    |
| 1    | People are measurably better than before a split, in at least one game. This wins over 2. |
| 2    | Too few hands to judge in at least one comparison, or no hands at all.                    |
| 64   | A wrong argument. Not a gate answer.                                                      |
| 70   | The read failed (for example it ran past 60 seconds). Not a gate answer.                  |

Name the games the switch governs with `--games`. With every game in the range, a small game makes
the answer 2.

## Read-only, and how it reads

- One `WITH ... SELECT` through `supabase db query --linked` on the linked project, the same route
  as the other read-only ops reports. It never reads `.env` or a database credential.
- The SELECT is sent behind two fixed settings: `SET TRANSACTION READ ONLY` (the database itself
  refuses a write) and `SET LOCAL statement_timeout = '60s'`.
- Always bounded by `created_at >= since AND created_at < until`. The table is read once per
  person through its `(user_id, created_at)` index and summed in SQL to one row per sitting.
- No name, full account id, hand id or card leaves the database. A person appears as the first
  four characters of the account id, and only with `--by player`.

## Limits

- Before and after is not a controlled experiment. Different people play on different days, and
  other changes land in the same games.
- The same person can be in both windows, so the two windows are not fully independent. The rule
  that one person may not exceed 60% of a window is the guard against one person's run deciding
  the answer.
- A switch acts only on the decisions it governs. Every other hand in the game dilutes it, so "no
  measurable change" and "too few hands to judge" are the usual honest answers on a few thousand
  hands.
- An account whose profile row no longer exists cannot be found by this read. There was none in
  the 7 days checked.
- Lightning tables are not separated from table play.

## Checked against production (2026-11-23)

PLO5 cash, `--split-at 2026-11-22T03:13:56Z,2026-11-22T22:12:30Z`, range 2026-11-16T07:10Z to
2026-11-23T07:10Z:

| Window                        | Hands | Person-hands | People | Top person |   bb won | bb/100 | SE of bb/100 | 95% interval     |
| ----------------------------- | ----: | -----------: | -----: | ---------: | -------: | -----: | -----------: | ---------------- |
| before 03:13:56Z Nov 22       | 1,930 |        2,056 |     12 |        47% |    +82.4 |   +4.0 |        147.4 | -284.9 to +292.9 |
| 03:13:56Z to 22:12:30Z Nov 22 |   829 |          833 |      2 |        85% | +2,050.1 | +246.1 |        196.4 | -138.8 to +631.0 |
| after 22:12:30Z Nov 22        |   239 |          239 |      1 |       100% | -2,032.9 | -850.6 |          n/a | n/a              |

The middle window matches the figure known beforehand (people about +2,050 bb over about 829
hands). Both comparisons are "too few hands to judge": +2,050 bb sounds large, but its interval
runs from -139 to +631 bb/100 and one person played 85% of the hands.
