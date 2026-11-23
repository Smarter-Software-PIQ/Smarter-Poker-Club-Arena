# tests/a-sit-out-takes-its-table-before-its-seat.law.test.ts

A sit-out or a departure takes its table before its seat. fn_cash_seat_sitout and fn_request_seat_departure locked the player's seat and then, through the zz_note_human_seat_seen trigger their seat UPDATE fires, the table row, while a tournament hand's continuation journal (fn_ca_f06_share_table_lane) takes the table row and then the seats, so the two deadlocked. Migration 20261123024034 makes both take the table row FOR NO KEY UPDATE, the mode the trigger's write needs, before the seat, the order every hand lane uses.
