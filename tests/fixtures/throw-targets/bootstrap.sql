-- Minimal production shapes read by 20261113123902_record_throw_targets.sql.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_horse boolean);
CREATE TABLE public.table_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid, seat_number integer, user_id uuid,
  joined_at timestamptz DEFAULT now(), left_at timestamptz
);
CREATE TABLE public.throwable_use_receipts (
  user_id uuid, request_id uuid, throwable_id text, result jsonb,
  PRIMARY KEY (user_id, request_id)
);
-- Table T: horse A seat 1, horse B seat 2, human H seat 3, a left seat 4.
INSERT INTO public.profiles VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', false),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', false);
INSERT INTO public.table_seats (table_id, seat_number, user_id, left_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 1, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', NULL),
  ('11111111-1111-4111-8111-111111111111', 2, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', NULL),
  ('11111111-1111-4111-8111-111111111111', 3, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', NULL),
  ('11111111-1111-4111-8111-111111111111', 4, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', now());
-- Charged throws (receipts) for horse A x2, human H x1. None for horse B.
INSERT INTO public.throwable_use_receipts VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-4000-8000-000000000001', 'tomato', '{"success":true}'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-4000-8000-000000000002', 'snowball', '{"success":true}'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-4000-8000-000000000003', 'heart', '{"success":true}');
