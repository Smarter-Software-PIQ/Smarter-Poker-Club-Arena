-- 20261126173139_smarter_poker_monthly_magazine_schema_and_storage.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- SMARTER.POKER MONTHLY MAGAZINE SCHEMA & PERMANENT ASSET STORAGE (2026-11-26)
--
-- Creates the three isolated public tables and public-read storage bucket for
-- Smarter.Poker Magazine (online 2-page spread flipbook, mobile reader,
-- 8.375"x10.875" 4-page signature print renderer, and national poker-room bulk
-- distribution waitlist), alongside the continuing Tuesday Weekly Wire:
--   1. public.magazine_issues             - published & staged monthly issues
--   2. public.magazine_vault_items        - continuously harvested stories,
--                                           permanently vaulted 300-DPI/web
--                                           images, POY snapshots, strategy
--                                           spots, trivia, and tour results
--   3. public.magazine_room_subscriptions - brick-and-mortar poker room print
--                                           distribution bundle requests
--   4. storage.buckets ('magazine-assets') - permanent content-addressed image
--                                           masters & print-ready PDFs
--
-- Zero functions created, zero foreign keys or locks on existing gameplay or
-- directory relations; fast metadata-only DDL inside a single transaction.
--
-- @live-proof: (to_regclass('public.magazine_issues') IS NOT NULL AND to_regclass('public.magazine_vault_items') IS NOT NULL AND to_regclass('public.magazine_room_subscriptions') IS NOT NULL)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.magazine_issues (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_number             integer NOT NULL UNIQUE CHECK (issue_number >= 1),
  volume_number            integer NOT NULL DEFAULT 1 CHECK (volume_number >= 1),
  issue_period             text NOT NULL UNIQUE CHECK (issue_period ~ '^\d{4}-\d{2}$'),
  slug                     text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 128),
  title                    text NOT NULL CHECK (length(title) BETWEEN 1 AND 240),
  cover_headline           text NOT NULL CHECK (length(cover_headline) BETWEEN 1 AND 240),
  cover_subheadline        text,
  editor_note              text,
  cover_image_url          text,
  cover_image_storage_path text,
  status                   text NOT NULL DEFAULT 'accumulating'
                           CHECK (status IN ('accumulating', 'review', 'published', 'archived')),
  page_count               integer NOT NULL DEFAULT 44
                           CHECK (page_count >= 16 AND page_count <= 128 AND page_count % 4 = 0),
  manifest_json            jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url                  text,
  pdf_storage_path         text,
  email_campaign_id        uuid,
  published_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.magazine_issues IS
  'Monthly issues of Smarter.Poker Magazine (online flipbook + 4-page signature print-ready manifest). Public SELECT restricted to status = published; writes via service_role.';

CREATE INDEX IF NOT EXISTS magazine_issues_status_number_idx
  ON public.magazine_issues (status, issue_number DESC);

ALTER TABLE public.magazine_issues ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.magazine_issues FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.magazine_issues TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.magazine_issues TO service_role;

DROP POLICY IF EXISTS magazine_issues_public_published_read ON public.magazine_issues;
CREATE POLICY magazine_issues_public_published_read
  ON public.magazine_issues
  FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

CREATE TABLE IF NOT EXISTS public.magazine_vault_items (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_period         text NOT NULL CHECK (issue_period ~ '^\d{4}-\d{2}$'),
  section              text NOT NULL
                       CHECK (section IN (
                         'cover_candidate',
                         'news_brief',
                         'feature_story',
                         'photo_essay',
                         'tournament_result',
                         'poy_snapshot',
                         'strategy_spot',
                         'trivia_quiz',
                         'video_highlight',
                         'platform_highlight',
                         'series_calendar',
                         'featured_venue'
                       )),
  source_type          text NOT NULL CHECK (length(source_type) BETWEEN 1 AND 64),
  source_id            text NOT NULL CHECK (length(source_id) BETWEEN 1 AND 256),
  headline             text NOT NULL CHECK (length(headline) BETWEEN 1 AND 500),
  deck                 text,
  body_text            text,
  author_byline        text,
  canonical_url        text,
  original_image_url   text,
  vaulted_image_url    text,
  vaulted_master_url   text,
  vaulted_storage_path text,
  image_width          integer CHECK (image_width IS NULL OR image_width >= 1),
  image_height         integer CHECK (image_height IS NULL OR image_height >= 1),
  editorial_score      numeric(8,2) NOT NULL DEFAULT 0,
  is_pinned            boolean NOT NULL DEFAULT false,
  is_excluded          boolean NOT NULL DEFAULT false,
  metadata_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at          timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT magazine_vault_items_period_source_uidx UNIQUE (issue_period, source_type, source_id)
);

COMMENT ON TABLE public.magazine_vault_items IS
  'Continuous monthly story, photo, leaderboard, and strategy vault feeding Smarter.Poker Magazine compilation. Server-managed via service_role.';

CREATE INDEX IF NOT EXISTS magazine_vault_items_period_section_score_idx
  ON public.magazine_vault_items (issue_period, section, editorial_score DESC);

CREATE INDEX IF NOT EXISTS magazine_vault_items_period_pinned_score_idx
  ON public.magazine_vault_items (issue_period, is_pinned DESC, editorial_score DESC);

ALTER TABLE public.magazine_vault_items ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.magazine_vault_items FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.magazine_vault_items TO service_role;

CREATE TABLE IF NOT EXISTS public.magazine_room_subscriptions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id              uuid,
  room_name             text NOT NULL CHECK (length(room_name) BETWEEN 2 AND 200),
  contact_name          text NOT NULL CHECK (length(contact_name) BETWEEN 2 AND 160),
  contact_email         text NOT NULL CHECK (length(contact_email) BETWEEN 3 AND 254),
  contact_phone         text,
  city                  text,
  state                 text,
  postal_code           text,
  shipping_address_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  table_count           integer CHECK (table_count IS NULL OR (table_count >= 1 AND table_count <= 500)),
  requested_copies      integer NOT NULL DEFAULT 25 CHECK (requested_copies BETWEEN 5 AND 1000),
  notes                 text,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'verified', 'active', 'paused', 'cancelled')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.magazine_room_subscriptions IS
  'Brick-and-mortar poker room print bundle waitlist and active shipping subscriptions for Smarter.Poker Magazine.';

CREATE INDEX IF NOT EXISTS magazine_room_subscriptions_status_created_idx
  ON public.magazine_room_subscriptions (status, created_at DESC);

CREATE INDEX IF NOT EXISTS magazine_room_subscriptions_email_lower_idx
  ON public.magazine_room_subscriptions (lower(contact_email));

ALTER TABLE public.magazine_room_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.magazine_room_subscriptions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.magazine_room_subscriptions TO service_role;

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'magazine-assets',
      'magazine-assets',
      true,
      26214400,
      ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'application/pdf']
    )
    ON CONFLICT (id) DO UPDATE
      SET public = true,
          file_size_limit = EXCLUDED.file_size_limit,
          allowed_mime_types = EXCLUDED.allowed_mime_types;

    IF to_regclass('storage.objects') IS NOT NULL THEN
      EXECUTE 'DROP POLICY IF EXISTS magazine_assets_public_read ON storage.objects';
      EXECUTE 'CREATE POLICY magazine_assets_public_read ON storage.objects FOR SELECT TO public USING (bucket_id = ''magazine-assets'')';
    END IF;
  END IF;
END $$;

COMMIT;
