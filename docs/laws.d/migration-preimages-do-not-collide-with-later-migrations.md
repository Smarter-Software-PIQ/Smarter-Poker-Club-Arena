# tests/migration-preimages-do-not-collide-with-later-migrations.law.test.ts

Enforces via `scripts/ci/check-migration-preimage-collisions.mjs` that no new migration (>= `20261120000000`) pins a function's expected pre-image MD5 to `X` when an earlier migration in `supabase/migrations/` already defines or rewrites that exact signature to a different post-image MD5 `Y` (`Y != X`) and the later migration does not accept `Y`.
