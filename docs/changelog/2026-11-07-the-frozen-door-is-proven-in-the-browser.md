# 2026-11-07 - The Frozen Door Is Proven In The Browser

Dan, 19:45 Chicago, item 5 of the follow-up to the 13:20 Lightning refusals: prove the freeze behaviour on the live client regularly.

A real freeze would refuse real players, so production is never frozen for a test. `tests/e2e/production-freeze-entry-door.spec.ts` loads the published client with the isolated post-deploy account and fakes only what the client reads about a freeze: the entry guard (`fn_entry_purchases_frozen`), the break state (`fn_maintenance_break_state`, 47 s remaining), the rejoin door's `PLATFORM_FROZEN` refusal (answered in the browser, never sent on), and the engine's maintenance presentation (idle, as at 13:20:17 when the engine was back but the database still closed entry). Everything else is the real site, and any admission or buy-in RPC reaching the network fails the case.

It proves, on the deployed bundle:

- at 1440px, a Lightning board row's door reads "Opens In m:ss", is disabled, and offers no Join Lightning; the banner says "Tables Are Back. New Seats Open In m:ss" and never "Maintenance Complete";
- at 393px, the game panel's door is the same countdown and cannot be tapped;
- with entry open, a panel offers an enabled Join Lightning; when the freeze begins as it is tapped, the Lightning page shows "Seats Reopen In About N Seconds.", never "Could Not Open", and its own door counts down.

It runs in the existing post-deploy client browser job, beside the Lightning lobby join check, on the same isolated account and release bracket; no new schedule. Law test: `tests/the-frozen-door-is-proven-in-the-browser.law.test.ts`.
