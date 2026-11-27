-- Authoritative Training Game Favorites table for the Training Games Arena Lobby
-- Composite primary key (user_id, game_id) guarantees idempotent upsert & zero duplicates.

CREATE TABLE IF NOT EXISTS public.training_game_favorites (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    game_id TEXT NOT NULL CHECK (char_length(trim(game_id)) BETWEEN 1 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS idx_training_game_favorites_user_created
    ON public.training_game_favorites (user_id, created_at DESC);

ALTER TABLE public.training_game_favorites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'training_game_favorites'
          AND policyname = 'training_game_favorites_select_own'
    ) THEN
        CREATE POLICY training_game_favorites_select_own
            ON public.training_game_favorites
            FOR SELECT
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'training_game_favorites'
          AND policyname = 'training_game_favorites_insert_own'
    ) THEN
        CREATE POLICY training_game_favorites_insert_own
            ON public.training_game_favorites
            FOR INSERT
            WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'training_game_favorites'
          AND policyname = 'training_game_favorites_delete_own'
    ) THEN
        CREATE POLICY training_game_favorites_delete_own
            ON public.training_game_favorites
            FOR DELETE
            USING (auth.uid() = user_id);
    END IF;
END
$$;
