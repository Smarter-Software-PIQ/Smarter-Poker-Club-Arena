#!/usr/bin/env bash
# STATIC CHECK OF EVERY PL/pgSQL FUNCTION A PULL REQUEST'S MIGRATIONS DEFINE
# (2026-11-19, incident d2d79c4f).
#
# CREATE FUNCTION checks only syntax. 20261118164000 installed a body whose
# INSERT read `FROM jsonb_array_elements(v_chairs) x` beside a PL/pgSQL variable
# named x; PostgreSQL refused the ambiguous reference only when the engine ran
# it, and every hand manifest capture failed for 52 minutes. plpgsql_check
# prepares every statement of a function without running it, so it names that
# error (42702) before merge, on every path, including the ones no probe reaches.
#
# Run after the migrations are installed into a THROWAWAY database (the window
# rehearsal's copy of production's schema, or the self-test's empty container).
#
#   REHEARSAL_PSQL  psql argv prefix for the throwaway database (stdin SQL)
#   MIG_DIR         directory holding the migration files
#   CHANGED         file listing the migration paths the pull request adds or modifies
#
# Exit 0: no errors. Exit 1: at least one function has an error (named).
# A function plpgsql_check cannot judge (a trigger function with no trigger, an
# event-trigger function) is reported UNCHECKED by name; it is not a pass and
# not a failure (CLAUDE.md 10.86 rule 1). Warnings are printed, never fatal.
set -euo pipefail
: "${REHEARSAL_PSQL:?}" "${MIG_DIR:?}" "${CHANGED:?}"
read -r -a PSQL <<<"$REHEARSAL_PSQL"
say() { echo "$*" >&2; echo "$*" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; }

names=()
while IFS= read -r path; do
  [ -n "$path" ] || continue
  f="$MIG_DIR/$(basename "$path")"
  [ -f "$f" ] || continue
  while IFS= read -r q; do names+=("$q"); done < <(
    sed 's/--.*$//' "$f" \
      | grep -oiE 'create[[:space:]]+(or[[:space:]]+replace[[:space:]]+)?function[[:space:]]+("?[a-z_][a-z0-9_]*"?[[:space:]]*\.[[:space:]]*)?"?[a-z_][a-z0-9_]*"?' \
      | sed -E 's/^.*[Ff][Uu][Nn][Cc][Tt][Ii][Oo][Nn][[:space:]]+//; s/"//g; s/[[:space:]]//g' \
      | tr 'A-Z' 'a-z' \
      | awk -F. '{ if (NF == 1) print "public." $1; else print $1 "." $2 }'
  )
done < "$CHANGED"

say "### plpgsql_check on the functions this pull request defines"
if [ "${#names[@]}" -eq 0 ]; then
  say "- no function definitions in the changed migrations"
  exit 0
fi
list=$(printf '%s\n' "${names[@]}" | sort -u | paste -sd, -)
say "- functions: ${list//,/, }"

out=$("${PSQL[@]}" -X -q -At -F $'\t' -v ON_ERROR_STOP=1 -v names="$list" <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'plpgsql_check') THEN
    CREATE EXTENSION plpgsql_check;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ca_check_named(p_names text)
RETURNS TABLE(fn text, verdict text, detail text) LANGUAGE plpgsql AS $f$
DECLARE r record; c record; v_rel oid; v_ns text;
BEGIN
  SELECT n.nspname INTO v_ns FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname = 'plpgsql_check';
  FOR r IN
    SELECT p.oid, p.oid::regprocedure::text AS sig, p.prorettype
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language l ON l.oid = p.prolang
     WHERE l.lanname = 'plpgsql'
       AND n.nspname || '.' || p.proname = ANY (string_to_array(p_names, ','))
     ORDER BY 2
  LOOP
    v_rel := 0;
    IF r.prorettype = 'event_trigger'::regtype THEN
      fn := r.sig; verdict := 'UNCHECKED'; detail := 'event trigger function'; RETURN NEXT; CONTINUE;
    END IF;
    IF r.prorettype = 'trigger'::regtype THEN
      SELECT t.tgrelid INTO v_rel FROM pg_trigger t WHERE t.tgfoid = r.oid ORDER BY t.oid LIMIT 1;
      IF v_rel IS NULL THEN
        fn := r.sig; verdict := 'UNCHECKED'; detail := 'trigger function attached to no table'; RETURN NEXT; CONTINUE;
      END IF;
    END IF;
    BEGIN
      FOR c IN EXECUTE format(
        'SELECT level, sqlstate, message, lineno, coalesce(query, '''') AS q
           FROM %I.plpgsql_check_function_tb($1, $2, fatal_errors => false,
                other_warnings => false, performance_warnings => false,
                extra_warnings => false, security_warnings => false)', v_ns)
        USING r.oid::regprocedure, v_rel::regclass
      LOOP
        fn := r.sig;
        verdict := CASE WHEN c.level = 'error' THEN 'ERROR' ELSE 'WARNING' END;
        detail := format('line %s %s: %s %s', coalesce(c.lineno::text, '?'), coalesce(c.sqlstate, ''),
                         c.message, left(regexp_replace(c.q, '\s+', ' ', 'g'), 200));
        RETURN NEXT;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      fn := r.sig; verdict := 'UNCHECKED'; detail := SQLERRM; RETURN NEXT;
      CONTINUE;
    END;
    fn := r.sig; verdict := 'CHECKED'; detail := ''; RETURN NEXT;
  END LOOP;
  -- A name the migrations define that is not a PL/pgSQL function here (a SQL
  -- function, or a file that did not install into the copy) is named, not passed.
  FOR r IN
    SELECT q FROM unnest(string_to_array(p_names, ',')) q
     WHERE NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                        JOIN pg_language l ON l.oid = p.prolang
                       WHERE l.lanname = 'plpgsql' AND n.nspname || '.' || p.proname = q)
  LOOP
    fn := r.q; verdict := 'UNCHECKED'; detail := 'no PL/pgSQL function of this name in the copy'; RETURN NEXT;
  END LOOP;
END $f$;
SELECT fn, verdict, detail FROM pg_temp.ca_check_named(:'names');
SQL
)

errors=0
while IFS=$'\t' read -r fn verdict detail; do
  [ -n "$fn" ] || continue
  case "$verdict" in
    ERROR) errors=$((errors + 1)); say "- **ERROR** \`$fn\`: $detail" ;;
    WARNING) say "- warning \`$fn\`: $detail" ;;
    UNCHECKED) say "- UNCHECKED \`$fn\`: $detail" ;;
    CHECKED) ;;
  esac
done <<<"$out"
checked=$(grep -c $'\tCHECKED\t' <<<"$out" || true)
say "- $checked function(s) checked, $errors error(s)"
[ "$errors" -eq 0 ]
