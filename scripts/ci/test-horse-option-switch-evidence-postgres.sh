#!/usr/bin/env bash
# HA-10878-1, proven by execution on a THROWAWAY PostgreSQL 17: the option switch
# refuses 'on' for every non-style option that has no promotion evidence file
# (docs/horse-default-on.d/<option>.md), at the set function, at the old style
# setter and at the table itself (any writer). 'off' and clear stay available
# for every registered option, each write leaves one audit row with its actor,
# the refused options stay refused, and the seven style options keep 'on',
# 'shadow' and 'canary' exactly as before.
#
# It installs the style switch migration (20261113201841) and then the option
# switch migration (20261114072215, or OPTION_SWITCH_MIGRATION to prove the
# test fails without the guard) on a local cluster in a temp directory that is
# removed on exit. It never touches a real database.
set -euo pipefail
# macOS: a postmaster without a valid locale in the environment refuses to start
export LC_ALL="${LC_ALL:-C}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
if [ ! -x "$pgbin/initdb" ]; then
  if command -v initdb >/dev/null 2>&1; then pgbin="$(dirname "$(command -v initdb)")"; else
    echo 'SKIPPED: no PostgreSQL binaries found'; exit 0; fi
fi
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
work="$(mktemp -d "$parent/h.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
# the socket lives in the scratch directory itself: a Unix socket path is limited to about 103 bytes
sock="$work"
port="${OPTION_SWITCH_PG_PORT:-57691}"
"$pgbin/initdb" -D "$work/data" -U fixture_admin --auth-local=trust --auth-host=reject --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h '' -k '$sock' -p $port" -w start >/dev/null || { tail -20 "$work/postgres.log"; exit 1; }
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h "$sock" -p "$port" -U fixture_admin -d postgres)

style_migration="$repo/supabase/migrations/20261113201841_the_horse_style_read_has_a_live_switch.sql"
option_migration="${OPTION_SWITCH_MIGRATION:-$repo/supabase/migrations/20261114072215_every_horse_upgrade_has_a_live_switch.sql}"

"${psql[@]}" -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"
"${psql[@]}" -f "$style_migration"
# A style row written before the wider switch: it must survive the migration untouched.
"${psql[@]}" -c "SELECT public.fn_ca_horse_style_switch_set('styleFoldBluff', 'on', 'fixture', 'before');" >/dev/null
"${psql[@]}" -f "$option_migration"

style='styleValueBettorNotManiac styleBigBetHonesty styleRaiseRespect styleTightReRaiserRespect styleFoldRatePreRepair styleValueExtraction styleFoldBluff'
plain='v16Hu v16Ratio v17RiverProbe v23ShortDeck v32FacingDefense v33DepthCeiling v55OmahaRiverTripsFlat commitUnderPot v62RiverBettorPolarity readPostflopFoldRate readShrinkResponse readBreakEvenBluff readScopedShrink omahaNeutralUnknown'
refused='v54RiverBluff v53PloTourneyIcm phase8Postflop phase13Joint v87DeepDiveDiscipline v31GtoSuitAware vpipFloorDeepStackOff omahaPreflopCallWithActionBehind committedStackPricedIn huBbDefendsToPrice facingOpenFullRingZone vs3BetShortStack nashPushFoldIcm v46ShortDeck holdemPersonaReRaiseMix notAnOption'

fail=0
check() { # name, expected, actual
  if [ "$2" = "$3" ]; then echo "ok    $1"; else echo "FAIL  $1: expected [$2] got [$3]"; fail=1; fi
}
q() { "${psql[@]}" -At -c "$1"; }
# Runs a statement that must raise; prints the error text, or WROTE if it did not raise.
refusal() {
  local out
  if out="$("${psql[@]}" -At -c "$1" 2>&1)"; then echo WROTE; else printf '%s' "$out" | sed -n 's/^.*ERROR:  //p' | head -1; fi
}

# The options allowed 'on', as the database answers, and as the evidence directory says.
db_on=""
for o in $style $plain; do
  if [ "$(q "SELECT 'on' = ANY (public.fn_ca_horse_option_switch_states('$o'))")" = t ]; then db_on="$db_on $o"; fi
