# tests/cash-locks-take-one-order.law.test.ts

Cash locks take one order: the stay-clock evaluation locks its players' session rows in player_id order (the Lightning trigger's order), both cash-out functions lock a cash table's row before its seat (parent before child, as they already do for a tournament game and a diamond table), every buyer locks its table right after its chair insert and before its wallet journal, and a seat exit never waits for a pending add-on that an open hand envelope owns (migrations 20261123024428 and 20261123024433, after the deadlocks of 2026-11-22).
