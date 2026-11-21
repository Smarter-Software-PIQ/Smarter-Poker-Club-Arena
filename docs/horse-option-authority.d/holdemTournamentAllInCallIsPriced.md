# holdemTournamentAllInCallIsPriced: authority for the live switch

Owner order of 2026-11-17 11:49 America/Chicago (no blanket rules; every Horse decision priced by range, equity and EV; bet size never triggers a decision by itself). Built by the Horse Decisions lane (builder E-FIX, lead session_01TLQer7JfrrxcELJZV5XHPD) on 2026-11-19 from audit E (1,522 NLH tournament hands with humans, 10,937 Horse decisions). Switchable, default OFF. It changes preflop calling ranges, as committedStackPricedIn and nashPushFoldIcm do, so it was first registered under the owner preflop range hold; that hold was lifted for this option only (see "Owner authority" below). Evidence NOT MET: no league, and the replay of 2026-11-20 (see Replay below) did not pass its declared bar. **Do not switch on until its evidence rows are met.**

## Owner authority

Dan's exact message of 2026-11-19 18:42 America/Chicago:

> nope, you need to investigate every single hand played against humans in the past 48 hours and trace back and investigate every single horse decision on every single street before you claim everything is operating perfectly because i've seen a shit ton of mistakes that need correcting!

On that order the HORSE DECISIONS lead (session_01TLQer7JfrrxcELJZV5XHPD) lifted the owner preflop range hold for this option: audit E, run under that order, found that the fixed All-In-Or-Fold strength bar this option replaces is a blanket rule. The option is not in OPTION_SWITCH_OFF_ONLY (server/src/engine/HorseOptionSwitch.ts, comment beside the preflop hold entries); it stays default OFF and is switched on only through its evidence (league card and replay), like every option.

## What it does

Two-card no-limit hold'em tournament hands only (one board, no straddle, no bomb pot; Omaha, short deck, pot and fixed limit, cash tables unchanged). Default OFF, read `=== true`. Code: server/src/engine/HorseHoldemTournamentAllInCall.ts (the price, the ranges, the equity) and HorseLogic (the four sites below).

