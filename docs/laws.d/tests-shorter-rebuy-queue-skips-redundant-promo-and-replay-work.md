# tests/shorter-rebuy-queue-skips-redundant-promo-and-replay-work.law.test.ts

Guards that completed immutable rebuy/add-on receipt replays return before R(id) and that event-bound Free Buy rebuys without wallet principal skip redundant promo settles and fee-history scans (20261119175942).
