# A provisional place 2 moves aside for the final-two close, and the two missed own heads are paid (2026-11-07)

## What broke, read from rows

Owner rule 2026-11-05: a bounty-only PKO (Free Buy) ends with two players
left, and both keep the bounty on their own head. The engine close (#9620,
hardened by #9686) and the DB authority (`fn_ca_bounty_only_pko_final_two`,
migration `20261106010426`) were live in the serving engine `92e26a9f` — and
the rule was still missed twice:

1. **Midnight Free Buy (NLH) `c1b3fa5a`, 2026-11-07 09:20 UTC.** Places
   stamped at bust are PROVISIONAL (the elimination ladder runs low while
   late registration grows the field; the terminal finish re-ranks by bust
   time). SLCCamille, true 4th, held a provisional **place 2** from her
   09:15:03 bust. When the field reached two, the close tried to stamp the
   real runner-up at place 2, `trg_tournament_place_collision` refused
   (rightly — a contested place is paid twice), the bounded retries
   exhausted after 8 tries in 74s, the close recorded its refusal and the
   event played on heads up. The winner took both final heads. **Uncle Zoe
   (`9b918b56`), 2nd, lost his own head of 6.98.**
2. **Midday Free Buy (NLH) `b3ae52ef`, 2026-11-06 21:19 UTC.** The field
   reached two at 21:19:07; the hand already in flight busted the runner-up
   at 21:19:52 before the close could claim the parked field (breach
   `closed_without_final_two`, alert `49b95c40`). **priya (`86468a23`), 2nd,
   lost her own head of 26.40.**

## The fixes, at the cause

- **`20261107134243_a_provisional_place_two_moves_aside_for_the_final_two_close`** —
  replaces `fn_ca_bounty_only_pko_final_two` in place: before the runner-up
  is stamped at place 2, any OTHER row holding a provisional place 2 is moved
  to the lowest free place at 3 or above (the engine's own exhausted-ladder
  semantics; the terminal finish re-ranks by bust time regardless). The
  relocation is recorded in the receipt. Pinned by
  `tests/a-bounty-only-pko-ends-with-two-players.law.test.ts` and proven on
  native PostgreSQL under the real collision trigger in
  `scripts/ci/test-bounty-only-pko-final-two.py` (new contested-place
  scenario). This is DB-only: it is effective for the next Free Buy as soon
  as it is applied, with no engine activation needed.
- **Engine deal gate (separate PR)** — once a bounty-only PKO's live field is
  at two, no further hand is dealt; the close owns the end of the event. This
  closes the Midday-class race and activates with the next certified engine
  release.

## The damage, settled

**`20261107134252_the_house_pays_uncle_zoe_and_priya_the_final_two_heads_the_c`** —
the house (Midway union bank) pays Uncle Zoe 6.98 and priya 26.40, their own
heads at their final busts (`tournament_bounty_obligations`, asserted in the
migration). Same audited door as the Danimal make-good (`20261106213809`):
manual adjustment under 10.9 + union bank debit + idempotent credit + one
ledger leg each + conservation asserted. The winners keep what the old path
paid them — the overpay was our defect and is never clawed back (10.9 rule 3).
The standing critical alerts for `b3ae52ef` are resolved with the settlement;
the watch keeps running and now expects to find nothing.
