-- Horse release verification: V78. Horse turn/river RAISES that were not
-- all in yet put 40%+ of the horse's remaining stack in (amount added /
-- stack behind at the node, from publicNode seats: [seat, behind,
-- street bet, hand total, ...]). Measured 2026-11-02 on the old engine: a
-- committed horse never folded after such a raise (0 of 168); it called the
-- re-shove instead (the A-T turn check-raise hand). So the outcome reported
-- is the CALL-OFF: the horse later called an all-in in the same hand, and
-- the hand's net for that horse (ca_hand_facts, bb). V78 withholds the bluff
-- share of these raises; value raises remain, so the count falls but not to
-- zero. Windowed [:START, :END), keep <= ~1 day per call. Read-only (one SELECT).
WITH h AS (
  SELECT id, tournament_id, big_blind, actions
  FROM public.hand_history
  WHERE created_at >= :START::timestamptz AND created_at < :END::timestamptz
    AND game_variant = 'nlh' AND bomb_pot IS NULL AND big_blind > 0),
r AS (
  SELECT h.id, h.tournament_id, h.big_blind, h.actions, a.ord, a.e->>'userId' uid, a.e->>'stage' street,
         (a.e->>'amount')::numeric raise_to,
         (SELECT s FROM jsonb_array_elements(a.e->'publicNode'->'seats') s
            WHERE (s->>0)::int = (a.e->'publicNode'->>'actorSeat')::int) seat
  FROM h CROSS JOIN LATERAL jsonb_array_elements(h.actions) WITH ORDINALITY a(e, ord)
  WHERE a.e->>'origin' = 'horse_policy' AND a.e->>'stage' IN ('turn','river')
    AND a.e->>'action' = 'raise' AND a.e ? 'publicNode'),
c AS (
  SELECT r.*, (raise_to - (seat->>2)::numeric) added, (seat->>1)::numeric behind
  FROM r WHERE seat IS NOT NULL),
k AS (
  SELECT c.*,
    EXISTS (SELECT 1 FROM jsonb_array_elements(c.actions) WITH ORDINALITY z(e2, o2)
            WHERE z.o2 > c.ord AND z.e2->>'userId' = c.uid AND z.e2->>'action' = 'fold') later_fold,
    EXISTS (SELECT 1 FROM jsonb_array_elements(c.actions) WITH ORDINALITY z(e2, o2)
            WHERE z.o2 > c.ord AND z.e2->>'userId' = c.uid AND z.e2->>'action' IN ('call','all_in')
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.actions) WITH ORDINALITY y(e3, o3)
                          WHERE y.o3 > c.ord AND y.o3 < z.o2 AND y.e3->>'userId' <> c.uid AND y.e3->>'action' = 'all_in')) called_jam,
    (SELECT f.net FROM public.ca_hand_facts f WHERE f.hand_id = c.id AND f.user_id = c.uid::uuid) / c.big_blind net_bb
  FROM c WHERE behind > 0 AND added < behind AND added >= 0.4 * behind)
SELECT CASE WHEN tournament_id IS NULL THEN 'cash' ELSE 'tournament' END fmt, street,
       count(*) committing_non_allin_raises,
       count(*) FILTER (WHERE called_jam) called_off_reshove,
       count(*) FILTER (WHERE later_fold) raise_then_fold,
       round(avg(net_bb), 2) avg_net_bb,
       round(avg(net_bb) FILTER (WHERE called_jam), 2) avg_net_bb_when_called_off
FROM k GROUP BY 1, 2 ORDER BY 1, 2;
