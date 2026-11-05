# 2026-11-05 - Break screen and XMTT detail show the guarantee as the floor

Follow-up to 2026-11-04-guarantee-overlay-shrinks-live. With no chips added at start, the tournament break screen and the XMTT detail page printed the raw pool, which reads below the guarantee during late registration. Both now use effectivePrizePool (max of pool and the place guarantee). Pinned in tests/a-guarantee-moves-no-chips-before-close.law.test.ts.
