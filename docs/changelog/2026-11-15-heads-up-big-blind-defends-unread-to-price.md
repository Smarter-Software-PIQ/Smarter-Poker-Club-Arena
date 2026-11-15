# 2026-11-15 The heads-up big blind defends to its price against an unread opener (HU-NLH-001d, default OFF)

Heads-up lane, round 2 (builder bbdef). New default-OFF option `huBbDefendsUnreadToPrice`.

## The defect

Heads-up, the Horse's big blind folds about 58.7% to every open at 15-50bb when it has no read on the opener
(heads-up audit, MEASUREMENTS P4). Against a player who min-raises every button that is about a 16-19 bb/100 leak
until a read engages. The earlier option `huBbDefendsToPrice` was not supported by its declared evaluation
(HU-NLH-001c: human field at 25-40bb +0.53 +/- 0.46 bb/100). The diagnosis (evidence folder, round2/bbdef/DIAGNOSIS.md):

- the over-fold is a no-read defect. With a read the live brain already adapts (fold 2.2% against a read min-raiser),
  and the old option only second-guessed that adaptation; its cells measured 25,000-hand sessions with reads on;
- its 0.8 realisation is a range average, while the hands it adds are the bottom of the defending range. The Horse
  mirror priced them at about 0.7;
- at 80bb nothing was gained, and V85 already widens there.

## The rule

`HorseHuBbDefence.ts` (HU_BB_UNREAD_REALIZATION 0.7, HU_BB_UNREAD_MAX_STACK_BB 50), `HorseLogic.ts` (huBbUnreadPrice),
`HorsePreflop.ts` (the call branch, receipt `hu_bb_defends_unread_to_price`).

Heads-up no-limit hold'em, exactly two dealt in, the big blind facing the only open (no limp, no caller, opener not all
in, open above 1.05bb and at most 6bb), 20-50bb effective, the opener with NO engaged RFI/PFR read: a fold becomes a call
when the class's all-in equity against the V70 heads-up reference open width (72% cash, 76% with an ante), times 0.7,
covers the rake-aware pot odds. Cash, and a tournament only when its trusted context says exactly two players are left
in the event and it is not a satellite: the payout is then linear in chips, as the V23 endgame already treats it.
Production heads-up NLH with people in the last 14 days was 2,062 tournament hands (1,953 of them two-max SNGs) against
103 cash hands. Widen-only and call-only. An engaged read, more than 50bb, three or more dealt, a larger field, a
satellite, a missing or untrusted tournament context, Omaha, short deck, pot and fixed limit, straddles, bomb pots and
all-in-or-fold tables keep today's answer. The receipt counts only a call that is still the final decision.

## Evidence

Declared evaluation DECLARATION-HU-NLH-001d.md, results RESULTS-HU-NLH-001d.md (evidence folder
hu-audit-01UxDLnM/round2/bbdef). Development evidence only: scripted personas, a six-max-fitted calibrated profile,
Horse mirrors, empty solver stores.

## Pins

- `server/src/engine/HorseHeadsUpBigBlindDefendsUnreadToPrice.law.test.ts` (docs/laws.d entry): default off and explicit
  false identical to unset; only fold to call; the price decides; 20-50bb only; tournament only with two left, trusted and
  not a satellite; stands aside on an engaged read; out-of-scope tables; receipts equal changed final decisions; the brain
  reads the option once, as `=== true`.
- Ledger flag and receipt in `HorseDataLedger.ts`; league card `human_hu_bb_defends_unread_vs_minraise_40bb`
  (memoryLearning 'off') in `HorseLeague.ts`.

The option stays default OFF. Enabling it is a separate owner decision.
