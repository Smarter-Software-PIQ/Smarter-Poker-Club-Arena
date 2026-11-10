# Family 284 activation hold: the qualified bytes stay still until they ship

Held-out family 284 (riverPositionDefense, run 42910542259) qualified at
3ddb7d901: +177.2 bb/100 over 48,384 pairs, interval trusted, every seed and
critical cell clear. Activation re-hashes all 338 decision-closure files and
`server/package-lock.json` in the released image, and five of them moved on
main after the qualified commit (#10346 and #10324), so no release could carry
the selection.

This change is temporary and scoped to those bound bytes:

- Reverts #10324 and #10346 as whole commits (no migration in either). Both
  re-land byte-identical once the activating release is verified live.
- Activates the decision-closure freeze (`closure-freeze.json`, 339 files,
  equal to the qualified plan's pins and dependency digest).
  `HorseDecisionClosureFreeze.test.ts` holds any pull request that changes a
  frozen file; anything else merges as usual. No repository-wide freeze.
- Lifted with `write-closure-freeze.mjs --lift` after the certified release
  carrying the reviewed selection is serving and verified.
