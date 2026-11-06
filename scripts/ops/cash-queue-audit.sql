-- Explicit read-only audit; never scheduled and never repairs a queue.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
-- All current cash games, including waiting tables and Lightning pools.
SELECT g.id,g.name,g.variant,g.cluster_mode,g.enabled,g.state,
 (SELECT count(*) FROM cash_game_waitlist w WHERE w.game_id=g.id AND w.status='waiting') waiting,
 (SELECT count(*) FROM tables t WHERE t.cluster_id=g.id AND t.lifecycle IN ('live','opening') AND NOT coalesce(t.is_deleted,false)) tables,
 (SELECT coalesce(sum(fn_cash_game_open_seats(t.id)),0) FROM tables t WHERE t.cluster_id=g.id
    AND t.lifecycle IN ('live','opening') AND t.status IN ('waiting','running','active') AND NOT coalesce(t.is_deleted,false)) unreserved_seats
FROM cash_games g WHERE g.closed_at IS NULL ORDER BY waiting DESC,g.id;
-- Explain each queue entry using existing server eligibility authorities.
SELECT w.game_id,w.user_id,w.status,w.created_at,
 w.created_at>now()-interval '24 hours' AS within_entry_ttl,
 bool_or(fn_ca_cash_wallet_covers(w.user_id,t.id,NULL,fn_ca_cash_entry_need(w.user_id,t.id))) FILTER (WHERE t.id IS NOT NULL) AS can_fund_a_table,
 min(fn_ca_cash_entry_need(w.user_id,t.id)) FILTER (WHERE t.id IS NOT NULL) AS minimum_entry,
 max(fn_cash_game_open_seats(t.id)) AS available_at_a_table
FROM cash_game_waitlist w LEFT JOIN tables t ON t.cluster_id=w.game_id
 AND t.lifecycle IN ('live','opening') AND t.status IN ('waiting','running','active') AND NOT coalesce(t.is_deleted,false)
WHERE w.status IN ('waiting','notified') GROUP BY w.id ORDER BY w.created_at;
-- Correlation only: the latest recorded stack exit is not proof it caused an offer.
SELECT h.table_id,h.id AS offer_id,h.created_at,h.notified_at,h.hold_expires_at,h.status,
 extract(epoch FROM h.notified_at-h.created_at)*1000 AS queue_to_reservation_ms,
 extract(epoch FROM h.notified_at-x.occurred_at)*1000 AS latest_recorded_exit_to_reservation_ms
FROM table_waitlist h LEFT JOIN LATERAL (
 SELECT occurred_at FROM ca_seat_stack_exits x WHERE x.table_id=h.table_id
   AND x.occurred_at<=h.notified_at AND x.occurred_at>=h.notified_at-interval '1 hour'
 ORDER BY occurred_at DESC LIMIT 1
) x ON true WHERE h.notified_at>now()-interval '24 hours' ORDER BY h.notified_at DESC LIMIT 500;
ROLLBACK;
