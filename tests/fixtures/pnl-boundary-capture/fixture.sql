-- Native fixture for scripts/ci/test-pnl-boundary-capture.py: the production
-- shape of public.accounting_close_certificates (the columns the capture
-- reads) and the certificates production held on 2026-11-15 in miniature.
CREATE TABLE public.accounting_close_certificates (
  kind text NOT NULL, union_id uuid NOT NULL, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
  value jsonb NOT NULL, certified_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, union_id, period_start, period_end));
INSERT INTO public.accounting_close_certificates (kind, union_id, period_start, period_end, value, certified_at) VALUES
  ('pnl_boundary', 'fade0000-0000-0000-0000-000000000001', '2026-11-02 08:00+00', '2026-11-02 08:00+00',
   '{"status":"ready","holdings":[{"kind":"deferred_tournament_result","club_id":"a41434bb-8d0c-400a-8f0d-e8b3d65afed4","user_id":"11111111-0000-0000-0000-000000000001","amount":30.00}]}',
   '2026-11-11 01:52:19+00'),
  ('pnl_boundary', 'fade0000-0000-0000-0000-000000000001', '2026-11-09 08:00+00', '2026-11-09 08:00+00',
   '{"status":"ready","holdings":[]}', '2026-11-11 03:43:14+00'),
  -- Not ready: never kept.
  ('pnl_boundary', 'fade0000-0000-0000-0000-000000000001', '2026-10-12 07:00+00', '2026-10-12 07:00+00',
   '{"status":"blocked","holdings":[]}', '2026-11-01 00:00+00'),
  -- Another kind: never kept.
  ('pnl_flows', 'fade0000-0000-0000-0000-000000000001', '2026-11-02 08:00+00', '2026-11-09 08:00+00',
   '{"status":"ready"}', '2026-11-11 01:00+00');
