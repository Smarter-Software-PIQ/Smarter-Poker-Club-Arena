# Every tournament counts in the week it starts (2026-11-14)

Dan, 2026-11-14: "ANY TOURNAMENT, SPIN, SIT N GO OR SATELLITE GAME THAT STARTS BEFORE THE CUT OFF MUST BE INCLUDED IN THE WEEK IT STARTED IN ... MAKE SURE THATS THE CASE MOVING FORWARD."

## What the platform did

Each weekly money calculation counted a tournament in the week it **finished**:

- A fee is recognized and banked to the union at terminal time.
- Rakeback, agent commission, the union fee, ECO and the union statements all select fees by that instant.
- The union P&L carried an event still running at the cutoff at its entries less returns, so its result landed in the week it ended.

Satellite tickets still in escrow at a cutoff were not held anywhere. A satellite's ticket prize therefore landed in whatever week the ticket was used. At the Nov 9 cutoff that was 2,205.00: Deep Stack 900.00, Felt 1,305.00.

Measured:

- 309 of 84,434 recognized tournaments in the last 14 days straddled a cutoff.
- At the Nov 9 cutoff (Mon 2:00 AM Central), 82 Midway events were running, and 80 of them finished by the 4:00 AM payout.

## The rule from now on

An event belongs to the week containing `GREATEST(started_at, 2026-11-16 08:00Z)`. Events that started before Mon Nov 16 2:00 AM Central were already deferred into the Nov 16 week under the old rule, and they stay there. No closed week changes, and nothing is counted twice or dropped.

`20261114192824_tournaments_count_in_the_week_they_start.sql`:

- **Attribution.** A side table holds one row per earned fee source of an event recognized in a later week than it started. Its instant is the last microsecond of the start week. The payable earning sources view pays from that instant. The union earned plan, the scope processor, week clubs, the tournament week quality proof, the club weekly summary and the union rake basis select by it. Bank time never moves: every bank reconciliation stays on the instant the fee really landed in the union wallet.
- **The gate.** A week's books are not prepared until every event that started in it is terminal and its fee recognized:
  - This covers the payout run, job 272, the union-books job, the cascade, the prep shards and the round-window advance.
  - Only the waiting scope waits. The payout run books every other scope from payout time plus 45 minutes.
  - From payout time plus one hour, one warning alert names the events still running.
  - Weeks ending on or before Nov 16 never wait.
- **Union P&L, from the Nov 23 cutoff.**
  - An event that started before the cutoff is held at exactly what changes hands after it: credits, refunds, and awarded seats and tickets, minus entries and admissions, late registrations included.
  - Every satellite ticket in escrow at the cutoff is held for the club that funded the entry that won it.
  - One-time effect: the Nov 16-23 week picks up every ticket in escrow at Nov 23. Measured as if it were today: Deep Stack 31 tickets (5,150.00) and Felt 35 tickets (5,780.00) of player result, or 515.00 and 578.00 less ECO owed.
- **Bank conservation.** The earned-plan fallback and the weekly union close conserve the bank. Commission accruals carry the attributed instant. An event whose start week has already closed is not attributed backwards.

## Install

The migration has no effect until the first fee recognized on or after Nov 23 08:00Z for an event that started earlier. The side table stays empty until then, and every reader returns exactly today's rows (proved read-only with self-aborting pg_temp probes). It installs after the Monday Nov 16 payout has closed, so nothing touches that run.

Pinned by `tests/every-tournament-counts-in-the-week-it-starts.law.test.ts`.
