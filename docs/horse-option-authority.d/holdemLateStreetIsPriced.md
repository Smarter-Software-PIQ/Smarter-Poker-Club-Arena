# holdemLateStreetIsPriced: Authority For The Live Switch

Built 2026-11-24 by the plo-lead6 Hold'em late-street build (BUILD-II rounds 1-5). Evidence NOT MET: stays OFF. The option is registered, default off (read `=== true`), and carries the evidence listed below; every bar is NOT MET (replay 27 fixed / 128 newly wrong; exploit probes trail today against two of five scripted players; the league mirror loses to today's play at every table). This file does not authorize switching the option on.

## The Owner's Ruling It Enforces

- Owner 2026-11-24 12:30 / 12:35 AM CST: no unconditioned random play in Hold'em; the best play by math. A frequency is allowed only where the model itself asks for it, seeded and receipted.
- Owner 2026-11-15 12:52 / 12:53 (with holdemTurnRiverRaiseNeedsValue): on the turn and the river facing a bet, a hand that is not a value hand folds or at best calls.

## What It Does

No-Limit Hold'em cash and Lightning, turn and river, one to five opponents, one board, not a bomb pot or an all-in-or-fold table (tournaments only with holdemLateStreetIsPricedInTournaments, which stays off: see its own status below). It is the outermost answer of the wager_rules node (`server/src/engine/HorseHoldemLateStreetIsPriced.ts`, `holdemLateStreetIsPricedRule`), so no earlier blanket or random path overrules it in its spot; every replaced rule still runs and fires its receipt.

- Opening: every legal size (1/3, 1/2, 3/4, pot, 1.5 pot on the river, all in within 1.5 pots) is priced against check, jointly over the field, against each opponent's fold curve (his own record weighted n/(n + 30), the rest the fitted population curve trusted by sample size), blockers and nut advantage. Heads-up a range-level plan picks one size per node and a bluff set of the Horse's own range combinations (value = ahead of his calling part; bluffs = value x min(s/(1+s), his fold), ranked draw > air > weak made, then blockers); the boundary class takes a residual frequency through the one seeded, receipted draw (`holdemLateMixDraw`).
- Facing a bet: EV(call) against the bettor's line range split by his bluff share (his record where it has one, else the balanced s/(1+2s)); heads-up the Horse defends at least the strongest (1 - break-even) of its own range; a per-hand call or raise always stands.
- The Horse's own range (round 5): it starts from the Horse's own preflop policy (`HorseHoldemOwnPreflopRange.ts`: each preflop frame it acted on is rebuilt from the public record and the same HorseLogic.decide is asked, sandboxed, with all 169 classes; the band its opponents read is no longer used for itself) and is narrowed by this model's own plan at each of its earlier postflop actions, multiway checks and first wagers included.
- It reads only the Horse's own cards, the board, the public line and the opponents' public records. Nothing keys on whether a seat is a person or a Horse.

Receipts: `holdem_late_priced_*` (bet, check, call, fold, raise kept, record decided, range plan kinds, `holdem_late_priced_mix_bet` / `_mix_defend` for the residual draw). Laws: `HorseHoldemLateStreetIsPriced.law.test.ts`, `HorseHoldemOwnPreflopRange.law.test.ts` (docs/laws.d).

## What Was Measured

Evidence below is from BUILD-II rounds 4-5 (holdem-late-street/BUILD-II.md has every table and script). None of it
was measured against people at live tables.

- Self-play re-test (19,200 league cash + Lightning states per arm, played and replayed with the options; table in
  BUILD-II "Round 5 results"): every heads-up fold-to-first-wager row is within 5 points of break-even or below it
  except turn barrel <=1/3 (33.3% vs 24.0%, n 189) and river lead <=1/3 (36.4% vs 21.0%, n 33); production (OFF)
  over-folds 21 of 26 rows by more than 5 points (river barrel 2/3-pot 86.7% vs 46.7%). Bet then raised: flop 38.9 /
  turn 58.3 / river 45.2% folds against the raiser's break-even 60.6 / 62.3 / 61.7%.
- River bluff share by the chooser's own value test: <=1/3 14.8% (balanced 19.9), 1/3-2/3 34.9% (25.0), 2/3-pot 45.2%
  (31.5), overbet 43.6% (37.5).
