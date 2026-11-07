# Seats and Diamond guarantees keep their own credit (2026-11-07)

Follow-up to `20261107183629`. That migration credited the whole player
payment (places + bounties + rake) against max(guarantee, seat value) in the
readiness read and the bank-short notice. That is right for the buy-in
guarantee and wrong for two things it also covered:

- A satellite's guaranteed seats are bought from places only
  (`fn_ca_fund_overlay_on_lock` funds seat value - places), so readiness could
  understate what the bank must cover and pass a start the lock then found
  short.
- A Diamond event keeps its recorded place-based guarantee
  (`20261007000010`); subtracting rake understated the earmark it needs.

Migration `20261107204028` measures each on its own credit: chip overlay =
max(guarantee - (places + bounties + rake), seats - places, 0); Diamond =
max(max(guarantee, seats) - places, 0); both exposure sums take the same split.
Proven in a rolled-back production probe over all 296 open tournaments: 0 rows
differ from that rule, and every chip event without seats still equals
`fn_ca_guarantee_funding(id).house_required`.
