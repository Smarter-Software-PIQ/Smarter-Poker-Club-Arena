# plpgsql_check sees the migration history a body reads (2026-11-21)

`scripts/ci/plpgsql-check-changed.sh` checks every PL/pgSQL body a pull
request defines inside the window rehearsal's throwaway copy of production's
schema. That copy is the application schema only: `supabase_migrations` is
platform-owned and not dumped, so a body that reads its own prerequisite from
`supabase_migrations.schema_migrations` (every hand source-correction proof
does, e.g. 20261117170259 and 20261121142714) was refused 42P01 for a relation
production has, and the required `Window migrations install against
production's schema` check went red on PR #11619 (incidents bb04ee5f,
e542fbd7, 887c0008).

The check now creates that one relation, empty and with production's columns,
only when it is missing. Nothing is judged against its rows.