- Exploit probes (heads-up 100 bb, 8,000 paired deals each, Horse bb/100 OFF -> ON, ON - OFF): any-two half-pot
  bettor +338.5 -> +431.6 (+93.2 +- 18.5); river bettor after a turn check +34.2 -> +55.4 (+21.2 +- 11.4); flop
  check-raiser +81.2 -> +50.6 (-30.6 +- 12.2); never-bluffer +27.9 -> +18.8 (-9.2 +- 8.8); any-pair caller +48.4 ->
  +3.3 (-45.1 +- 9.7). ON loses to none; it trails today's play against the check-raiser and the any-pair caller.
- League mirror ON vs OFF (same seeds): ON loses to today's play at every table: ON - OFF per seat, bb/100, every seat a Horse (hybrid cash
  profile), each deal played twice with the seats' configs swapped, one memory sandbox per pass (src/mirror.mjs; the
  repo's runMatchup never returned in this environment), two seeds pooled by inverse variance: 6-max -61.4 +- 6.4
  (12,500 deals), heads-up -88.7 +- 6.7 (38,000), full ring -51.3 +- 7.7 (6,500), 6-max big-blind ante (Lightning
  structure; the league has no Lightning domain) -52.0 +- 5.6 (12,500).
- Real-card replay (REPLAY-6 inputs, auditor D NLH cash, committed scorer; arm i + ii + flop vs the live rows): fixed 27,
  newly wrong 128 (people only 0 / 24). By exact equity against the opponents' actual hands, 53 of the 128 are wrong
  changes (27 value checked or called while ahead, 25 calls below the price, 1 fold above it) and 22 are right; 43
  have a person live (unjudged), 9 are bluffs. Bar fixed >= 2 x newly wrong: NOT MET.
- Cost: priming the Horse's own preflop range asks HorseLogic.decide 676 times per preflop frame on a line's first
  hand in a process (cached after); measured on 150 heads-up postflop NLH cash states (niced, machine under load): options off p50 0.9 / p95 1.9 ms;
  on with the line cached p50 6.9 / p95 11.9 ms (max 15.5); on, first hand on a preflop line in the process, p50 74 /
  p95 230 ms (max 288).

## Replay

- Replay: fixed 27; newlyWrong 128; changed 427; unchanged 2307; unjudged 266; set HVH48 auditor D NLH cash (REPLAY-6); scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 2734 of 3891
- Replay: fixed 0; newlyWrong 24; changed 53; unchanged 198; unjudged 29; set HVH48 auditor D NLH cash (REPLAY-6) (people only); scorer 5302af2ab3e; source placed verdict-only; arm on vs off; replayed 251 of 251

Rows printed by the committed scorer (scorer field: the scorer's own commit), copied unedited. Replayed on build 828520dbee07 with arm on = holdemTurnRiverRaiseNeedsValue + holdemLateStreetIsPriced + holdemFlopIsPriced (on3 adds holdemLateStreetBluffRaiseIsPriced) over the live switch rows; the options act together, so the same rows stand for each of them. Newly-wrong nodes judged one by one: holdem-late-street/realcard/NEWLY-WRONG.md.

## How To Trial It

Not ready for a live trial: the replay bar is not met (fixed 27 against newly wrong 128) and the exploit probes show
the chooser trailing today's play against a check-raiser and an any-pair caller. When those are repaired, the smallest
safe trial on this repo's machinery is the option switch's `shadow` state, which DOES take Hold'em options (the
earlier note that shadow is PLO-only is about the PLO4/PLO5 shadow STAGE, HorseOptionShadowStage.ts, with its 50 ms
budget and latency breaker; the generic option shadow, HorseOptionShadow.ts, re-decides any registered non-style
option that optionSwitchShadowRefusal accepts, and these options are release-default off, not off-only). A `shadow`
row acts exactly as off and re-decides one decision in a budgeted few per worker minute with the option flipped,
journaling `optionShadowReceipt` (changed / same, person dealt and live). Its risk is latency: the generic shadow
re-decides before the decision is sent whenever the acted decision took under 15 ms, and it has no latency breaker;
a cold re-decision (first hand on a preflop line in a worker) costs p50 74 / p95 230 ms and a warm one p50 7 / p95 12 ms
(150 states), so a `shadow` row could hold a decision up to about 0.3 s per worker for each new preflop line until the
cache warms (512 lines). Before a shadow row: warm the cache at worker start (warmOmahaDecidePaths.ts has the pattern),
or admit these options to the shadow STAGE with a Hold'em scope, its after-send timing and its latency breaker. There is no Hold'em table-type scope setting (omahaOptionGameScope is PLO4/PLO5 only), so the next
step after shadow would be `on_shadow` on all NLH cash, not a single table type; the smallest code change that would
allow one table type is a Hold'em twin of omahaOptionGameScope (not built).
