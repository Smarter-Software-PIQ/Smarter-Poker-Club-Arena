#!/usr/bin/env bash
# The owner order of 2026-11-14 22:01 Chicago (every option has an on/off switch),
# proven by execution on a THROWAWAY PostgreSQL 17: every registered non-style
# option is offered off and on; 'on' WITHOUT a note that cites its authority is
# refused at the set function, at the old style setter and at the table itself
# (any writer); 'on' WITH the authority note is written and leaves an audit row
# with the note and the actor; 'off' and clear stay available for every
# registered option; the refused options stay refused; and the seven style
# options keep 'on', 'shadow' and 'canary' exactly as before. It replaces the
# evidence-file rule (HA-10878-1) for the switch. It enables nothing.
#
# It installs the style switch migration (20261113201841) and then the option
# switch migration (20261114072215, or OPTION_SWITCH_MIGRATION to prove the
# test fails without the guard) on a local cluster in a temp directory that is
# removed on exit. It never touches a real database. CI runs it in the required
# accounting_postgres job (.github/workflows/ci.yml), like every other
# scripts/ci/test-*-postgres proof; everyUpgradeHasALiveSwitch.law.test.ts fails
# when it is not wired there or its option lists drift from the engine registry.
#
# A proof that did not run is not a pass: no PostgreSQL binaries is a failure.
set -euo pipefail
# macOS: a postmaster without a valid locale in the environment refuses to start
export LC_ALL="${LC_ALL:-C}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
pgbin="${PG_BIN:-${PG17_BINDIR:-/opt/homebrew/opt/postgresql@17/bin}}"
if [ ! -x "$pgbin/initdb" ]; then
  echo "FAIL  no PostgreSQL binaries at $pgbin (set PG_BIN): the proof did not run"; exit 1
