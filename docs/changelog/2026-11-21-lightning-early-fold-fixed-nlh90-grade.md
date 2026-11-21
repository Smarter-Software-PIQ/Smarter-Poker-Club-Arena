# 2026-11-21: lightningEarlyFoldNeedsFoldThrough fixed-code NLH90 evaluation graded (not harmful, no gain, stays OFF)

## Summary

Graded the declared single-process 90-cell NLH paired Lightning evaluation (`efnft2`, seed `41987143`, `198,000` paired hands, `DECLARATION-EFNFT2-NLH90.md` sha256 `2e64b99c362145b681251cd6e8b1ab6f258cd25353e4e70b301b7d848a79f9b0`, digest `76d3c3fada7ec6dbfee78c3ff4fc86b0808ee481de5583d49bf96fea8fc42baf`) on the `#11623` fixed code (`8f854361a0`, unraised-limp refusal plus one-roll stream replay).

- Primary (`P1`: `all_horse + unknown`, `39,600` hands): `-1.2 +/- 0.8 bb/100` (`z = -1.46`, not `<= -2.0`).
- Guards `G1`, `G2`, `G3`, `G4` (p95 `1.030`, p99 `1.072`), `G5`, `G6`, `G7`, and `G9` all hold (`0` illegal/throws/fallbacks/unsettled; `27,746` divergent decisions).
- Limp shape improved substantially vs the pre-fix run: `Q3` bottom-quartile entry share rise dropped from `+1.082` pts to `+0.043` pts (`9.903% -> 9.946%`), and `Q4` intended share rose from `45.1%` to `63.74%` (`firstInLimp +0.010`, `overLimp 0.000`, `coldCall +0.143`).
- Verdict: not shown harmful (no off-only lock needed), no gain shown, `Evidence NOT MET` kept, option stays OFF.

## Files

- `docs/horse-option-authority.d/lightningEarlyFoldNeedsFoldThrough.md`
