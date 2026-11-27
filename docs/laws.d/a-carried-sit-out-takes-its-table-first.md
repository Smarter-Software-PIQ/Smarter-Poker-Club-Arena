# server/src/engine/aCarriedSitOutTakesItsTableFirst.law.test.ts

A carried sit-out takes its table first. adoptTournamentMovePresence wrote a moved player's sit-out with a direct table_seats PATCH, which locked the chair and then, through zz_note_human_seat_seen, the tables row, the reverse of the f06 table lane, and deadlocked with fn_ca_f06_share_table_lane on 2026-11-26. It now persists through fn_cash_seat_sitout (SeatSitOutPersistence), which takes the table first; no engine code may PATCH a chair's is_sitting_out or leave_pending directly.
