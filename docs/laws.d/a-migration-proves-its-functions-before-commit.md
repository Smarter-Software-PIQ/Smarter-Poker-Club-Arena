# tests/a-migration-proves-its-functions-before-commit.law.test.ts

From 20261119030000 a migration that creates or replaces a SECURITY DEFINER PL/pgSQL function in public or smarter_private executes it before COMMIT in a `-- @probe-for:` DO block that always unwinds with 'probe-unwind' (any other error rolls the migration back), or names a real reason in `-- @probe-exempt:`; incident d2d79c4f installed a manifest capture whose body could not run and failed every hand for 52 minutes.
