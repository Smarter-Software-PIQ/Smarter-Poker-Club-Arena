# Daily Live Rabbit Hunt Certification

`.github/workflows/rabbit-hunt-certification.yml` runs `scripts/ci/certify-rabbit-hunt.mjs` every day at 16:37 UTC and on demand. It certifies VIP previous-hand rabbit hunting (#9233) and its authority fixes (#9314) against production and the serving engine:

- Early-ended run-outs are saved with exactly the dealt-in set.
- The availability check answers saved, available until saved + 1 day, and never returns cards.
- A VIP buys a previous hand for 0 diamonds and gets one receipt.
- A non-VIP is refused before any charge.
- The bought hand reopens free.
- A player who was not dealt in gets the answer of a missing hand.
- The Hand History page buys a previous hand in a real browser.

It uses the supported certification route only:

- reserved accounts from `createProductionE2EAccount`;
- chips from a certification club's own opening grant, sent and claimed back by its owner, the club then retired;
- the audited, self-expiring certification VIP (#9338);
- #9303 browser device continuity, never clicking a device takeover.

Cleanup always runs, refuses while anyone is seated, and retires every fixture. Nothing is minted and no real account or table is touched.

**Engine gate.** While the serving engine does not carry #9233 and #9314, does not answer, or is in maintenance, the run ends UNKNOWN and creates nothing. UNKNOWN is neither a pass nor a failure. A failed case or an incomplete cleanup fails the job, with every case and cleanup step listed in the step summary.
