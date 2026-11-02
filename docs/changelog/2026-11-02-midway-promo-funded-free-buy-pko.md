# Midway Free Buys use promo-funded one-chip PKO heads

Owner direction November 2: every Midway Free Buy has free initial entry funded
by Midway's promo wallet, a one-chip initial progressive bounty, one-chip paid
rebuys, no add-ons and no rake. All value belongs to bounties; knockout awards
use the existing half-wallet/half-head split and the champion receives their
remaining head. There are no finishing-place chip prizes.

The owner explicitly included the three upcoming events that already had 412
registrations at inspection. Running events retain their existing terms. The
conversion locks each eligible event and its roster, requires unplayed and
unfunded legacy entries, and moves one promo chip per registration into bounty
escrow with a unique journal key. Ordinary registered-contract changes remain
refused. A failed conversion rolls back the format and every funding leg.

Human and horse registration use the same promo custody helper in their
existing transaction. Unplayed withdrawal/cancellation returns that promo head
to the sponsor. Rebuy payment, immutable refund entitlements and independent
escrow reconstruction use the same zero-fee split. The scheduler and both row
creators persist the new format; other unions and Diamond Arena retain theirs.

The internal ranking ladder remains present for lifecycle compatibility, with
zero finishing-place prize balance. Player-facing description states the
bounty-only rules. No settled results, player awards or active events are
rewritten, and this change creates no admission hold or repair job.

Validation and delivery status are recorded in the owning task checkpoint;
source or passing local tests alone do not establish production installation.

## Installation guard correction

The first eligible production install rolled back because the new private promo
writer had not been declared in `ca_money_rpc_registry`. The uninstalled
migration now registers both private money owners before creating them, without
adding execution privileges. The native financial rehearsal installs the actual
production DDL guard, proves the omitted declarations fail, then proves the
complete conversion and cancellation with the declarations present. Both psql
and the pinned Node PostgreSQL client pass. No production funds moved during
the refused attempt.
