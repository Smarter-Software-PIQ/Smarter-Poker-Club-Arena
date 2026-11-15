# tests/a-lightning-bank-the-win-reading-reads-only-the-session.law.test.ts

The newest fn_lightning_bank_the_win_reading finds a Horse's last hand only inside its open Lightning pool session (cluster, epoch, formed since entry, newest first), never by joining the Horse's whole lightning_hand_player history: that read ran 8.6 s on production and failed 20 to 330 times an hour on 2026-11-14, so a Horse at its bank-the-win line could not leave. Behaviour on real PostgreSQL: tests/unit/lightningBankTheWinReadingSession.pg.test.ts.
