# 2026-11-01: decision on replacing eed06fe5 (owner delegated)

Dan, 2026-11-01 07:28 America/Chicago: "YOU DECIDE WHATS BEST, AND HOW TO RESOLVE
THE ISSUES." Measurements are in `2026-11-01-eed06fe5-replacement-deadlock.md`.

## The deadlock, in one line

Every cutover route needs eed06fe5's own certificate (`readyForRestart`, zero
unparked tables). eed06fe5 re-adopts, from `tournaments.status = 'RUNNING'`,
tables it can never finish: 90 closed-Diamond tournament tables and the stop
targets of operation d44c4440. Those hold `cards_in_air` (5 tables 17 minutes
after a restart, 97 after 67 minutes), so the certificate never opens. Only the
replacement can retire or settle them.

## Rejected, and why

- Admit `cards_in_air` to the certificate allow-list: /health gives counts, not
  table identities, so a live hand could not be told from a frozen one; a cutover
  could void a real hand. The certificate law stays as written.
- Raise the census allowance: a 45-60 s main-thread hold froze the 2026-10-31
  19:55 break for 1512 s; #8918 was closed for this.
- Mark the stopped or closed tournaments non-RUNNING so eed06fe5 skips them: a
  status write outside settlement, with chip and diamond custody attached.
- Fake lease ownership: it would sit inside the F06 manager-custody protocol.
- Hourly owner windows until a break lands just after a crash: a retry loop and
  a return of the retired hourly freeze.

## Decision: replace eed06fe5 at its next unplanned death

eed06fe5 dies on its own every 90-120 minutes, and the supervisor restores the
same sealed image from database state. Everything in memory is already lost at
that moment. Starting the reviewed candidate instead of eed06fe5 at that boundary
loses nothing a crash does not already lose, needs no break, no census and no
certificate, and the candidate (#9057) retires closed-Diamond tables quietly and
carries the stop-boundary route the 89 stopped events need.

Shape, for the release owner:

1. The transaction stages the candidate exactly as today (image, doors, tests)
   and writes a durable `crash-boundary` intent naming candidate SHA and image,
   bounded by an expiry (for example 24 hours), without touching the running
   engine.
2. `engine-supervisor.sh`, on an exit it did not cause, reads the intent: when it
   is present, unexpired and its image proves its source, it restores the
   candidate rather than the sealed predecessor; otherwise it restores the seal
   exactly as today.
3. The candidate is sealed only after the existing post-start proofs (exact
   identity locally and publicly, leader, natural committed hands). A failed
   proof rolls back to the predecessor seal through the existing rollback path.
4. A planned stop or a release in progress never consumes the intent.

This changes the seal and supervisor model, so it ships only with native tests
on the host (`engine-drill.yml`), never on reasoning alone (CLAUDE.md 10, rule 4).