1. Preflop, in the reference (decidePreflopV7Glue, before the Nash caller table and the All-In-Or-Fold strength bar): every all-in call decision (facing an all-in, or a call that is the Horse's whole stack) at an effective 25 big blinds or less, or by a committed stack (half or more of the chips it started the hand with already in) at any depth, All-In-Or-Fold or not, any seat, a lone jam, a jam over the Horse's own open, a re-jam, a multiway all-in, a jam with flat callers, is answered call when its margin is above zero, else fold.
   - Ranges: an open-jam reads the Nash V2 jam table (players behind, depth, dead ante); a jam over one raise the top 18% at 8bb to 6% at 25bb (linear); over two or more raises 5% to 3.5% (12bb to 25bb); a raise that is not all in the open width by players behind (SB 40%, BTN 44%, CO 30%, 24, 20, 17, 15, 13%), a 3-bet 8% (14% six-handed or less), a 4-bet 4%; a caller of an open-jam the Nash first-caller range for his seat kind capped at 25%, of a re-jam the top half of the re-jam range. Widths are taken in the Nash caller table's own order.
   - Players still to act behind the Horse are priced as overcallers: each with the top half of the range he would call the jam with; the call is the mixture of nobody waking up and the widest one behind overcalling (his extra chips, capped by the Horse's call, added to the pot).
   - Equity: seeded Monte Carlo (3,000 deals heads-up, 2,400 multiway), exact card removal, scored by HorseEval.scoreHoldem; the seed is a hash of the public spot and the cards; no shared generator is consumed.
   - Price: EV(call) - EV(fold) = sum of p x (equity x W - BF x (1 - equity) x C); W the contestable pot (dead money, side pots capped at the Horse's stack, the Horse's own chips in), C the call, BF the Horse's bubble factor where a pay jump is live (HorseLogic.payJumpBubbleFactor; 1 in a PKO, a mystery bounty, a bounty-only event, with no pay jump or no context). Margin = EV / (W + BF x C) = equity minus required equity when nobody is behind.
2. The end of the reference: a later layer of the reference may not turn the preflop priced answer around (receipt holdem_tournament_all_in_call_reference_kept_seen). Postflop the price is taken here, with the equity the engine already computed for the decision (Phase 7 equity evidence of decidePostflop's own pass), only facing an opponent's all-in (a jam) where the call closes the action: a fold more than 5 equity points above the price becomes a call (any positive margin for a committed stack), a call more than 5 points below it a fold.
   - Postflop scope (review N3, 2026-11-19): the postflop half is restricted to all-in calls facing a jam; the river-bet part and the whole-stack call of a bet that is not all in were dropped. The Phase 7 equity is taken against each opponent's preflop band, with no conditioning on his postflop line; against a jam that band is the closest proxy the engine has, but against a river bet the bettor's line range is much stronger, and pricing it there pushed river folds toward calls (the reverse of audit E's "river calls too light").
3. Phase 7 (tournament utility arbiter): its choice is refused (tournamentUtilityRefusal `priced_all_in_call`) when it would turn the priced call or fold around and the margin is beyond 5 equity points (HOLDEM_TOURNAMENT_ALL_IN_LOCK_MARGIN), or beyond 0 for a committed call.
4. Phase 8: the same refusal (ledger reason `priced_all_in_call`, applied false).

A raise is never made or removed: only the call and the fold. Off (absent or false): no line of it runs, no verdict is written, no generator is touched (law test: the same decision and generator state for absent and false on every fixture).

## Why one new option

aofClosingSeatNashCall answers one seat (the All-In-Or-Fold closing seat at 12bb or less) by a Nash call probability drawn from the shared generator; committedStackPricedIn rescues one Phase 6 branch (multiway all-in) by strength floors and leaves the arbiter free to fold after it, and is off-only under the preflop hold. Extending either would keep a second decision path beside the price and their own receipts would no longer say what they decided. One priced rule over every spot is the root fix; both options are left as they were (with this option on, the priced block answers before either is reached, so neither reads these spots).

## Receipts

holdem_tournament_all_in_call_priced_call_seen, holdem_tournament_all_in_call_priced_fold_seen, holdem_tournament_all_in_call_unpriced_seen, holdem_tournament_all_in_call_reference_kept_seen, holdem_tournament_all_in_call_arbiter_reversal_refused_seen, holdem_tournament_all_in_call_phase8_reversal_refused_seen, holdem_tournament_committed_stack_call_seen, holdem_tournament_postflop_all_in_call_priced_seen, holdem_tournament_postflop_call_priced_fold_seen (HorseDataLedger.ts, tag TourneyAllInPriced). The verdict of the last decision (equity, required equity, bubble factor, EV, margin, call, pot, committed) is readable through HorseLogic.holdemAllInCallVerdictOfLastDecision.

## Tests

server/src/engine/AHoldemTournamentAllInCallIsPriced.law.test.ts (fixtures AHoldemTournamentAllInCallIsPriced.cases.ts, builder AHoldemTournamentAllInCallIsPriced.fixtures.ts): the price arithmetic (bubble factor, overcall mixture); the seeded equity with card removal; the Nash ranges and widths; the roles; the audit preflop fixtures da2d1f44 (88, 15bb re-jam over its open), 95b1c217 (AJs, 13bb), 1b51e45d (55, 16bb), d325481d (66 committed, 0.81bb into about 64bb), fbfdfc4a (A7s All-In-Or-Fold big blind) fold on every seed with the option absent or false and call with it; 475e2de7 and 09bdb97c (All-In-Or-Fold) call with it; 72o facing the same re-jam folds; the ten anonymised production All-In-Or-Fold requests fold without it and follow their price with it (nine all in, K3o still folds); postflop the fb6eb2ec spot with QdJd: a fold the engine's own equity prices more than 5 points above the price is called; the lock (5 points, any margin committed, never a raise); option off byte-identical (absent and false, decisions and generator state).

## Audit fixtures and what changes

- da2d1f44, 95b1c217, 1b51e45d, d325481d, fbfdfc4a: fold -> call (priced margins about +0.12, +0.13, +0.03, +0.22 committed, +0.11).
- 0f7c778b (TsKh turn, all-in): unchanged. The price check runs, but the engine's own equity for this spot is about 0.25 against a price of 0.34 (the audit's model: 0.65).
- 2b5b823c (QQ river on AA board, a 12.5bb river bet, not all in): out of scope since review N3 (no verdict; the decision is the option-off decision). With the river-bet part the engine's band equity was about 0.65 against 0.27 (the audit's model: 0.10), which is why the river-bet part was dropped. The decision follows the engine's equity; the error is in the postflop equity model (the bands and reads of a jam after a 3-bet pot lead, and of a river bet after two check-calls on a paired ace board), not in a missing price check. Not fixed here.
- fb6eb2ec (Kd7d flop) and 7a7125e8 (Qc5c heads-up flop): the rebuilt requests are already called by the engine; priced calls with the option on.

## Evidence rows

- Mechanism, scope, visibility (receipts), tests: MET.
- Option unset or false: byte-identical (law test above).
- Value: NOT MET. No league and no counterfactual replay has been run.

League card (HorseLeague.ts, declared, not run): mtt6_holdem_tournament_all_in_call_is_priced_12bb (six-handed big-blind-ante MTT at 12bb with the live M state; arm A adds the option).

## Limits

- Ranges are population and Nash models, not reads of the opponent; the re-jam, 3-bet and caller widths are stated constants.
- Side pots are priced as one pot: the Horse must beat every opponent in the pot to win W; a side pot it could win against one of them alone is not credited (a call is priced slightly too tight in multiway pots with unequal stacks).
- Bounty value is not added to the call.
- The overcall model prices only the widest player behind waking up, not two.
- Postflop it uses the engine's equity as it stands, and only facing a jam (see 0f7c778b and 2b5b823c above).

## Replay

Machine-read (README.md, "The Replay row"); a run row is written by the scorer and copied unedited.

- Replay: fixed 87; newlyWrong 81; changed 367; unchanged 4989; unjudged 178; set HVH48 E Hold'em tournaments 10,937; scorer c4ab864f30f; source placed verdict-only; arm on vs off; replayed 5356 of 10937

Run 2026-11-20 by helper REPLAY-6 of the HORSE DECISIONS lane (session_01UxDLnMCzicBiaB19fA18T5). Criteria, inputs and pass bar were declared before the run: `agent-evidence/extreme-archive/horse-decisions-01UxDLnM/replay6/DECLARATION.md`, sha256 1ed85e274dd4b6fdff42c7f7b551b224c94290c770424cc2bbdc64f8e1383fbf; the scorer's reports are beside it (`runs/`, `REPORT.md`). Method: the HVH48 audit's decisions placed at their node (`server/scripts/hvh48-audit-nodes.py`; bad = severity CLEAR or LIKELY, ok = priced and not flagged, DEBATABLE and unpriced unjudged; a fix is a change to the action the audit names), each re-decided on origin/main 95dae3848e5 by `server/scripts/audited-node-option-replay.ts` (the recorded public snapshot, the Horse's own cards, the live hybrid profile, seeds 1, 7, 42, opponent memory off), arm off = the 63 production switch rows read 2026-11-20 21:12Z, the other arm = those rows plus this option; scored with `--placed`. Set E (Hold'em tournaments): 5,356 of 10,937 audited decisions replayed (the Horse's own cards known); the off arm reproduces the recorded action on 4,381 (81.8%); 367 changed (264 more aggressive, 103 more passive), 87 fixed, 81 newly wrong, 21 still wrong, 178 unjudged; illegal 0, refused 0, errors 0. Most frequent opponent (a person live at 28 of the changed decisions) removed: 339 changed, 84 fixed, 66 newly wrong. Against the declared bar (at least 20 changed, fixed at least twice newly wrong and at least 8, no illegal or refused action, base fidelity at least 70%, and the same ratio with the most frequent opponent removed): **FAIL: 367 changed, 87 fixed, 81 newly wrong, 21 still wrong.** Only the 5,356 audited decisions with the Horse's own cards could be replayed. Every change is preflop; 226 are folds made calls (85 of them at decisions the audit judged bad, 87 at decisions it priced and did not flag). Limits: opponent memory is off and seats are anonymised, so nothing that reads a per-opponent record acts; the tree is origin/main, not the serving build; the base arm is today's switch set, not the audit days'; the judge is the audit's verdict (no EV is claimed), and a change of a decision the audit priced and did not flag is counted newly wrong whether or not the audit would also accept the new action.