fi
parent="${RUNNER_TEMP:-${TMPDIR:-}}"
[ -n "$parent" ] && [ -d "$parent" ] || { echo 'Owned scratch parent required'; exit 1; }
work="$(mktemp -d "$parent/h.XXXXXX")"
cleanup() { "$pgbin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
# Loopback TCP on a free port and no Unix socket (as scripts/ci/test-stall-progress-proof.py): a socket path in a
# deep scratch directory passes the 103-byte limit, and a fixed port collides with a parallel run.
port="${OPTION_SWITCH_PG_PORT:-$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')}"
"$pgbin/initdb" -D "$work/data" -U fixture_admin -A trust --no-locale -E UTF8 >/dev/null
"$pgbin/pg_ctl" -D "$work/data" -l "$work/postgres.log" -o "-h 127.0.0.1 -p $port -c unix_socket_directories=" -w start >/dev/null || { tail -20 "$work/postgres.log"; exit 1; }
psql=("$pgbin/psql" -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$port" -U fixture_admin -d postgres)

style_migration="$repo/supabase/migrations/20261113201841_the_horse_style_read_has_a_live_switch.sql"
option_migration="${OPTION_SWITCH_MIGRATION:-$repo/supabase/migrations/20261114072215_every_horse_upgrade_has_a_live_switch.sql}"

"${psql[@]}" -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;"
"${psql[@]}" -f "$style_migration"
# A style row written before the wider switch: it must survive the migration untouched.
"${psql[@]}" -c "SELECT public.fn_ca_horse_style_switch_set('styleFoldBluff', 'on', 'fixture', 'before');" >/dev/null
"${psql[@]}" -f "$option_migration"

style='styleValueBettorNotManiac styleBigBetHonesty styleRaiseRespect styleTightReRaiserRespect styleFoldRatePreRepair styleValueExtraction styleFoldBluff'
plain='streetIQ handReading v7 v7Preflop v7Barrels v7SizeReads v7CounterAdapt v7AdaptiveMC v8 v8Draws v8HiLo v8Nlh v9 v9Sizing v9Timing decisionGravityTiming v9Mood v10 v10Cbet v10Spr v10Rake v10ThinValue v10Iso v11 v12 v12Ranges v12River v13 v15 v15Boats v16Reads v16Icm v16Hu v16Blockers v16SizeCond v16PloPolar v16Ratio v17Pos v17RiverProbe v17CatchBlock v17ShortDeck v18Straddle v18Squeeze v18SelfImage v18ExploitSize v18Families v20Multiway v20Mzone v21River v21Deep v23Endgame v23Plan v23Reads v23Variants v23ShortDeck v23Spin v24Bounty v24PloDefense v25PloTourney v26Prizes v27GtoCharts v29GtoFlop v30GtoTurnRiver v32FacingDefense v33DepthCeiling v37Satellite v38Ev v40Omaha holdemPremiumAggression holdemDominatedFold ploPairedBoardFold ploPairedBoardRiverCheck ploSuitedAcesFourBet v86PloOverhaul v87HoldemOverhaul v87RiverBlockBetTrap v87HollywoodTank v87FlopStabCheckRaise v46Charts v46ShortDeck v51RiverFlat v55OmahaRiverTripsFlat v56OmahaPressureRange v57TournamentAggression v61RiverOnePairShade v66BetRaisedOnePair v67RiverBetRaisedOnePair v88CommitmentHonored omahaTournamentFirstIn omahaHiLoTournamentFirstIn tokenCallPrice plo6ManiacPriceRefusalToRangePlay plo6TopSetNutRealization v64RiverRaiseNeedsTwoPair v63LargeRiverBetShade v74OmahaSemiBluffNeedsDraw v62RiverBettorPolarity v60CashPressure v65TurnOnePairShade v68TurnAirDrawCalls v69TurnCallGaps v70GtoOpeningRanges v71AnteAwarePushFold v72DefenceByOpener v73Vs3BetDefence v75SqueezeDefence v79TopPairWeakKicker v81OmahaBigBetCalls v15RiverNoNearLock v85CashAction v84OmahaRiverReraiseCalls v83AggressionNeedsBluffs readPostflopFoldRate readShrinkResponse readBreakEvenBluff omahaEvFoldModel omahaNeutralUnknown omahaTightOpponent readScopedShrink planFingerprint v80TopPairStrongKicker v78NoCommittingBluffRaise v70FacingOpenZone huBbDefendsToPrice huOpenerDefendsToPrice huLimpDefendsToPrice committedStackPricedIn nashCallVsJam nashPushFoldIcm facingOpenFullRingZone vs3BetShortStack omahaCommitZoneThreeBetPriceRelief facingClosedAllIn limpReraiseIsoRead commitUnderPot v77SeatAwareJams v76RetireFourBetBluffBand v74NlhOpenSizes v52RangeAdvantage v53Pressure v58Plo6RiverNuts v59Plo6RiverUnpaired drawOutlookQuality committedRaiseDiscipline callDeductionPricing flopTurnBluffBaseline riverBluffBaseline riverLeadRange riverBluffHiLo riverBluffMultiway riverFastCalldown probeAwareAggression riverBluffFixedLimit riverBluffShortDeck riverBluffBombPot riverBluffMultiBoard v43Tempo v41Leaks v86UnblockedPreflop v86MultiStreetUnblocked'
refused='comboDrawPressure v54RiverBluff riverPositionDefense riverBluffCheckRaise barrelContinuationOutlook smallPotNearNutRiverValue multiwayRiverBluffCheckRaise v53PloTourneyIcm phase8Postflop phase8PolicyFamily phase8CatastropheGuard phase10Plo4 phase11Omaha phase12Remaining phase13Joint phase14 phase14Corrective phase15Anything v87DeepDiveDiscipline v87ShouldSuppressOmahaPositionStab pillar2PositionStab v31GtoSuitAware solverRound7 heldOutPack vpipFloorDeepStackOff omahaPreflopCallWithActionBehind notAnOption leakMapRead telemetry observeMind mind'
authority='authority: OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md sha256 2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1'
plain_count=$(set -- $plain; echo $#)

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

audit_before="$(q 'SELECT count(*) FROM public.ca_horse_style_switch_audit')"
for o in $plain; do
  check "$o is offered off and on" "{off,on}" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
  r="$(refusal "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', 'try on')")"
  case "$r" in *"may be set on only with a note that cites its authority"*) check "$o: the set function refuses on without the authority note" refused refused;;
    *) check "$o: the set function refuses on without the authority note" refused "$r";; esac
  r="$(refusal "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', NULL)")"
  case "$r" in *"may be set on only with a note that cites its authority"*) check "$o: the set function refuses on with no note" refused refused;;
    *) check "$o: the set function refuses on with no note" refused "$r";; esac
  r="$(refusal "INSERT INTO public.ca_horse_style_switch (option, state, updated_by) VALUES ('$o', 'on', 'owner-role')")"
  case "$r" in *"ca_horse_style_switch_on_cites_authority"*) check "$o: the table refuses an on row without the authority note from any writer" refused refused;;
    *) check "$o: the table refuses an on row without the authority note from any writer" refused "$r";; esac
  r="$(refusal "SELECT public.fn_ca_horse_style_switch_set('$o', 'on', 'fixture', 'old setter')")"
  [ "$r" = WROTE ] && check "$o: the old style setter refuses it" refused WROTE || check "$o: the old style setter refuses it" refused refused
  q "SELECT public.fn_ca_horse_option_switch_set('$o', 'off', 'fixture', 'rollback')" >/dev/null
  check "$o: off is written" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$o'")"
  r="$(refusal "UPDATE public.ca_horse_style_switch SET state = 'on' WHERE option = '$o'")"
  case "$r" in *"ca_horse_style_switch_on_cites_authority"*) check "$o: the table refuses turning its off row on without the authority note" refused refused;;
    *) check "$o: the table refuses turning its off row on without the authority note" refused "$r";; esac
  q "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', '$authority')" >/dev/null
  check "$o: on with the authority note is written" "on|$authority" "$(q "SELECT state || '|' || note FROM public.ca_horse_style_switch WHERE option = '$o'")"
  q "SELECT public.fn_ca_horse_option_switch_clear('$o', 'fixture', 'clear')" >/dev/null
  check "$o: clear removes the row" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch WHERE option = '$o'")"
