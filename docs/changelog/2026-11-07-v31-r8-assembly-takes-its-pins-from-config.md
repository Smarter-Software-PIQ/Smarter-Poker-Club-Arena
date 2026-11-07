# V31 R8: the public215 assembly tools take their pins from the request

The two public215 planning tools (`server/scripts/prepare-public215-feature-request.py`
and `server/scripts/assemble-public215-input-draft.py`) had R7 written into them:
the producer commit, the R6 baseline manifest, the source-partition and M2-selection
digests, the 107-context / 57-board / 6,099-target / 2,147-candidate census, the R7
source namespace and inventory contract, the `r7f.` scenario-id prefix and the
`public215-r7` draft name. Every new dataset therefore needed a pin PR to these files
before its draft could be produced (R7 itself needed CA #8814).

Now each tool reads those pins from the config it already reads:

- A **v1** config (`..._v1` format, the exact key set R7 used) is the R7 request and
  is still bound to exactly the R7 values. Nothing about R7 changed.
- A **v2** config adds a `pins` object that states every one of those values. A v2
  request refuses R7's namespace, partition, selection, inventory contract, `r7f`
  prefix and draft name, so a new evaluation set cannot silently reuse R7's.

One real defect was fixed on the way: when two approved range files are
byte-identical (R7 has several), the feature request recorded whichever path a
Python set happened to yield, so two runs could write different request bytes. The
paths are now visited in sorted order. The bytes (and checksums) were always equal.

## Proof that R7 is reproduced

Both tools were re-run against R7's own configs (only folder prefixes remapped,
because the R7 Hub/CA checkouts and the R6 folder have since moved), into a scratch
folder:

- Draft manifest `drafts/public215-r7.DRAFT.json`: `9b1ca681…` - identical to R7's.
  161 of 162 output files are byte-identical; the receipt differs only in
  `assembler_sha256` and `config_sha256`.
- Feature request: `public-target-plan.json` `f8321a1d…`, `public-context-metadata.json`
  `b5c3f934…` and all 107 templates byte-identical; `public-feature-request.json`
  equal after the folder remap (range entries compared by checksum, see above); two
  runs under different `PYTHONHASHSEED` values now write identical bytes.

The encoder source graph pins `prepare-public215-feature-request.py`, so the R8
encoder lock is minted from the commit that contains this change (R7's lock pins
R7's bytes and is unaffected). The suites now also run in the public215 workflow.