done
dir_on=""
for o in $style; do dir_on="$dir_on $o"; done
for o in $plain; do [ -f "$repo/docs/horse-default-on.d/$o.md" ] && dir_on="$dir_on $o"; done
check "the options the database offers 'on' are the style options plus those with an evidence file" "$dir_on" "$db_on"

audit_before="$(q 'SELECT count(*) FROM public.ca_horse_style_switch_audit')"
for o in $plain; do
  if [ -f "$repo/docs/horse-default-on.d/$o.md" ]; then
    check "$o (evidenced) can be set on" "{off,on}" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
    continue
  fi
  check "$o is offered off only" "{off}" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
  r="$(refusal "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', 'try on')")"
  case "$r" in *"has no promotion evidence"*) check "$o: the set function refuses on" refused refused;;
    *) check "$o: the set function refuses on" refused "$r";; esac
  r="$(refusal "INSERT INTO public.ca_horse_style_switch (option, state, updated_by) VALUES ('$o', 'on', 'owner-role')")"
  case "$r" in *"ca_horse_style_switch_on_needs_evidence"*) check "$o: the table refuses an on row from any writer" refused refused;;
    *) check "$o: the table refuses an on row from any writer" refused "$r";; esac
  r="$(refusal "SELECT public.fn_ca_horse_style_switch_set('$o', 'on', 'fixture', 'old setter')")"
  [ "$r" = WROTE ] && check "$o: the old style setter refuses it" refused WROTE || check "$o: the old style setter refuses it" refused refused
  q "SELECT public.fn_ca_horse_option_switch_set('$o', 'off', 'fixture', 'rollback')" >/dev/null
  check "$o: off is written" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$o'")"
  r="$(refusal "UPDATE public.ca_horse_style_switch SET state = 'on' WHERE option = '$o'")"
  case "$r" in *"ca_horse_style_switch_on_needs_evidence"*) check "$o: the table refuses turning its off row on" refused refused;;
    *) check "$o: the table refuses turning its off row on" refused "$r";; esac
  q "SELECT public.fn_ca_horse_option_switch_clear('$o', 'fixture', 'clear')" >/dev/null
  check "$o: clear removes the row" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch WHERE option = '$o'")"
done
check "every off and clear wrote one audit row with its actor; no refused on wrote one" \
  "$((audit_before + 28))" "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit")"
check "no audit row records an un-evidenced on" "0" \
  "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit WHERE new_state = 'on' AND option NOT IN ('$(echo $style | sed "s/ /','/g")')")"
check "the audit rows name their actor" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit WHERE changed_by IS DISTINCT FROM 'fixture'")"

for o in $refused; do
  check "$o is not switchable" "" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
  for s in on off; do
    r="$(refusal "SELECT public.fn_ca_horse_option_switch_set('$o', '$s', 'fixture', 'held')")"
    case "$r" in *"not a switchable option"*) check "$o: set $s is refused" refused refused;; *) check "$o: set $s is refused" refused "$r";; esac
  done
  r="$(refusal "SELECT public.fn_ca_horse_option_switch_clear('$o', 'fixture', 'held')")"
  case "$r" in *"not a switchable option"*) check "$o: clear is refused" refused refused;; *) check "$o: clear is refused" refused "$r";; esac
done

check "the style row written before the migration is untouched" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'styleFoldBluff'")"
for o in $style; do
  for s in shadow canary on off; do
    q "SELECT public.fn_ca_horse_option_switch_set('$o', '$s', 'fixture', 'style')" >/dev/null
    check "$o: the wide setter writes $s" "$s" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$o'")"
  done
  q "SELECT public.fn_ca_horse_style_switch_set('$o', 'on', 'fixture', 'style')" >/dev/null
  check "$o: the old style setter still writes on" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$o'")"
done

q "SELECT public.fn_ca_horse_option_switch_set('v16Hu', 'off', 'fixture', 'read')" >/dev/null
check "the wide read names the off row and no on row" '{"v16Hu": "off"}' "$(q "SELECT public.fn_ca_horse_option_switch_effective()->'options'")"

if [ "$fail" = 0 ]; then
  echo 'PASS  every option switch evidence assertion held'
else
  echo 'FAIL  the option switch accepts on without evidence, or lost off, clear, audit or a refusal'
  exit 1
fi
