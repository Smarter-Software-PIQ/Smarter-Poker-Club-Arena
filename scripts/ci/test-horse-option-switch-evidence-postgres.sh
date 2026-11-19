#!/usr/bin/env bash
# The owner order of 2026-11-14 22:01 Chicago (every option has an on/off switch)
# and the owner ruling of 23:10 ("Preserve approved OFF states. No automatic
# blanket switch-on after sealing."), proven by execution on a THROWAWAY
# PostgreSQL 17:
# - an OFF-ONLY option (owner hold, measured harm, superseded) is offered off
#   alone: 'on' is refused by the set function with ANY note, its own citation
#   included, and by the table from any writer (INSERT and UPDATE); off and
#   clear work;
# - every other registered non-style option is offered off and on: 'on' is
#   refused with a junk note, with a generic 'authority: ' note, with another
#   option's citation and with no sha256, at the set function and at the table;
#   'on' WITH the option's own citation is written and leaves an audit row with
#   the note and the actor; off and clear work;
# - the refused options stay refused, and the seven style options keep 'on',
#   'shadow' and 'canary' exactly as before. It enables nothing.
#
# It installs the style switch migration (20261113201841), the option switch
# migration (20261114072215, or OPTION_SWITCH_MIGRATION to prove the test fails
# without the guard) and then every FOLLOW-UP that re-asserts the switch lists
# (a later migration carrying the registry markers, in version order; see
# server/src/engine/HorseOptionSwitchMigrationLists.ts), plus any file named in
# OPTION_SWITCH_FOLLOW_UPS (space separated), on a local cluster in a temp
# directory that is removed on exit. With OPTION_SWITCH_MIGRATION set the
# repository's follow-ups are not applied, so they cannot put a guard back. It never touches a real database. CI runs it in the required
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
# The follow-ups: the newest one is the database whitelist the lists below must equal (the law checks them).
follow_ups=()
if [ -z "${OPTION_SWITCH_MIGRATION:-}" ]; then
  for f in "$repo"/supabase/migrations/*.sql; do
    [ "$(basename "$f")" \> "$(basename "$option_migration")" ] || continue
    grep -q -- '-- registry:plain-options:begin' "$f" && follow_ups+=("$f")
  done
fi
for f in ${OPTION_SWITCH_FOLLOW_UPS:-}; do follow_ups+=("$f"); done
for f in ${follow_ups[@]+"${follow_ups[@]}"}; do
  "${psql[@]}" -f "$f"
  echo "ok    follow-up $(basename "$f") installed"
done
if [ "${#follow_ups[@]}" -gt 0 ]; then
  # idempotent: the newest follow-up installed a second time changes nothing
  last="${follow_ups[$((${#follow_ups[@]} - 1))]}"
  before="$("${psql[@]}" -At -c "SELECT md5(string_agg(conname || pg_get_constraintdef(oid), '|' ORDER BY conname)) FROM pg_constraint WHERE conrelid = 'public.ca_horse_style_switch'::regclass")"
  "${psql[@]}" -f "$last"
  after="$("${psql[@]}" -At -c "SELECT md5(string_agg(conname || pg_get_constraintdef(oid), '|' ORDER BY conname)) FROM pg_constraint WHERE conrelid = 'public.ca_horse_style_switch'::regclass")"
  [ "$before" = "$after" ] && echo "ok    the newest follow-up installed twice changes nothing" || { echo "FAIL  the newest follow-up is not idempotent"; exit 1; }
fi

style='styleValueBettorNotManiac styleBigBetHonesty styleRaiseRespect styleTightReRaiserRespect styleFoldRatePreRepair styleValueExtraction styleFoldBluff'
plain='streetIQ handReading v7 v7Preflop v7Barrels v7SizeReads v7CounterAdapt v7AdaptiveMC v8 v8Draws v8HiLo v8Nlh v9 v9Sizing v9Timing decisionGravityTiming horseActionTimeIsPublicOnly omahaBetSizeByPublicState v9Mood v10 v10Cbet v10Spr v10Rake v10ThinValue v10Iso v11 v12 v12Ranges v12River v13 v15 v15Boats v16Reads v16Icm v16Hu v16Blockers v16SizeCond v16PloPolar v16Ratio v17Pos v17RiverProbe v17CatchBlock v17ShortDeck v18Straddle v18Squeeze v18SelfImage v18ExploitSize v18Families v20Multiway v20Mzone v21River v21Deep v23Endgame v23Plan v23Reads v23Variants v23ShortDeck v23Spin v24Bounty v24PloDefense v25PloTourney v26Prizes v27GtoCharts v29GtoFlop v30GtoTurnRiver v32FacingDefense v33DepthCeiling gtoV31CellContractV3Serving v37Satellite v38Ev v40Omaha holdemPremiumAggression holdemDominatedFold ploPairedBoardFold ploPairedBoardRiverCheck ploSuitedAcesFourBet v86PloOverhaul v87HoldemOverhaul v87RiverBlockBetTrap v87HollywoodTank v87FlopStabCheckRaise v46Charts v46ShortDeck v51RiverFlat v55OmahaRiverTripsFlat v56OmahaPressureRange v57TournamentAggression v61RiverOnePairShade v66BetRaisedOnePair v67RiverBetRaisedOnePair v88CommitmentHonored omahaSmallBlindSteal omahaTournamentFirstIn omahaHiLoTournamentFirstIn tokenCallPrice omahaRiverNutRaiseOnly omahaTurnSetPound omahaBeatenMadeHandDefense omahaBluffCatcherRaiseFold omahaReraisedPotDiscipline omahaReraisedPotStackOffFold omahaReraisedPotStackOffRealistic omahaReraisedFoldVsTight omahaEliteContinuesVsMeasuredWideThreeBettor omahaOopReraisedPotStrongRange omahaPreflopReraiseDefencePriced omahaPreflopReraiseDefencePricedInPosition omahaReraiseRangeOutOfPosition omahaReraiseRangeEarlyPosition omahaReraisedPotFlopContinueNeedsEquityShape omahaMadeHandDefenseVsValueLeader omahaBluffCatcherFoldVsValueLeader omahaRiverMediumBetStrongHandCalls omahaBigBetIsPotShare omahaPairedRiverNoThinLeadVsValueLeader omahaOverpairNoOopBarrelVsValueLeader omahaPairedTurnNoBarrelWithoutBoatVsValueLeader omahaPairedBoardFoldRespectsPrice omahaFlopFacingBetEv omahaReadIsByStreetAndTexture omahaTurnBetNeedsRiverPlan omahaPressureNeedsPostflopAggression omahaOopTurnCheckAfterFlopCall omahaBareOverpairOopFlopCheck omahaNoCallColdFourBetWithoutPremium omahaUnderpairNoMultiwayFlopContinue omahaMultiwayRiverCallNeedsStrength omahaNoRiverBluffIntoValueLeader omahaMultiwayWeakHandNoBet omahaVpipFloorByLimp vpipFloorLimpOnly lightningVpipFloorLimpOnly omahaReraisedPositionInLightning omahaManiacReRaiseWidthMeasured omahaCardImpact omahaFacingBetEv omahaTurnCallRealizationByRunout omahaTurnRiverRaiseNeedsNuts omahaStreetPlan omahaStreetPlanFlop omahaStreetPlanThreeWay omahaPreflopStackPlan omahaBigDrawAggression omahaNoDrawRaiseOutOfPosition omahaStrategyInTournaments omahaStrongHandSlowplayMix omahaTurnRiverRaiseIsPriced omahaDrawRaiseIsPriced omahaOopTurnBarrelIsPriced omahaPairedBoardBetIsPriced omahaBluffShareFromBetRate omahaFacingBetRangeIsContinuous omahaPressureIsPriced omahaBigBetCallsArePriced omahaUnderpairMultiwayIsPriced omahaPricedPriorsByOpponentKind omahaRaiseEvCountsLossesOnce omahaMadeHandBetIsPriced omahaTurnSetSizeIsPriced omahaBlockerBluffIsPriced omahaFlopBetIsPriced omahaPricedMix omahaPricedInLightning omahaSmallBetIsPriced horsePlayStyles omahaStrongHandValue omahaNutClassValueSize omahaValueSizeIsUnreadable omahaRiverNutBlockerBluffReachable omahaOnePairDiscipline holdemHeadsUpPostflopBalance plo6ManiacPriceRefusalToRangePlay plo6TopSetNutRealization plo6NoMultiwayBetWithWeakMadeHand omahaStrategyInPlo6 fixedLimitRiverFullBetRead fixedLimitHiLoNutLowRiverBet fixedLimitRiverOneBetValueRaise v64RiverRaiseNeedsTwoPair v63LargeRiverBetShade v74OmahaSemiBluffNeedsDraw v62RiverBettorPolarity v60CashPressure v65TurnOnePairShade v68TurnAirDrawCalls v69TurnCallGaps v70GtoOpeningRanges v71AnteAwarePushFold v72DefenceByOpener v73Vs3BetDefence v75SqueezeDefence v79TopPairWeakKicker v81OmahaBigBetCalls v15RiverNoNearLock v85CashAction lightningStyleReadSeparate styleStealTightBlinds styleTightPlayerExploit styleLongShownMemory holdemProfileCompletenessCap styleTightMultiSignal styleTightMethodLine holdemManiacSampleGate holdemManiacShortHandedReach holdemGearShiftReach holdemCallDownExcludesCurrentHand holdemCallDownNeedsStyleEvidence v84OmahaRiverReraiseCalls v83AggressionNeedsBluffs readPostflopFoldRate readShrinkResponse readBreakEvenBluff omahaEvFoldModel omahaNeutralUnknown omahaTightOpponent tournamentUtilityStackScaledMargin icmBustPaysPlace holdemRiverFullHouseValue omahaTightOpponentSteal readScopedShrink planFingerprint v80TopPairStrongKicker v78NoCommittingBluffRaise v70FacingOpenZone huBbDefendsToPrice huBbDefendsUnreadToPrice huOpenerDefendsToPrice huLimpDefendsToPrice huSmallBlindStealsVsTightBigBlind committedStackPricedIn holdemPersonaReRaiseMix holdemPersonaPostflop holdemPersonaPreflop nashCallVsJam aofClosingSeatNashCall nashPushFoldIcm facingOpenFullRingZone vs3BetShortStack omahaCommitZoneThreeBetPriceRelief fixedLimitCallIsNotACommitment fixedLimitReadIgnoresProbes fixedLimitHiLoLowHalfFloor fixedLimitPricedPreflop fixedLimitStealVsTightBlinds fixedLimitRiverStrongHandLeads fixedLimitOmahaNoPresumption fixedLimitBetsAreNeverProbes lightningParticipationHoldem lightningParticipationOmaha lightningEarlyFoldNeedsFoldThrough lightningCheapEntryHoldem lightningCheapEntryOmaha facingClosedAllIn limpReraiseIsoRead commitUnderPot v77SeatAwareJams v76RetireFourBetBluffBand v74NlhOpenSizes v52RangeAdvantage v53Pressure v58Plo6RiverNuts v59Plo6RiverUnpaired drawOutlookQuality committedRaiseDiscipline callDeductionPricing flopTurnBluffBaseline riverBluffBaseline riverLeadRange riverBluffHiLo riverBluffMultiway riverFastCalldown probeAwareAggression riverBluffFixedLimit riverBluffShortDeck riverBluffBombPot riverBluffMultiBoard v43Tempo v86UnblockedPreflop v86MultiStreetUnblocked'
offonly='v16Hu v17RiverProbe v23ShortDeck v24PloDefense v32FacingDefense v33DepthCeiling gtoV31CellContractV3Serving v46ShortDeck v55OmahaRiverTripsFlat omahaSmallBlindSteal omahaBeatenMadeHandDefense omahaBluffCatcherRaiseFold omahaReraisedPotDiscipline omahaReraisedFoldVsTight omahaPreflopReraiseDefencePriced omahaMultiwayRiverCallNeedsStrength omahaNoRiverBluffIntoValueLeader omahaStreetPlanFlop omahaPreflopStackPlan omahaPairedBoardBetIsPriced omahaRaiseEvCountsLossesOnce omahaMadeHandBetIsPriced omahaFlopBetIsPriced omahaPricedMix omahaOnePairDiscipline plo6TopSetNutRealization omahaStrategyInPlo6 fixedLimitRiverFullBetRead v62RiverBettorPolarity styleStealTightBlinds readPostflopFoldRate omahaNeutralUnknown omahaTightOpponent omahaTightOpponentSteal huBbDefendsToPrice huBbDefendsUnreadToPrice huOpenerDefendsToPrice huLimpDefendsToPrice huSmallBlindStealsVsTightBigBlind committedStackPricedIn holdemPersonaPreflop aofClosingSeatNashCall nashPushFoldIcm facingOpenFullRingZone vs3BetShortStack omahaCommitZoneThreeBetPriceRelief fixedLimitStealVsTightBlinds lightningParticipationOmaha lightningCheapEntryHoldem lightningCheapEntryOmaha commitUnderPot'
refused='comboDrawPressure v54RiverBluff riverPositionDefense riverBluffCheckRaise barrelContinuationOutlook smallPotNearNutRiverValue multiwayRiverBluffCheckRaise v53PloTourneyIcm phase8Postflop phase8PolicyFamily phase8CatastropheGuard phase10Plo4 phase11Omaha phase12Remaining phase13Joint phase14 phase14Corrective phase15Anything v87DeepDiveDiscipline v87ShouldSuppressOmahaPositionStab pillar2PositionStab v31GtoSuitAware solverRound7 heldOutPack vpipFloorDeepStackOff omahaPreflopCallWithActionBehind notAnOption leakMapRead telemetry observeMind mind v41Leaks'
authority_tail='OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md sha256 2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1'
is_offonly() { case " $offonly " in *" $1 "*) return 0;; *) return 1;; esac; }
on_count=0; off_count=0

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
expect_refusal() { # label, wanted fragment, statement
  local r; r="$(refusal "$3")"
  case "$r" in *"$2"*) check "$1" refused refused;; *) check "$1" refused "$r";; esac
}
for o in $plain; do
  own="authority: $o $authority_tail"
  other="authority: notThisOption $authority_tail"
  if is_offonly "$o"; then
    off_count=$((off_count + 1))
    check "$o (off-only) is offered off alone" "{off}" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
    expect_refusal "$o (off-only): the set function refuses on with a junk note" "does not support state on" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', 'try on')"
    expect_refusal "$o (off-only): the set function refuses on even with its own citation" "does not support state on" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', '$own')"
    expect_refusal "$o (off-only): the table refuses an on row from any writer, with its own citation" "ca_horse_style_switch_state_fits_option" "INSERT INTO public.ca_horse_style_switch (option, state, updated_by, note) VALUES ('$o', 'on', 'owner-role', '$own')"
    q "SELECT public.fn_ca_horse_option_switch_set('$o', 'off', 'fixture', 'rollback')" >/dev/null
    check "$o (off-only): off is written" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$o'")"
    expect_refusal "$o (off-only): the table refuses turning its off row on, with its own citation" "ca_horse_style_switch_state_fits_option" "UPDATE public.ca_horse_style_switch SET state = 'on', note = '$own' WHERE option = '$o'"
    q "SELECT public.fn_ca_horse_option_switch_clear('$o', 'fixture', 'clear')" >/dev/null
    check "$o (off-only): clear removes the row" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch WHERE option = '$o'")"
    continue
  fi
  on_count=$((on_count + 1))
  check "$o is offered off and on" "{off,on}" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
  expect_refusal "$o: the set function refuses on with a junk note" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', 'try on')"
  expect_refusal "$o: the set function refuses on with no note" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', NULL)"
  expect_refusal "$o: the set function refuses on with a generic authority note" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', 'authority: 0123456789abc')"
  expect_refusal "$o: the set function refuses on with the blanket authority (no option named)" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', 'authority: $authority_tail')"
  expect_refusal "$o: the set function refuses on with another option's citation" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', '$other')"
  expect_refusal "$o: the set function refuses on with its name and no sha256" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', 'authority: $o OWNER-MESSAGE.md')"
  expect_refusal "$o: the table refuses an on row without a note from any writer" "ca_horse_style_switch_on_cites_authority" "INSERT INTO public.ca_horse_style_switch (option, state, updated_by) VALUES ('$o', 'on', 'owner-role')"
  expect_refusal "$o: the table refuses an on row citing another option from any writer" "ca_horse_style_switch_on_cites_authority" "INSERT INTO public.ca_horse_style_switch (option, state, updated_by, note) VALUES ('$o', 'on', 'owner-role', '$other')"
  r="$(refusal "SELECT public.fn_ca_horse_style_switch_set('$o', 'on', 'fixture', 'old setter')")"
  [ "$r" = WROTE ] && check "$o: the old style setter refuses it" refused WROTE || check "$o: the old style setter refuses it" refused refused
  q "SELECT public.fn_ca_horse_option_switch_set('$o', 'off', 'fixture', 'rollback')" >/dev/null
  check "$o: off is written" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$o'")"
  expect_refusal "$o: the table refuses turning its off row on without its own citation" "ca_horse_style_switch_on_cites_authority" "UPDATE public.ca_horse_style_switch SET state = 'on' WHERE option = '$o'"
  q "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', '$own')" >/dev/null
  check "$o: on with its own citation is written" "on|$own" "$(q "SELECT state || '|' || note FROM public.ca_horse_style_switch WHERE option = '$o'")"
  q "SELECT public.fn_ca_horse_option_switch_clear('$o', 'fixture', 'clear')" >/dev/null
  check "$o: clear removes the row" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch WHERE option = '$o'")"
done
check "the off-only options are the listed ones" "$(set -- $offonly; echo $#)" "$off_count"
check "every off, on and clear wrote one audit row; no refused on wrote one" \
  "$((audit_before + 3 * on_count + 2 * off_count))" "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit")"
check "every audit row of an on for a non-style option carries that option's own citation" "$on_count|0" \
  "$(q "SELECT count(*) FILTER (WHERE note = 'authority: ' || option || ' $authority_tail') || '|' || count(*) FILTER (WHERE note IS DISTINCT FROM 'authority: ' || option || ' $authority_tail') FROM public.ca_horse_style_switch_audit WHERE new_state = 'on' AND option NOT IN ('$(echo $style | sed "s/ /','/g")')")"
check "no audit row records on for an off-only option" "0" \
  "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit WHERE new_state = 'on' AND option IN ('$(echo $offonly | sed "s/ /','/g")')")"
check "the audit rows name their actor" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit WHERE changed_by IS DISTINCT FROM 'fixture'")"

for o in $refused; do
  check "$o is not switchable" "" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
  for s in on off; do
    r="$(refusal "SELECT public.fn_ca_horse_option_switch_set('$o', '$s', 'fixture', 'authority: $o $authority_tail')")"
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
q "SELECT public.fn_ca_horse_option_switch_set('readScopedShrink', 'on', 'fixture', 'authority: readScopedShrink $authority_tail')" >/dev/null
q "SELECT public.fn_ca_horse_option_switch_clear('readScopedShrink', 'fixture', 'read')" >/dev/null
check "the wide read names the off row and no cleared row" '{"v16Hu": "off"}' "$(q "SELECT public.fn_ca_horse_option_switch_effective()->'options'")"

# THE EVIDENCE RECORD (migration *_the_horse_option_switch_on_needs_a_recorded_evidence_row.sql): installed after
# the assertions above, which prove the switch as first installed. From here 'on' for a non-style option also needs
# the sha256 its note cites to be recorded for that option. Not applied with OPTION_SWITCH_MIGRATION set.
if [ -z "${OPTION_SWITCH_MIGRATION:-}" ]; then
  # the live case: a NON-style option is already ON (written under the earlier rule) when this migration installs
  q "SELECT public.fn_ca_horse_option_switch_set('readShrinkResponse', 'on', 'fixture', 'authority: readShrinkResponse $authority_tail')" >/dev/null
  evidence_migration="$(ls "$repo"/supabase/migrations/*_the_horse_option_switch_on_needs_a_recorded_evidence_row.sql)"
  "${psql[@]}" -f "$evidence_migration"
  "${psql[@]}" -f "$evidence_migration"
  echo "ok    evidence record $(basename "$evidence_migration") installed (twice)"
  sha_a='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  sha_b='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  sha_c='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
  ev='readScopedShrink'
  check "the style row survives the evidence migration" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'styleFoldBluff'")"
  # the migration never touches the table: the earlier non-style row stays on, and clearing it still works
  check "a non-style on row written before the evidence migration survives it" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'readShrinkResponse'")"
  q "SELECT public.fn_ca_horse_option_switch_clear('readShrinkResponse', 'fixture', 'after the survival check')" >/dev/null
  expect_refusal "$ev: on with a well-formed citation and no evidence row is refused" "only after its evidence is recorded" "SELECT public.fn_ca_horse_option_switch_set('$ev', 'on', 'fixture', 'authority: $ev docs/x.md sha256 $sha_a')"
  expect_refusal "$ev: on with a junk note is still refused first" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$ev', 'on', 'fixture', 'try on')"
  q "SELECT public.fn_ca_horse_option_switch_record_evidence('$ev', 'docs/x.md', '$sha_a', 'evidence', 'Hand Analysis ACCEPT fixture', 'abcdef1', 'fixture')" >/dev/null
  q "SELECT public.fn_ca_horse_option_switch_set('$ev', 'on', 'fixture', 'authority: $ev docs/x.md sha256 $sha_a')" >/dev/null
  check "$ev: on with a recorded evidence row is written" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$ev'")"
  q "SELECT public.fn_ca_horse_option_switch_set('$ev', 'off', 'fixture', 'rollback')" >/dev/null
  check "$ev: off needs no evidence" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$ev'")"
  expect_refusal "$ev: on citing a sha256 that is not recorded is refused" "only after its evidence is recorded" "SELECT public.fn_ca_horse_option_switch_set('$ev', 'on', 'fixture', 'authority: $ev docs/x.md sha256 $sha_b')"
  q "SELECT public.fn_ca_horse_option_switch_record_evidence('$ev', 'docs/x.md', '$sha_b', 'owner_forced', 'OWNER (verbatim): fixture order', NULL, 'fixture')" >/dev/null
  q "SELECT public.fn_ca_horse_option_switch_set('$ev', 'on', 'fixture', 'authority: $ev docs/x.md sha256 $sha_b')" >/dev/null
  check "$ev: on with an owner-forced record is written" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$ev'")"
  q "SELECT public.fn_ca_horse_option_switch_clear('$ev', 'fixture', 'clear')" >/dev/null
  check "$ev: clear needs no evidence" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch WHERE option = '$ev'")"
  expect_refusal "an evidence row of another option does not open this one" "only after its evidence is recorded" "SELECT public.fn_ca_horse_option_switch_set('handReading', 'on', 'fixture', 'authority: handReading docs/x.md sha256 $sha_a')"
  expect_refusal "the record refuses an off-only option" "is off-only" "SELECT public.fn_ca_horse_option_switch_record_evidence('commitUnderPot', 'docs/x.md', '$sha_c', 'evidence', 'ref', NULL, 'fixture')"
  expect_refusal "the record refuses an unregistered option" "not a switchable option" "SELECT public.fn_ca_horse_option_switch_record_evidence('notAnOption', 'docs/x.md', '$sha_c', 'evidence', 'ref', NULL, 'fixture')"
  expect_refusal "the record refuses a style option" "is a style option" "SELECT public.fn_ca_horse_option_switch_record_evidence('styleFoldBluff', 'docs/x.md', '$sha_c', 'evidence', 'ref', NULL, 'fixture')"
  expect_refusal "the record refuses an empty reference" "a reference is required" "SELECT public.fn_ca_horse_option_switch_record_evidence('$ev', 'docs/x.md', '$sha_c', 'evidence', '  ', NULL, 'fixture')"
  expect_refusal "the record refuses another kind" "evidence or owner_forced" "SELECT public.fn_ca_horse_option_switch_record_evidence('$ev', 'docs/x.md', '$sha_c', 'approved', 'ref', NULL, 'fixture')"
  expect_refusal "the record refuses a malformed sha256" "64 lowercase hex" "SELECT public.fn_ca_horse_option_switch_record_evidence('$ev', 'docs/x.md', 'ABC', 'evidence', 'ref', NULL, 'fixture')"
  expect_refusal "the record refuses the same file twice" "already recorded" "SELECT public.fn_ca_horse_option_switch_record_evidence('$ev', 'docs/x.md', '$sha_a', 'evidence', 'ref', NULL, 'fixture')"
  expect_refusal "an off-only option stays refused with any note" "does not support state on" "SELECT public.fn_ca_horse_option_switch_set('commitUnderPot', 'on', 'fixture', 'authority: commitUnderPot docs/x.md sha256 $sha_a')"
  expect_refusal "service_role cannot write the evidence table directly" "permission denied" "SET ROLE service_role; INSERT INTO public.ca_horse_option_switch_evidence (option, evidence_path, evidence_sha256, kind, reference, recorded_by) VALUES ('$ev', 'docs/x.md', '$sha_c', 'evidence', 'ref', 'fixture')"
  expect_refusal "anon cannot record evidence" "permission denied" "SET ROLE anon; SELECT public.fn_ca_horse_option_switch_record_evidence('$ev', 'docs/x.md', '$sha_c', 'evidence', 'ref', NULL, 'fixture')"
  q "SELECT public.fn_ca_horse_option_switch_set('styleFoldBluff', 'shadow', 'fixture', 'style')" >/dev/null
  q "SELECT public.fn_ca_horse_option_switch_set('styleFoldBluff', 'on', 'fixture', 'style')" >/dev/null
  check "a style option still goes on without an evidence row" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'styleFoldBluff'")"
  check "the evidence rows are the two recorded" "2" "$(q "SELECT count(*) FROM public.ca_horse_option_switch_evidence")"
fi

if [ "$fail" = 0 ]; then
  echo 'PASS  every option switch evidence assertion held'
else
  echo 'FAIL  the option switch accepts on for an off-only option or without the option own citation, or lost on, off, clear, audit or a refusal'
  exit 1
fi
