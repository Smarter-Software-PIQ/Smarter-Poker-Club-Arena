# tests/the-final-two-watch-sees-a-close-that-gave-up.law.test.ts

`fn_ca_bounty_only_final_two_watch` exempts an event only for a genuine rule refusal: a refusal recorded because the close ran out of retries ("gave up after N tries") is the miss itself and raises `closed_without_final_two`. A miss whose runner-up already holds the exact make-good leg (`bounty-only-final-two-make-good:<event>:<place-2 user>`, read by key, never by prefix) is settled and not re-raised.
