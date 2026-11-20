# tests/reporting-functions-resolve-must-move-receipts.law.test.ts

Every unpinned reporting function that resolves cash funding club from `cash_participant_funding_receipts` (`operation_kind = 'buyin'`) must also resolve moved cash seats from `cash_seat_move_receipts` (`to_table_id`, `player_id`, `created_at`, `club_id`) and preserve `SECURITY DEFINER` and exact execute ACLs, backed by `cash_seat_move_receipts_player_dest_at_idx`.
