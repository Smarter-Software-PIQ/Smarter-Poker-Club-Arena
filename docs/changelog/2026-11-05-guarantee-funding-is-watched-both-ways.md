# Guarantee Funding Is Watched Both Ways, And A Bounty-Only PKO Pays No Places

Owner rules, 2026-11-05.

## A Bounty-Only PKO Pays No Places

Dan: "PKO FREE ROLL ONLY PAYS YOU FOR THE PLAYERS YOU ELIMINATE, AND THE LAST
MAN STANDING KEEPS THE BOUNTY ON THEIR HEAD. 50% GOES INTO THE PLAYERS WALLET.
50% GOES ON THE PLAYERS HEAD. 0 PLACES PAID FOR FINISHING IN THE TOP 15%."

Production already settles it that way: the 2026-11-05 12:30 PM Midday PKO
Free Buy (39b5fa14) paid 0 to places and all 323 in bounties; the 4:30 PM
Afternoon event (74ba8130) holds 0 in place prizes. The screens did not: the
Rewards tab showed "36 Paid Places", a money bubble and a percentage ladder,
and the lobby panel showed the same ladder. `isBountyOnlyPko` (a PKO whose
entry is free, with no guarantee and no place prize money) makes
`resolvePayoutStructure` return no places, and both screens say
"0 Places Paid. Bounties Only". Paid PKOs keep their ladder.

## Guarantee Funding

20261105222502 made the close-out and every settlement guard fund
H = max(0, G - C) from the event's own ledger. Verified on the live events at
17:40 CT: gross coverage equals places + bounties + rake on every guaranteed
event read (for example Happy Hour Bounty 152 + 190 + 38 = 380 against 500,
H 120; Union Grand Championship 1,380 + 690 + 230 = 2,300 against 2,500, H 200;
satellite-seated entries included). Migration 20261105233808 closes what was
left outside it:

- `fn_ca_backpay_guarantee_shortfalls` topped completed events up to the full
  guarantee in prizes and bounties paid, ignoring rake, and service_role could
  still run it. Its last grant is removed; nothing calls it.
- `fn_tournament_guarantee_check` reported an event as short when places plus
  bounties paid were below G; it now adds the players' rake.
- `ca_guarantee_funding_variances` (scan every 15 minutes) records any
  finalized guaranteed event whose posted house funding is above or below H.

Native proof: `scripts/ci/test-guarantee-funding-watch.py`.
