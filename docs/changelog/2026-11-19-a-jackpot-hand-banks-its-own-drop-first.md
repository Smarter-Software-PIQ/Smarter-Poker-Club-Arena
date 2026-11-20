# A jackpot hand banks its own drop first (incident efde14dc)

**Alert:** processBBJPayout.exhausted, CRITICAL, 2026-11-19 21:52:43 CST. Mini jackpot, Midway Union, table c5c742e5, hand 60218398.

**Money:** paid in full ($425.00, bbj_payouts bb94a4e5) by the reconciler at 21:54:13, 90 seconds after the hit. Nothing was lost.

**Root cause.** 20261118071736 moved BBJ drop banking out of the hand's post-commit envelope (it stores the drop in hand_bank_obligation_pending; fn_ca_bank_pending_hand_obligations banks it from the projection continuation) so cash hands stop queueing on the union pool lock. The payout resolves its pool only from the hand's bbj_contributions receipt, which that banking writes. It runs moments after the envelope, so the receipt was not there yet (claim 03:52:43.022Z, receipt 03:52:43.228Z). "No confirmed payout destination" is not in the retry pattern, so one attempt was made and the alert said four. This was the first jackpot hit since the change; every hit would have paged the same way.

**Fix.** processBBJPayout (Main and Mini, engine and reconciler) now banks the hand's own stored drop through the same idempotent, never-waiting fn_ca_bank_pending_hand_obligations, then pays from the receipt's pool. It still never substitutes the club's current pool. A pool briefly held by another banker is a retryable `bbj_drop_banking_pending`. A drop still banking after every attempt, with the claim on disk, is a deferral like the maintenance freeze (the reconciler banks and pays it; a stuck banking pages through fn_post_commit_stranded_watchdog). Without a durable claim it still pages. The alert now reports the attempts actually made.

**Law:** server/src/services/supabase/aJackpotHandBanksItsOwnDropFirst.law.test.ts.
