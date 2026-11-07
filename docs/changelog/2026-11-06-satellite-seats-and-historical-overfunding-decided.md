# Satellite Seat Guarantees And Historical Guarantee Overfunding: Decided

Two questions left open by the 2026-11-05 guarantee and Free Buy audit, decided under CLAUDE.md 10.9 (agents decide money with a clear, read path), from production reads on 2026-11-07 01:55 UTC.

## Historical overfunding: absorbed by the house, nothing taken back

Recounted independently with production's `fn_ca_guarantee_funding` over every completed guaranteed chip event (not satellite, not spin) that started from 2026-10-01 to the gross rule (2026-11-05 22:25:02 UTC): **166 events received 10,575.55 chips** of house funding above H = max(0, G - C); **73 events / 6,745.40 chips** since 2026-10-20. That matches the #9591 manifest to the cent. Every one of those events is completed and paid out. CLAUDE.md 10.9 rule 3 decides it: overpay caused by our defect "is absorbed by the house, reported, and left alone". No correction moves chips; the manifest and this note are the record. The root cause (the net rule) is fixed by 20261105222502 and watched by `fn_ca_free_buy_funding_watch` (0 findings since).

The same pass lists 696 completed guaranteed events with chip funding below H (nominally 5,637,990). Every one is a **Diamond Arena** event (2026-10-07 to 10-30) that settled through its own diamond escrow, which the chip ledger does not see: zero chip coverage, prize pools 9,814,669 against 5,637,990 guaranteed. No chip event is underfunded. The Diamond Arena is retired.

## Satellites: a seat guarantee stays funded against prize money

`fn_ca_fund_overlay_on_lock` still funds a satellite's guaranteed seats when it starts, at target buy-in + fee per seat, against the prize pool. Read over the last 7 days: 71 completed satellites, 11 funded at start, and **all 11 had the excess returned at finalization** (`fn_ca_return_excess_start_overlay_locked`). Net house funding was 13 chips, exactly max(0, seat value - (player payments - rake)). So the start funding is a reservation trued up after the windows close, and the timing rule holds in effect.

The gross rule is not applied to seats on purpose. A satellite promises seats, and seats are paid out of prize money. If rake counted toward the seat value (the gross rule would have funded 5, not 13), the house would keep the rake while the prize money fell 8 chips short of the seats promised. A seat guarantee is therefore H = max(0, seat value - prize contributions), funded at start and trued up at close. Buy-in guarantees (regular, bounty, PKO, Mystery, guaranteed Free Buys) keep the gross rule.
