# tests/every-seat-mover-preserves-table-custody.law.test.ts

Every cash cross-table seat-mover or table-transfer SQL function in supabase/migrations/ must either delegate to fn_cash_seat_move_execute or directly invoke both fn_ca_promo_follow_seat_move and fn_poker_diamond_move_custody, keep internal pre-gate move/swap helpers revoked while preserving time banks, sit-out state, funding club and cash_player_session, keep fn_move_tournament_player as the sole tournament seat-mover preserving time banks and sit-out state, and keep pending add-on settlement on ended cash seats.
