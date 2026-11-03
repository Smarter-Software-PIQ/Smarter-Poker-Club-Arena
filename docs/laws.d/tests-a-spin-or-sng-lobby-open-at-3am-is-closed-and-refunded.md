# tests/a-spin-or-sng-lobby-open-at-3am-is-closed-and-refunded.law.test.ts

From 3:00 to 6:00 AM Chicago the engine asks every minute for each open, unstarted, not-full Spin or Sit & Go lobby to be cancelled through atomic_cancel_tournament, which refunds buy-in and fee and writes the receipt; a full game is left to deal, a drawn Spin is never cancelled, only service_role may run it, and a database watchdog pages if any lobby is still open in the 4:00 hour.
