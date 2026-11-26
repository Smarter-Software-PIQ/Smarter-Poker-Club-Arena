# The Daily Horse Audit Stops Raising False Alarms (2026-11-26)

Scripts and tests only (`scripts/ops`, `tests/unit`, `docs/ops`). Nothing under `server/` or `supabase/`. Read-only
tools; no engine decision changes.

The 13:33Z daily audit of 2026-11-26 raised three flags. The root-cause work replayed them and found no engine
change behind any of them: two were the audit's own statistics and one was a hand an overlapping run had already
listed.

## What Was Wrong And What Changed

1. **NLH audit, "leak node worse than the window before"** (small blind facing a jam, tournaments: 76.3% folds of
   160 against 60.8% of 204, z 3.13). The comparison day was the low one of four (73.3%, 69.7%, 60.8%, 76.3%); 47
   nodes were tested at z >= 2; and 30% of the flagged day's spots came from one all-in-or-fold event, where this
   node folds 84% on every day. Now: the comparison is against the three earlier windows pooled
   (`--compare-windows`), the z bar is corrected for the number of nodes compared (47 nodes: 3.30), and
   all-in-or-fold events have their own nodes. On the same counts: z 2.21 against a bar of 3.30, no flag. A real
   change (150 of 160) still flags.
2. **Exploit report, "large theoretical jump at a build boundary"** (PLO4 turn, facing a lead: 74% folds of 50
   against 48.7% of 228; all 790 decisions of the cell re-decided identically on both builds). The gate read a
   pooled "all sizes" cell, at exactly the minimum n, with hundreds of comparisons at |z| >= 3. Now: a roll-up cell
   is judged with sizes and lines held fixed, the bar is corrected for the comparisons the report made (418: 4.5),
   and at a build boundary the output says a cross-build replay is required before the finding is called a build
   regression. On the saved output of that run: mix-adjusted z 3.12 against 4.51, not gated.
3. **PLO audit, owner-rule check "non-nut raise turn/river"** asked for the exact nuts while the engine keeps a
   raise by its nut class (a top full house stays nut class when only quads beat it, by decision). Now the audit
   uses a port of the engine's test, held to the engine by a test on 400 seeded holdings, and counts "nut class but
   not the exact nuts" apart. An all-in over an opponent who is already all in is graded as the call it is (it was
   listed as a 75 bb "raise without price").
4. **Daily runner**: a breach hand or a finding the run before already listed is marked
   `repeat (already reported <folder>)` and does not count toward exit 1 (findings only when the two ranges overlap).

## Limits

- The NLH audit now reads four windows instead of two (about twice the read time). The earlier windows are only
  counted, never graded, and the price model is unchanged.
- The cross-build replay is stated, not run: it needs a checkout of each build.
- The corrected bars make both gates slower to fire on small real changes; a change of 15 points on a few hundred
  decisions still passes them.
