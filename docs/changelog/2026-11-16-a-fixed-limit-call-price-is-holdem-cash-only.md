# The fixed-limit call price acts only at fixed-limit hold'em cash tables (opt-in, still off)

Fixed-Limit lane, 2026-11-16. `HorseDecideOpts.fixedLimitCallIsNotACommitment` (F2, #10930 and #11031) stays read only as `=== true` and stays registered default OFF in the live switch. This change narrows where it can act when it is turned on. With the option off, which is how every Horse plays today, nothing changes.

## Why

The lane owner's ruling on F2's evidence rows (agent evidence `fixed-limit-01Gw7aDr/AV-F2-EVIDENCE-ROWS.md`): two of the rows the code can fix were not met.

- Value: hold'em gained against the scripted maniac (flh six seats +9.34 +/- 4.10, nine seats +24.31 +/- 7.41 big bets per 100 hands, `AB-EVALUATION-2.md` 3.15), but Omaha hi-lo showed none on two seed ranges (flo8 six seats +1.07 +/- 3.46 in 3.15 and -7.09 +/- 4.28 in 3.7).
- Scope: no fixed-limit tournament case was evaluated for it, and no law covered one.

## The change

`HorseLogic.fixedLimitCallIsNotACommitmentInScope`: both of F2's read sites in `decidePostflop` (the call price with the action behind, and the commitment test) now need a fixed-limit hold'em decision (fixed-limit structure, two hole cards, a full deck, not Omaha: in production exactly flh) at a cash table (`isTournamentMode`, the test the W5 options use). At a flo8 table and at every tournament table the option decides exactly as off. No-limit and pot-limit are untouched (they never reached either site).

## Evidence

- Law `server/src/engine/AFixedLimitCallIsNotACommitment.law.test.ts`: with the option on, flo8 cash, flo8 tournament and flh tournament decisions (four and six seats, short and deep stacks) equal the option off with no F2 receipt; at flh cash the option still changes short-stack calls and its receipts fire. Removing the variant gate fails the flo8 cash case (14 decisions change); removing the cash gate fails the flh tournament case (6 decisions change). The structure-key law (`AFixedLimitFixKeysOnTheBettingStructure.law.test.ts`) now pins F2 engaging on two-card fixed-limit rules shown as nlh and staying off on the four-card fixed-limit state shown as plo4.
- League (v4b harness, seeds 1 to 300, every deal compared with origin/main): flh six and nine seats against the maniac and flh six against tight value-only play have identical deals, cards, action logs and nets; flo8 six against the maniac and the flh six tournament table now change 0 deals (17 and 7 on main).
- Recorded-hand replay and the eight evidence rows at this head: `docs/horse-default-on.d/fixedLimitCallIsNotACommitment.md`.
- The refused league matchup `flo8_call_is_not_a_commitment` now diverges in 0 of 300 pairs (11 before); `flh_call_is_not_a_commitment` is unchanged (6 of 300).

## Not changed

The price itself (`HorseFixedLimitCallPrice.ts`, measured raise-behind upper bounds), the receipts, the registry entry and its release default (OFF). No ON row is proposed.
