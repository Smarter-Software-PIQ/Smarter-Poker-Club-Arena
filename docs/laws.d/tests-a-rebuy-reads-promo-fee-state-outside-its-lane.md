# tests/a-rebuy-reads-promo-fee-state-outside-its-lane.law.test.ts

A rebuy brings an open-grant holder's hourly promo fee snapshot current before it takes its event's rebuy key, so a fee-history recomputation never runs while another purchase of the event waits.
