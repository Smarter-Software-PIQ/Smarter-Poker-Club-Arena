# 2026-11-08 The horse pair hydrate seeks on a total order

## What was wrong

`hydrateHorsePairsFromDb` (server/src/services/HorseMindPersistence.ts) runs in
every horse decision worker at boot, and /health waits on all eight workers. It
read up to 20 pages of 1,000 rows from `horse_mind_pairs` (956,373 rows) with
`.range(offset)` ordered by `opps desc, attacker_id`.

- That order is not total: production's top 20,000 held 2,161 tie groups, so a
  tie group that straddled a page boundary could be skipped or read twice.
- OFFSET re-reads and discards every earlier page; measured page mean 223 ms,
  max 2.48 s over 50,458 calls, up to 160 queries per boot (8 workers x 20).

## What changed

- The order is now total: `opps DESC, attacker_id ASC, victim_id ASC` (the
  last two are the primary key).
- Paging is keyset: each page asks for rows strictly after the previous page's
  last row (`horsePairSeekFilter`), beside a plain `opps <= cursor` bound so the
  existing `horse_mind_pairs_opps_idx` seeks and incremental sort orders the
  tie group. EXPLAIN ANALYZE at depth 10,000 on production: 17 ms, 1,211 index
  rows read (versus 11,211 rows for the OFFSET shape).
- Same cap (20,000), same page size (1,000), same top-N-by-opps selection, same
  import path and same fail-safe. No horse decision logic or treatment changed.

No migration: the existing opps index plus incremental sort serves the seek.

## Next step (not done here)

The eight workers still each run this read. Sharing one read across workers is
the larger follow-up that removes the remaining 8x boot cost.

## Tests

`server/src/services/HorseMindPersistence.pairs.test.ts`: the pager returns
every row of a tied-boundary fixture exactly once in total order, stops at the
cap, and the query uses the total order with a keyset seek and no OFFSET.
