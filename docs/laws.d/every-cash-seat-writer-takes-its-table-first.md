# tests/every-cash-seat-writer-takes-its-table-first.law.test.ts

Every cash seat writer takes its table first: the Lightning owed-leave return, the Lightning rejoin, the system leave and the Lightning reversion lock their tables row before their seat (migration 20261123072823), and no later migration may define a function that locks a seat and then its table (explicitly, by UPDATE tables, through a leave_pending or is_sitting_out update, or through atomic_seat_cashout_locked) without a "-- @seat-before-table:" exemption naming why.
