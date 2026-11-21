# The evaluation league pays the low half of a hi-lo pot

2026-11-21, subagent of the Antigravity Coordinator (Claude session_01Gw7aDtgw51ks82iZdeEMVr).

## The defect

`server/src/benchmark/HorseLeague.ts`, `playHand`, settled every showdown with one score per seat:
`scoreOmahaHi` for Omaha, `scoreHoldem` otherwise, and paid each side-pot layer to the best of them. It
never looked at `vi.isHiLo`, so a PLO8 pot with a qualifying low went whole to the high hand. Every PLO8
league card therefore measured a high-only game. Found by a coordinator agent of session 01UxDLnH, who
re-settled 24,000 league hands high-only and matched the league on every one.

## The fix

The settlement is now its own function, `settleLeagueShowdown`. For a hi-lo variant (`isHiLoVariant`: plo8,
flo8) it builds the same contribution layers as before into the engine's `Pot[]` and pays them with
`PokerEngine.determineWinners`, the function `HandController.completeHand` pays every real pot with: the
engine's Omaha high and eight-or-better low evaluators, half of each pot to the best qualifying low with the
odd unit to the high half, ties within a half split with the odd unit clockwise of the button (quartering
falls out of that), and a scoop when no hand qualifies low. The unit is the cent: the league deals at BB = 2
chips, where the tournament whole-chip unit would be half a big blind. Every other variant keeps the
league's exact-fraction high settlement byte for byte, so no non-hi-lo card moves.

Fixed-limit Omaha hi-lo is still refused by the league: its showdown now pays the low half, but its betting
is still the league's no-limit street loop. The refusal text and `docs/horse-league-fixed-limit.md` say so.

## Test

`server/src/benchmark/HorseLeagueHiLoSettlement.test.ts`: a qualifying low is paid half, as the engine pays
it; with no qualifying low the high hand scoops; a tied low with a short all-in side pot and an odd cent
(each button seat) matches the engine; a folded contributor is paid nothing; a high-only variant is
unchanged; and dealt plo8 league hands (`playHand`, heads-up) split to zero net where the engine splits the
pot and scoop where it does. Four of the six cases fail with the hi-lo branch removed.

## Re-measured: plo8_mtt_hu_omaha_hilo_tournament_first_in_12bb

Same seeds and size as the recorded runs (6,000 pairs each, fixed before running), single-card runner:

| seed     | high-only league (recorded) | with hi-lo settlement | z    |
| -------- | --------------------------- | --------------------- | ---- |
| 20261120 | +36.54 +/- 4.92             | +32.36 +/- 4.17       | 7.75 |
| 20261121 | +35.80 +/- 4.90             | +29.44 +/- 4.10       | 7.18 |
| 20261122 | +38.92 +/- 4.93             | +33.78 +/- 4.12       | 8.19 |

Still significant on all three seeds. `docs/horse-option-authority.d/omahaHiLoTournamentFirstIn.md` records
both sets; its status stays Evidence NOT MET (no audited gain and no recorded activation order).

## Other PLO8 league figures

The other docs that cite a PLO8 figure from this league now carry a line saying it came from the high-only
league and needs re-measurement: `docs/changelog/2026-09-05-daily-horse-audit-2026-09-04.md`
(`plo8_hilo_layer`), `docs/changelog/2026-10-16-horses-read-each-opponent.md` (`plo8_v23_lowdraw`),
`docs/changelog/2026-11-14-plo8-heads-up-tournament-first-in.md`,
`docs/changelog/2026-11-20-plo8-first-in-three-league-seeds.md`,
`docs/changelog/2026-11-20-plo8-first-in-authority-and-lightning-paired-runs.md`, and
`docs/horse-option-authority.d/omahaMultiwayIsPricedInTournaments.md` (its plo8 card is declared, not run).
They were not re-run here. The Phase 11 to 13 strength leagues settle on the real HandController and are not
affected.
