# V31 R8: the density pre-flight can be limited to eligible cells

R8 keeps R7's per-context board recipe: 57 training boards per cell (three global folds
of 19 distinct rank signatures) and 8 holdout candidates whose rank signatures lie in the
reserved holdout set. Many texture classes cannot supply that many boards (a flop texture
such as `Atpd` has only 8 rank sets in all), so a cell plan chosen by density alone can
contain cells the solver capture cannot build.

`gtoV31DensityPreflight.ts` now takes `--eligible=<file> --eligible-sha256=<hex>` (both or
neither). The file lists `eligible: [{street, texture_class}]`; the proposal only picks cells
whose street and texture are listed (`gtoV31EligibleCellFilter` in
`benchmark/GtoV31DensityPreflight.ts`, which refuses a malformed or duplicate list). Demand
recording, scoring and the all-cells ceiling are unchanged, and without the option nothing
changes. The report records the file path and checksum under `scope.eligibleCells`.

Test: the filter keeps only listed street/texture cells, the unfiltered proposal is
unchanged, and malformed files are refused.
