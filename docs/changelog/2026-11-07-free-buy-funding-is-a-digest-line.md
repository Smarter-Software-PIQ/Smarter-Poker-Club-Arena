# Free Buy and guarantee funding is a digest line, and an early prize promo is watched

2026-11-07. Migration `20261107041909`.

## What the owner asked

"Fully build, fix and enhance all of these and make sure they are fully wired
in and tested before claiming success." Two of the items: a daily digest line
for guarantee and Free Buy funding accuracy, and removing the start-up
exceptions once the last legacy event settles.

## What shipped

`fn_sp_digest_free_buy_funding(day)` (service_role, read-only) reports every
guaranteed event and every Midway Free Buy that started on the Central day:
required H against what was posted, the promo part (Midway Union Promo
Wallet), the house part (union bank or club treasury) and the players' own
coverage C, each event exact, over, under or pending. It adds that gaming
day's Free Buy tickets (redeemed, returned, players, players who used all
five) and every open watch finding. The World Hub digest loads it beside
`fn_sp_digest_spins_spend` and prints it as its own card.

Read against production for 2026-11-06 before shipping: 36 events, 30 exact,
6 pending, none over or under; the five Free Buys were exact (Midnight PKO
170 = 170, Morning 250 G with C 351 needing nothing, Midday PKO 164 = 164,
Afternoon 500 G with C 117 and promo 383, Prime Time mystery 174 = 174);
477 tickets were redeemed by 400 players. The query takes 0.45 s.

`fn_ca_free_buy_funding_watch` gains `early_prize_promo` (critical): a Midway
sign-up head with a prize part after the cutoff went live (2026-11-06
21:06:19 UTC; the last such head is 21:05:26), or cutoff funding on an event
that is not finalized. The findings table's kind check is widened to admit
it. The migration asserts it starts with nothing to report.

## The start-up handling is kept, on purpose

`fn_ca_fund_free_buy_at_cutoff_locked` nets legacy prize parts from V and
counts a legacy funded head as a first entry. That is exact accounting, not
an exception: for every event registered after the cutoff went live both
terms are zero, and the new watch kind proves no head with a prize part can
appear again. Removing the netting would only remove what keeps a stray head
from being paid twice. The watch's rollout constants age out of its 14-day
window on their own.

## Proof

`scripts/ci/test-guarantee-funding-watch.py` (native PostgreSQL): the watch
rebuilt from the merged migrations is byte-identical to production
(`44fc0264...`); the exact migration installs; a late prize head and an early
cutoff leg are found as critical; a bounty-only head and a pre-cutoff legacy
head are not; finalizing the event closes its finding and leaves V = 2 exact;
the digest line reads exact/over/under/pending with promo, house and player
parts apart, the tickets and the open findings; players cannot read it; no
ledger row is written; a second install is refused.