done
check "every off, on and clear wrote one audit row; no refused on wrote one" \
  "$((audit_before + 3 * plain_count))" "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit")"
check "every audit row of an on for a non-style option carries the authority note" "$plain_count|0" \
  "$(q "SELECT count(*) FILTER (WHERE note = '$authority') || '|' || count(*) FILTER (WHERE note IS DISTINCT FROM '$authority') FROM public.ca_horse_style_switch_audit WHERE new_state = 'on' AND option NOT IN ('$(echo $style | sed "s/ /','/g")')")"
check "the audit rows name their actor" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit WHERE changed_by IS DISTINCT FROM 'fixture'")"

for o in $refused; do
  check "$o is not switchable" "" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
  for s in on off; do
    r="$(refusal "SELECT public.fn_ca_horse_option_switch_set('$o', '$s', 'fixture', '$authority')")"
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
q "SELECT public.fn_ca_horse_option_switch_set('commitUnderPot', 'on', 'fixture', '$authority')" >/dev/null
q "SELECT public.fn_ca_horse_option_switch_clear('commitUnderPot', 'fixture', 'read')" >/dev/null
check "the wide read names the off row and no cleared row" '{"v16Hu": "off"}' "$(q "SELECT public.fn_ca_horse_option_switch_effective()->'options'")"

if [ "$fail" = 0 ]; then
  echo 'PASS  every option switch evidence assertion held'
else
  echo 'FAIL  the option switch accepts on without its authority, or lost on, off, clear, audit or a refusal'
  exit 1
fi
