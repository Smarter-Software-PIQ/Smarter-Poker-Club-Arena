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
#   'shadow' and 'canary' exactly as before. It enables nothing;
# - (2026-11-18) a listed SHADOW option is offered off, shadow and on: shadow is
#   written and read back in the wide read (never in the style read), and its
#   'on' keeps every rule above (own citation, recorded evidence); any other
#   non-style option is refused shadow and canary, at the set function and at
#   the table.
# - (2026-11-19) a listed ON_SHADOW option (every shadow option, and the 'code'
#   options that are not off-only and are read per decision) is offered
#   on_shadow before on: on_shadow keeps every rule of on (own citation at the
#   set function and at the table, recorded evidence), is written and read back
#   in the wide read (never in the style read); an off-only option, a style
#   option, a refused option and any other non-style option are refused
#   on_shadow, at the set function and at the table; and the serving-registry
#   guard refuses on_shadow when the fresh serving registry does not list it
#   for the option (*_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql).
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
# Installed in version order, as production installs them, together with the two migrations that replace the
# switch's write functions between them: the evidence record (*_the_horse_option_switch_on_needs_a_recorded_
# evidence_row.sql) and the style-by-canary read (*_the_horse_option_switch_tells_style_options_by_name.sql), so a
# follow-up that names shadow options is proven against the set function production runs.
follow_ups=()
last_list=''
if [ -z "${OPTION_SWITCH_MIGRATION:-}" ]; then
  for f in "$repo"/supabase/migrations/*.sql; do
    [ "$(basename "$f")" \> "$(basename "$option_migration")" ] || continue
    if grep -q -- '-- registry:plain-options:begin' "$f"; then
      follow_ups+=("$f"); last_list="$f"
    else
      case "$(basename "$f")" in
        *_the_horse_option_switch_on_needs_a_recorded_evidence_row.sql|*_the_horse_option_switch_refuses_what_the_serving_engine_does.sql|*_the_horse_option_switch_tells_style_options_by_name.sql|*_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql)
          follow_ups+=("$f");;
      esac
    fi
  done
fi
for f in ${OPTION_SWITCH_FOLLOW_UPS:-}; do follow_ups+=("$f"); last_list="$f"; done
for f in ${follow_ups[@]+"${follow_ups[@]}"}; do
  "${psql[@]}" -f "$f"
  echo "ok    follow-up $(basename "$f") installed"
done
if [ -n "$last_list" ]; then
  # idempotent: the newest follow-up installed a second time changes nothing
  last="$last_list"
  before="$("${psql[@]}" -At -c "SELECT md5(string_agg(conname || pg_get_constraintdef(oid), '|' ORDER BY conname)) FROM pg_constraint WHERE conrelid = 'public.ca_horse_style_switch'::regclass")"
  "${psql[@]}" -f "$last"
  after="$("${psql[@]}" -At -c "SELECT md5(string_agg(conname || pg_get_constraintdef(oid), '|' ORDER BY conname)) FROM pg_constraint WHERE conrelid = 'public.ca_horse_style_switch'::regclass")"
  [ "$before" = "$after" ] && echo "ok    the newest follow-up installed twice changes nothing" || { echo "FAIL  the newest follow-up is not idempotent"; exit 1; }
  # A switch list is never stale (2026-11-20): a stamped follow-up refuses to install over a newer stamp. The newest
  # follow-up with its own version replaced by an older one stands in for a list migration installed out of order.
  stamp="$(grep -o -- '-- registry-lists-version: [0-9]\{14\}' "$last" | grep -o '[0-9]\{14\}' || true)"
  if [ -n "$stamp" ]; then
    sed "s/$stamp/00000000000001/g" "$last" > "$work/older-list.sql"
    if "${psql[@]}" -f "$work/older-list.sql" 2>"$work/older-list.err"; then
      echo "FAIL  an older switch list installed over the newer list $stamp"; exit 1
    fi
    grep -q "is older than the installed list $stamp" "$work/older-list.err" \
      && echo "ok    an older switch list is refused over the newer list $stamp" \
      || { cat "$work/older-list.err"; echo "FAIL  the older list failed for another reason"; exit 1; }
    after_older="$("${psql[@]}" -At -c "SELECT md5(string_agg(conname || pg_get_constraintdef(oid), '|' ORDER BY conname)) FROM pg_constraint WHERE conrelid = 'public.ca_horse_style_switch'::regclass")"
    [ "$after_older" = "$after" ] || { echo "FAIL  the refused older list changed the constraints"; exit 1; }
  fi
fi

style='styleValueBettorNotManiac styleBigBetHonesty styleRaiseRespect styleTightReRaiserRespect styleFoldRatePreRepair styleValueExtraction styleFoldBluff'
plain='streetIQ handReading v7 v7Preflop v7Barrels v7SizeReads v7CounterAdapt v7AdaptiveMC v8 v8Draws v8HiLo v8Nlh v9 v9Sizing v9Timing decisionGravityTiming horseActionTimeIsPublicOnly omahaBetSizeByPublicState v9Mood v10 v10Cbet v10Spr v10Rake v10ThinValue v10Iso v11 v12 v12Ranges v12River v13 v15 v15Boats v16Reads v16Icm v16Hu v16Blockers v16SizeCond v16PloPolar v16Ratio v17Pos v17RiverProbe v17CatchBlock v17ShortDeck v18Straddle v18Squeeze v18SelfImage v18ExploitSize v18Families v20Multiway v20Mzone v21River v21Deep v23Endgame v23Plan v23Reads v23Variants v23ShortDeck v23Spin v24Bounty v24PloDefense v25PloTourney v26Prizes v27GtoCharts v29GtoFlop v30GtoTurnRiver v32FacingDefense v33DepthCeiling gtoV31CellContractV3Serving v37Satellite v38Ev v40Omaha holdemPremiumAggression holdemDominatedFold ploPairedBoardFold ploPairedBoardRiverCheck ploSuitedAcesFourBet v86PloOverhaul v87HoldemOverhaul v87RiverBlockBetTrap v87HollywoodTank v87FlopStabCheckRaise v46Charts v46ShortDeck v51RiverFlat v55OmahaRiverTripsFlat v56OmahaPressureRange v57TournamentAggression v61RiverOnePairShade v66BetRaisedOnePair v67RiverBetRaisedOnePair v88CommitmentHonored omahaSmallBlindSteal omahaTournamentFirstIn omahaHiLoTournamentFirstIn tokenCallPrice omahaRiverNutRaiseOnly omahaTurnSetPound omahaCurrentNutsRaise omahaBeatenMadeHandDefense omahaBluffCatcherRaiseFold omahaReraisedPotDiscipline omahaReraisedPotStackOffFold omahaReraisedPotStackOffRealistic omahaReraisedFoldVsTight omahaEliteContinuesVsMeasuredWideThreeBettor omahaOopReraisedPotStrongRange omahaPreflopReraiseDefencePriced omahaPreflopReraiseDefencePricedInPosition omahaReraiseRangeOutOfPosition omahaReraisedCallVsRaisePriced omahaPreflopJamFacingReraiseIsPriced omahaReraiseRangeEarlyPosition omahaReraisedPotFlopContinueNeedsEquityShape omahaMadeHandDefenseVsValueLeader omahaBluffCatcherFoldVsValueLeader omahaRiverMediumBetStrongHandCalls omahaBigBetIsPotShare omahaPairedRiverNoThinLeadVsValueLeader omahaOverpairNoOopBarrelVsValueLeader omahaPairedTurnNoBarrelWithoutBoatVsValueLeader omahaPairedBoardFoldRespectsPrice omahaFlopDefenceIsPriced omahaFacingBetIsPricedByEquity omahaBandFallbackInBandUnit omahaTurnStrongHandRealizationIsMeasured omahaBetReadIsPerOpponent omahaFacingBetPaysTheWholeDeduction omahaMathCoreNetsTheWholeDeduction omahaColdCallOutsideBigBlindIsMeasured omahaOpenNeedsMeasuredStrength omahaAcesReraiseIsMeasured omahaReraiseRangeIsMeasured omahaNoMadeClassCap omahaBetReadIsModeSplit omahaRundownReraiseRangeIsMeasured omahaRundownReraiseRangeTrial omahaClassCapsRespectEquity omahaMathCorePlo4Flop omahaMathCorePlo4Turn omahaMathCorePlo4River omahaMathCorePlo5Flop omahaMathCorePlo5Turn omahaMathCorePlo5River omahaMathCorePreflop omahaMathCore omahaFlopFacingBetEv omahaFlopVerdictReadsTheBettor omahaFourBetFoldPricedCall omahaStabDefenceIsPriced omahaStrongHandCheckIsPriced omahaCbetRaiseIsPriced omahaRiverCheckedToBetIsMeasured omahaRiverFirstToActBetIsPriced omahaOpponentLifetimeHud omahaOpponentLifetimeHudDecides omahaPreflopReadIsPricedFromLifetime omahaBigBetSizeIsPriced omahaRiverCurrentNutsCallFloor omahaFacingBetValueShareIsMeasured omahaReadIsByStreetAndTexture omahaTurnBetNeedsRiverPlan omahaPressureNeedsPostflopAggression omahaOopTurnCheckAfterFlopCall omahaBareOverpairOopFlopCheck omahaNoCallColdFourBetWithoutPremium omahaUnderpairNoMultiwayFlopContinue omahaMultiwayRiverCallNeedsStrength omahaNoRiverBluffIntoValueLeader omahaMultiwayWeakHandNoBet omahaVpipFloorByLimp vpipFloorLimpOnly vpipFloorLimpOnlyTenHandWindow lightningVpipFloorLimpOnly omahaReraisedPositionInLightning omahaManiacReRaiseWidthMeasured omahaCardImpact omahaFacingBetEv omahaTurnStabDefenceIsPriced omahaTurnStabLightningRow omahaTurnCallRealizationByRunout omahaFacingBetEvShownField omahaRiverBluffCatchIsPriced omahaFacingBetValueIsRangeRelative omahaPairedBoardRiverIsPriced omahaTurnRiverRaiseNeedsNuts omahaStreetPlan omahaStreetPlanFlop omahaStreetPlanThreeWay omahaPreflopStackPlan omahaBigDrawAggression omahaBigDrawBetIsPricedOnHisResponse omahaNoDrawRaiseOutOfPosition omahaStrategyInTournaments omahaNoCategoricalRules omahaBlanketRowsOffInPlo45Cash omahaTournamentsExcludeCategoricalRules omahaStrongHandSlowplayMix omahaTurnRiverRaiseIsPriced omahaDrawRaiseIsPriced omahaOopTurnBarrelIsPriced omahaPairedBoardBetIsPriced omahaPackEffectiveDepth omahaPackClampDeepDepth omahaBluffShareFromBetRate omahaFacingBetRangeIsContinuous omahaPressureIsPriced omahaBigBetCallsArePriced omahaUnderpairMultiwayIsPriced omahaPricedPriorsByOpponentKind omahaRaiseEvCountsLossesOnce omahaSampledRaiseIsPricedAtEverySize omahaBluffIsPricedAgainstTheTarget omahaMultiwayIsPricedInTournaments omahaMadeHandBetIsPriced omahaTurnSetSizeIsPriced omahaBlockerBluffIsPriced omahaFlopBetPricesTheRaise omahaFlopBetUsesMeasuredFoldShare omahaFoldModelFittedOnPeople omahaFlopBetIsPriced omahaFlopBetIsPricedOnHisResponse omahaPricedMix omahaPricedInLightning omahaSlowplayMixInLightning omahaPublicBetSizeInLightning omahaSmallBetIsPriced omahaCheckedToBetIsPriced omahaCheckedToBetResponseIsMeasured omahaCheckedToBetInLightning omahaMultiwayCheckedToBetIsPriced horseRiverNoBlockerBet horsePlayStyles omahaStrongHandValue omahaNutClassValueSize omahaValueSizeIsUnreadable omahaRiverNutBlockerBluffReachable omahaOnePairDiscipline holdemHeadsUpPostflopBalance plo6ManiacPriceRefusalToRangePlay plo6TopSetNutRealization plo6FacingBetIsPriced plo6NoMultiwayBetWithWeakMadeHand omahaStrategyInPlo6 fixedLimitRiverFullBetRead fixedLimitHiLoNutLowRiverBet fixedLimitRiverOneBetValueRaise v64RiverRaiseNeedsTwoPair v63LargeRiverBetShade v74OmahaSemiBluffNeedsDraw v62RiverBettorPolarity v60CashPressure v65TurnOnePairShade v68TurnAirDrawCalls v69TurnCallGaps v70GtoOpeningRanges v71AnteAwarePushFold v72DefenceByOpener v73Vs3BetDefence v75SqueezeDefence v79TopPairWeakKicker v81OmahaBigBetCalls v15RiverNoNearLock v85CashAction lightningStyleReadSeparate styleStealTightBlinds styleTightPlayerExploit styleLongShownMemory holdemProfileCompletenessCap styleTightMultiSignal styleTightMethodLine holdemManiacSampleGate holdemManiacShortHandedReach holdemGearShiftReach styleShiftReleaseIsNoiseAware holdemCallDownExcludesCurrentHand holdemCallDownNeedsStyleEvidence v84OmahaRiverReraiseCalls v83AggressionNeedsBluffs readPostflopFoldRate readShrinkResponse readBreakEvenBluff omahaEvFoldModel omahaEvFoldModelHeadsUp omahaEvFoldModelSkipsPlo45 omahaNeutralUnknown omahaTightOpponent tournamentUtilityStackScaledMargin icmBustPaysPlace holdemRiverFullHouseValue holdemRiverFullHouseValueIsPriced holdemValueAndCallsArePriced holdemCommittedNoPairIsPriced holdemDangerBoardEquityIsPriced omahaTightOpponentSteal readScopedShrink planFingerprint v80TopPairStrongKicker v78NoCommittingBluffRaise v70FacingOpenZone huBbDefendsToPrice huBbDefendsUnreadToPrice huOpenerDefendsToPrice huLimpDefendsToPrice huSmallBlindStealsVsTightBigBlind committedStackPricedIn holdemPersonaReRaiseMix holdemPersonaPostflop holdemPersonaPreflop nashCallVsJam aofClosingSeatNashCall holdemTournamentAllInCallIsPriced nashPushFoldIcm facingOpenFullRingZone vs3BetShortStack omahaCommitZoneThreeBetPriceRelief fixedLimitCallIsNotACommitment fixedLimitReadIgnoresProbes fixedLimitHiLoLowHalfFloor fixedLimitPricedPreflop fixedLimitStealVsTightBlinds fixedLimitRiverStrongHandLeads fixedLimitOmahaNoPresumption fixedLimitBetsAreNeverProbes lightningParticipationHoldem lightningParticipationOmaha lightningEarlyFoldNeedsFoldThrough lightningCheapEntryHoldem lightningCheapEntryOmaha facingClosedAllIn limpReraiseIsoRead commitUnderPot v77SeatAwareJams v76RetireFourBetBluffBand v74NlhOpenSizes v52RangeAdvantage v53Pressure v58Plo6RiverNuts v59Plo6RiverUnpaired drawOutlookQuality committedRaiseDiscipline callDeductionPricing flopTurnBluffBaseline riverBluffBaseline riverLeadRange riverBluffHiLo riverBluffMultiway riverFastCalldown probeAwareAggression riverBluffFixedLimit riverBluffShortDeck riverBluffBombPot riverBluffMultiBoard v43Tempo v86UnblockedPreflop v86MultiStreetUnblocked omahaRiverBetFoldIsHisRecord'
offonly='v16Hu v17RiverProbe v23ShortDeck v24PloDefense v32FacingDefense v33DepthCeiling gtoV31CellContractV3Serving v46ShortDeck v55OmahaRiverTripsFlat omahaSmallBlindSteal omahaBeatenMadeHandDefense omahaBluffCatcherRaiseFold omahaReraisedPotDiscipline omahaReraisedFoldVsTight omahaPreflopReraiseDefencePriced omahaReraisedPotFlopContinueNeedsEquityShape omahaFlopDefenceIsPriced omahaFacingBetIsPricedByEquity omahaFlopVerdictReadsTheBettor omahaFacingBetValueShareIsMeasured omahaMultiwayRiverCallNeedsStrength omahaNoRiverBluffIntoValueLeader omahaFacingBetValueIsRangeRelative omahaPairedBoardRiverIsPriced omahaStreetPlanFlop omahaPreflopStackPlan omahaPairedBoardBetIsPriced omahaBluffShareFromBetRate omahaPricedPriorsByOpponentKind omahaRaiseEvCountsLossesOnce omahaBluffIsPricedAgainstTheTarget omahaMultiwayIsPricedInTournaments omahaMadeHandBetIsPriced omahaFlopBetPricesTheRaise omahaFlopBetUsesMeasuredFoldShare omahaFoldModelFittedOnPeople omahaFlopBetIsPriced omahaPricedMix omahaSmallBetIsPriced omahaCheckedToBetIsPriced omahaMultiwayCheckedToBetIsPriced omahaNutClassValueSize omahaOnePairDiscipline plo6TopSetNutRealization plo6NoMultiwayBetWithWeakMadeHand omahaStrategyInPlo6 fixedLimitRiverFullBetRead v62RiverBettorPolarity styleStealTightBlinds readPostflopFoldRate omahaNeutralUnknown omahaTightOpponent holdemCommittedNoPairIsPriced holdemDangerBoardEquityIsPriced omahaTightOpponentSteal huBbDefendsToPrice huOpenerDefendsToPrice huLimpDefendsToPrice huSmallBlindStealsVsTightBigBlind committedStackPricedIn holdemPersonaPreflop aofClosingSeatNashCall nashPushFoldIcm facingOpenFullRingZone vs3BetShortStack omahaCommitZoneThreeBetPriceRelief fixedLimitCallIsNotACommitment fixedLimitPricedPreflop fixedLimitStealVsTightBlinds lightningParticipationHoldem lightningParticipationOmaha lightningCheapEntryHoldem lightningCheapEntryOmaha commitUnderPot'
shadow='streetIQ handReading v7 v7Preflop v7SizeReads v8 v9 v9Sizing v9Timing decisionGravityTiming horseActionTimeIsPublicOnly v9Mood v10 v10Cbet v10Spr v10Rake v10ThinValue v10Iso v11 v12 v12Ranges v12River v13 v15 v16Reads v16Icm v16Blockers v16SizeCond v16PloPolar v16Ratio v17Pos v17CatchBlock v17ShortDeck v18Straddle v18Squeeze v18SelfImage v18ExploitSize v18Families v20Multiway v20Mzone v21River v21Deep v23Endgame v23Plan v23Reads v23Variants v23Spin v24Bounty v25PloTourney v26Prizes v27GtoCharts v29GtoFlop v30GtoTurnRiver v37Satellite v38Ev v40Omaha holdemPremiumAggression holdemDominatedFold ploPairedBoardFold ploPairedBoardRiverCheck ploSuitedAcesFourBet v86PloOverhaul v87HoldemOverhaul v87RiverBlockBetTrap v87HollywoodTank v87FlopStabCheckRaise v46Charts v51RiverFlat v56OmahaPressureRange v57TournamentAggression v61RiverOnePairShade v66BetRaisedOnePair v67RiverBetRaisedOnePair v88CommitmentHonored omahaTournamentFirstIn omahaHiLoTournamentFirstIn tokenCallPrice omahaRiverNutRaiseOnly omahaTurnSetPound omahaCurrentNutsRaise omahaReraisedPotStackOffFold omahaReraisedPotStackOffRealistic omahaReraisedCallVsRaisePriced omahaPreflopJamFacingReraiseIsPriced omahaNoMadeClassCap omahaMathCorePlo5Flop omahaFourBetFoldPricedCall omahaStabDefenceIsPriced omahaStrongHandCheckIsPriced omahaCbetRaiseIsPriced omahaRiverCheckedToBetIsMeasured omahaRiverFirstToActBetIsPriced omahaOpponentLifetimeHudDecides omahaPreflopReadIsPricedFromLifetime omahaBigBetSizeIsPriced omahaRiverCurrentNutsCallFloor omahaTurnStabDefenceIsPriced omahaTurnStabLightningRow omahaFacingBetEvShownField omahaRiverBluffCatchIsPriced omahaBigDrawBetIsPricedOnHisResponse omahaNoCategoricalRules omahaBlanketRowsOffInPlo45Cash omahaTournamentsExcludeCategoricalRules omahaTurnRiverRaiseIsPriced omahaDrawRaiseIsPriced omahaOopTurnBarrelIsPriced omahaFacingBetRangeIsContinuous omahaPressureIsPriced omahaBigBetCallsArePriced omahaUnderpairMultiwayIsPriced omahaSampledRaiseIsPricedAtEverySize omahaTurnSetSizeIsPriced omahaBlockerBluffIsPriced omahaFlopBetIsPricedOnHisResponse omahaPricedInLightning omahaSlowplayMixInLightning omahaPublicBetSizeInLightning omahaCheckedToBetResponseIsMeasured omahaCheckedToBetInLightning horsePlayStyles plo6ManiacPriceRefusalToRangePlay fixedLimitHiLoNutLowRiverBet fixedLimitRiverOneBetValueRaise v64RiverRaiseNeedsTwoPair v63LargeRiverBetShade v74OmahaSemiBluffNeedsDraw v60CashPressure v65TurnOnePairShade v68TurnAirDrawCalls v69TurnCallGaps v70GtoOpeningRanges v71AnteAwarePushFold v72DefenceByOpener v73Vs3BetDefence v75SqueezeDefence v79TopPairWeakKicker v81OmahaBigBetCalls v15RiverNoNearLock v85CashAction styleTightPlayerExploit styleTightMultiSignal styleTightMethodLine holdemManiacSampleGate holdemManiacShortHandedReach holdemGearShiftReach holdemCallDownExcludesCurrentHand holdemCallDownNeedsStyleEvidence v84OmahaRiverReraiseCalls v83AggressionNeedsBluffs readShrinkResponse readBreakEvenBluff omahaEvFoldModel omahaEvFoldModelSkipsPlo45 holdemRiverFullHouseValue holdemRiverFullHouseValueIsPriced holdemValueAndCallsArePriced readScopedShrink planFingerprint v80TopPairStrongKicker v78NoCommittingBluffRaise v70FacingOpenZone huBbDefendsUnreadToPrice holdemPersonaReRaiseMix holdemPersonaPostflop nashCallVsJam holdemTournamentAllInCallIsPriced fixedLimitReadIgnoresProbes fixedLimitHiLoLowHalfFloor fixedLimitRiverStrongHandLeads fixedLimitOmahaNoPresumption facingClosedAllIn limpReraiseIsoRead v77SeatAwareJams v76RetireFourBetBluffBand v74NlhOpenSizes v52RangeAdvantage v53Pressure v58Plo6RiverNuts v59Plo6RiverUnpaired drawOutlookQuality committedRaiseDiscipline callDeductionPricing flopTurnBluffBaseline riverBluffBaseline riverLeadRange riverBluffHiLo riverBluffMultiway riverFastCalldown probeAwareAggression riverBluffFixedLimit riverBluffShortDeck riverBluffBombPot riverBluffMultiBoard v43Tempo v86UnblockedPreflop v86MultiStreetUnblocked omahaRiverBetFoldIsHisRecord'
onshadow='streetIQ handReading v7 v7Preflop v7Barrels v7SizeReads v7CounterAdapt v7AdaptiveMC v8 v8Draws v8HiLo v8Nlh v9 v9Sizing v9Timing decisionGravityTiming horseActionTimeIsPublicOnly omahaBetSizeByPublicState v9Mood v10 v10Cbet v10Spr v10Rake v10ThinValue v10Iso v11 v12 v12Ranges v12River v13 v15 v15Boats v16Reads v16Icm v16Blockers v16SizeCond v16PloPolar v16Ratio v17Pos v17CatchBlock v17ShortDeck v18Straddle v18Squeeze v18SelfImage v18ExploitSize v18Families v20Multiway v20Mzone v21River v21Deep v23Endgame v23Plan v23Reads v23Variants v23Spin v24Bounty v25PloTourney v26Prizes v27GtoCharts v29GtoFlop v30GtoTurnRiver v37Satellite v38Ev v40Omaha holdemPremiumAggression holdemDominatedFold ploPairedBoardFold ploPairedBoardRiverCheck ploSuitedAcesFourBet v86PloOverhaul v87HoldemOverhaul v87RiverBlockBetTrap v87HollywoodTank v87FlopStabCheckRaise v46Charts v51RiverFlat v56OmahaPressureRange v57TournamentAggression v61RiverOnePairShade v66BetRaisedOnePair v67RiverBetRaisedOnePair v88CommitmentHonored omahaTournamentFirstIn omahaHiLoTournamentFirstIn tokenCallPrice omahaRiverNutRaiseOnly omahaTurnSetPound omahaCurrentNutsRaise omahaReraisedPotStackOffFold omahaReraisedPotStackOffRealistic omahaEliteContinuesVsMeasuredWideThreeBettor omahaOopReraisedPotStrongRange omahaPreflopReraiseDefencePricedInPosition omahaReraiseRangeOutOfPosition omahaReraisedCallVsRaisePriced omahaPreflopJamFacingReraiseIsPriced omahaReraiseRangeEarlyPosition omahaMadeHandDefenseVsValueLeader omahaBluffCatcherFoldVsValueLeader omahaRiverMediumBetStrongHandCalls omahaBigBetIsPotShare omahaPairedRiverNoThinLeadVsValueLeader omahaOverpairNoOopBarrelVsValueLeader omahaPairedTurnNoBarrelWithoutBoatVsValueLeader omahaPairedBoardFoldRespectsPrice omahaBandFallbackInBandUnit omahaTurnStrongHandRealizationIsMeasured omahaBetReadIsPerOpponent omahaFacingBetPaysTheWholeDeduction omahaMathCoreNetsTheWholeDeduction omahaColdCallOutsideBigBlindIsMeasured omahaOpenNeedsMeasuredStrength omahaAcesReraiseIsMeasured omahaReraiseRangeIsMeasured omahaNoMadeClassCap omahaBetReadIsModeSplit omahaRundownReraiseRangeIsMeasured omahaRundownReraiseRangeTrial omahaClassCapsRespectEquity omahaMathCorePlo4Flop omahaMathCorePlo4Turn omahaMathCorePlo4River omahaMathCorePlo5Flop omahaMathCorePlo5Turn omahaMathCorePlo5River omahaMathCorePreflop omahaMathCore omahaFlopFacingBetEv omahaFourBetFoldPricedCall omahaStabDefenceIsPriced omahaStrongHandCheckIsPriced omahaCbetRaiseIsPriced omahaRiverCheckedToBetIsMeasured omahaRiverFirstToActBetIsPriced omahaOpponentLifetimeHudDecides omahaPreflopReadIsPricedFromLifetime omahaBigBetSizeIsPriced omahaRiverCurrentNutsCallFloor omahaReadIsByStreetAndTexture omahaTurnBetNeedsRiverPlan omahaPressureNeedsPostflopAggression omahaOopTurnCheckAfterFlopCall omahaBareOverpairOopFlopCheck omahaNoCallColdFourBetWithoutPremium omahaUnderpairNoMultiwayFlopContinue omahaMultiwayWeakHandNoBet omahaVpipFloorByLimp vpipFloorLimpOnly vpipFloorLimpOnlyTenHandWindow lightningVpipFloorLimpOnly omahaReraisedPositionInLightning omahaManiacReRaiseWidthMeasured omahaCardImpact omahaFacingBetEv omahaTurnStabDefenceIsPriced omahaTurnStabLightningRow omahaTurnCallRealizationByRunout omahaFacingBetEvShownField omahaRiverBluffCatchIsPriced omahaTurnRiverRaiseNeedsNuts omahaStreetPlan omahaStreetPlanThreeWay omahaBigDrawAggression omahaBigDrawBetIsPricedOnHisResponse omahaNoDrawRaiseOutOfPosition omahaStrategyInTournaments omahaNoCategoricalRules omahaBlanketRowsOffInPlo45Cash omahaTournamentsExcludeCategoricalRules omahaStrongHandSlowplayMix omahaTurnRiverRaiseIsPriced omahaDrawRaiseIsPriced omahaOopTurnBarrelIsPriced omahaPackEffectiveDepth omahaPackClampDeepDepth omahaFacingBetRangeIsContinuous omahaPressureIsPriced omahaBigBetCallsArePriced omahaUnderpairMultiwayIsPriced omahaSampledRaiseIsPricedAtEverySize omahaTurnSetSizeIsPriced omahaBlockerBluffIsPriced omahaFlopBetIsPricedOnHisResponse omahaPricedInLightning omahaSlowplayMixInLightning omahaPublicBetSizeInLightning omahaCheckedToBetResponseIsMeasured omahaCheckedToBetInLightning horseRiverNoBlockerBet horsePlayStyles omahaStrongHandValue omahaValueSizeIsUnreadable omahaRiverNutBlockerBluffReachable holdemHeadsUpPostflopBalance plo6ManiacPriceRefusalToRangePlay plo6FacingBetIsPriced fixedLimitHiLoNutLowRiverBet fixedLimitRiverOneBetValueRaise v64RiverRaiseNeedsTwoPair v63LargeRiverBetShade v74OmahaSemiBluffNeedsDraw v60CashPressure v65TurnOnePairShade v68TurnAirDrawCalls v69TurnCallGaps v70GtoOpeningRanges v71AnteAwarePushFold v72DefenceByOpener v73Vs3BetDefence v75SqueezeDefence v79TopPairWeakKicker v81OmahaBigBetCalls v15RiverNoNearLock v85CashAction lightningStyleReadSeparate styleTightPlayerExploit styleTightMultiSignal styleTightMethodLine holdemManiacSampleGate holdemManiacShortHandedReach holdemGearShiftReach holdemCallDownExcludesCurrentHand holdemCallDownNeedsStyleEvidence v84OmahaRiverReraiseCalls v83AggressionNeedsBluffs readShrinkResponse readBreakEvenBluff omahaEvFoldModel omahaEvFoldModelHeadsUp omahaEvFoldModelSkipsPlo45 tournamentUtilityStackScaledMargin icmBustPaysPlace holdemRiverFullHouseValue holdemRiverFullHouseValueIsPriced holdemValueAndCallsArePriced readScopedShrink planFingerprint v80TopPairStrongKicker v78NoCommittingBluffRaise v70FacingOpenZone huBbDefendsUnreadToPrice holdemPersonaReRaiseMix holdemPersonaPostflop nashCallVsJam holdemTournamentAllInCallIsPriced fixedLimitReadIgnoresProbes fixedLimitHiLoLowHalfFloor fixedLimitRiverStrongHandLeads fixedLimitOmahaNoPresumption lightningEarlyFoldNeedsFoldThrough facingClosedAllIn limpReraiseIsoRead v77SeatAwareJams v76RetireFourBetBluffBand v74NlhOpenSizes v52RangeAdvantage v53Pressure v58Plo6RiverNuts v59Plo6RiverUnpaired drawOutlookQuality committedRaiseDiscipline callDeductionPricing flopTurnBluffBaseline riverBluffBaseline riverLeadRange riverBluffHiLo riverBluffMultiway riverFastCalldown probeAwareAggression riverBluffFixedLimit riverBluffShortDeck riverBluffBombPot riverBluffMultiBoard v43Tempo v86UnblockedPreflop v86MultiStreetUnblocked omahaRiverBetFoldIsHisRecord'
refused='comboDrawPressure v54RiverBluff riverPositionDefense riverBluffCheckRaise barrelContinuationOutlook smallPotNearNutRiverValue multiwayRiverBluffCheckRaise v53PloTourneyIcm phase8Postflop phase8PolicyFamily phase8CatastropheGuard phase10Plo4 phase11Omaha phase12Remaining phase13Joint phase14 phase14Corrective phase15Anything v87DeepDiveDiscipline v87ShouldSuppressOmahaPositionStab pillar2PositionStab v31GtoSuitAware solverRound7 heldOutPack vpipFloorDeepStackOff omahaPreflopCallWithActionBehind v58MadeHandCellSkip multiBoardFreerollIsPriced multiBoardNonFreerollIsPriced multiBoardBluffTrimIsPriced holdemPersonaPostflopIsPriced notAnOption leakMapRead telemetry observeMind mind v41Leaks v87RiverBlockBetTrapIsPriced holdemRiverBluffIsPriced holdemFlopTurnBluffIsPriced holdemRiverBluffMultiwayIsPriced holdemTournamentAggressionIsPriced'
authority_tail='OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md sha256 2080c2026d5553e11ac288a74fcef51d20f81b30c0a9da446b5063a9f7196bf1'
is_offonly() { case " $offonly " in *" $1 "*) return 0;; *) return 1;; esac; }
is_shadow() { case " $shadow " in *" $1 "*) return 0;; *) return 1;; esac; }
is_onshadow() { case " $onshadow " in *" $1 "*) return 0;; *) return 1;; esac; }
on_count=0; off_count=0; shadow_count=0; onshadow_count=0
# With the evidence record installed (every follow-up run), 'on' needs the cited sha256 recorded for the option.
has_evidence="$("${psql[@]}" -At -c "SELECT to_regclass('public.ca_horse_option_switch_evidence') IS NOT NULL")"

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
    expect_refusal "$o (off-only): the set function refuses on_shadow even with its own citation" "does not support state on_shadow" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on_shadow', 'fixture', '$own')"
    expect_refusal "$o (off-only): the table refuses an on_shadow row from any writer, with its own citation" "ca_horse_style_switch_state_fits_option" "INSERT INTO public.ca_horse_style_switch (option, state, updated_by, note) VALUES ('$o', 'on_shadow', 'owner-role', '$own')"
    q "SELECT public.fn_ca_horse_option_switch_set('$o', 'off', 'fixture', 'rollback')" >/dev/null
    check "$o (off-only): off is written" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$o'")"
    expect_refusal "$o (off-only): the table refuses turning its off row on, with its own citation" "ca_horse_style_switch_state_fits_option" "UPDATE public.ca_horse_style_switch SET state = 'on', note = '$own' WHERE option = '$o'"
    q "SELECT public.fn_ca_horse_option_switch_clear('$o', 'fixture', 'clear')" >/dev/null
    check "$o (off-only): clear removes the row" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch WHERE option = '$o'")"
    continue
  fi
  on_count=$((on_count + 1))
  if is_shadow "$o"; then
    shadow_count=$((shadow_count + 1))
    check "$o is offered off, shadow, on_shadow and on" "{off,shadow,on_shadow,on}" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
    q "SELECT public.fn_ca_horse_option_switch_set('$o', 'shadow', 'fixture', 'shadow')" >/dev/null
    check "$o: shadow is written, in the wide read and not the style read" "shadow|shadow|" \
      "$(q "SELECT s.state || '|' || coalesce(public.fn_ca_horse_option_switch_effective()->'options'->>'$o', '') || '|' || coalesce(public.fn_ca_horse_style_switch_effective()->'options'->>'$o', '') FROM public.ca_horse_style_switch s WHERE s.option = '$o'")"
    expect_refusal "$o: canary is refused" "does not support state canary" "SELECT public.fn_ca_horse_option_switch_set('$o', 'canary', 'fixture', 'canary')"
  else
    if is_onshadow "$o"; then
      check "$o is offered off, on_shadow and on" "{off,on_shadow,on}" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
    else
      check "$o is offered off and on" "{off,on}" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
    fi
    expect_refusal "$o: the set function refuses shadow" "does not support state shadow" "SELECT public.fn_ca_horse_option_switch_set('$o', 'shadow', 'fixture', 'shadow')"
    expect_refusal "$o: the table refuses a shadow row from any writer" "ca_horse_style_switch_state_fits_option" "INSERT INTO public.ca_horse_style_switch (option, state, updated_by) VALUES ('$o', 'shadow', 'owner')"
  fi
  if is_onshadow "$o"; then
    onshadow_count=$((onshadow_count + 1))
    # on_shadow acts as on: the own citation at the set function and at the table, from any writer
    expect_refusal "$o: the set function refuses on_shadow with a junk note" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on_shadow', 'fixture', 'try on_shadow')"
    expect_refusal "$o: the set function refuses on_shadow with another option's citation" "cites its own authority" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on_shadow', 'fixture', '$other')"
    expect_refusal "$o: the table refuses an on_shadow row without a note from any writer" "ca_horse_style_switch_on_cites_authority" "INSERT INTO public.ca_horse_style_switch (option, state, updated_by) VALUES ('$o', 'on_shadow', 'owner-role')"
  else
    expect_refusal "$o: the set function refuses on_shadow" "does not support state on_shadow" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on_shadow', 'fixture', '$own')"
    expect_refusal "$o: the table refuses an on_shadow row from any writer, with its own citation" "ca_horse_style_switch_state_fits_option" "INSERT INTO public.ca_horse_style_switch (option, state, updated_by, note) VALUES ('$o', 'on_shadow', 'owner-role', '$own')"
  fi
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
  if [ "$has_evidence" = t ]; then
    expect_refusal "$o: on with its own citation and no evidence row is refused" "only after its evidence is recorded" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', '$own')"
    if is_onshadow "$o"; then
      expect_refusal "$o: on_shadow with its own citation and no evidence row is refused" "only after its evidence is recorded" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on_shadow', 'fixture', '$own')"
    fi
    q "SELECT public.fn_ca_horse_option_switch_record_evidence('$o', 'OWNER-MESSAGE-20261114-2201CT-EVERY-FEATURE-ON-WITH-SWITCH.md', '${authority_tail##* }', 'owner_forced', 'fixture', NULL, 'fixture')" >/dev/null
  fi
  q "SELECT public.fn_ca_horse_option_switch_set('$o', 'on', 'fixture', '$own')" >/dev/null
  check "$o: on with its own citation is written" "on|$own" "$(q "SELECT state || '|' || note FROM public.ca_horse_style_switch WHERE option = '$o'")"
  if is_onshadow "$o"; then
    q "SELECT public.fn_ca_horse_option_switch_set('$o', 'on_shadow', 'fixture', '$own')" >/dev/null
    check "$o: on_shadow with its own citation and recorded evidence is written, in the wide read and not the style read" "on_shadow|on_shadow||$own" \
      "$(q "SELECT s.state || '|' || coalesce(public.fn_ca_horse_option_switch_effective()->'options'->>'$o', '') || '|' || coalesce(public.fn_ca_horse_style_switch_effective()->'options'->>'$o', '') || '|' || s.note FROM public.ca_horse_style_switch s WHERE s.option = '$o'")"
  fi
  q "SELECT public.fn_ca_horse_option_switch_clear('$o', 'fixture', 'clear')" >/dev/null
  check "$o: clear removes the row" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch WHERE option = '$o'")"
done
check "the off-only options are the listed ones" "$(set -- $offonly; echo $#)" "$off_count"
check "every off, on and clear wrote one audit row; no refused on wrote one" \
  "$((audit_before + 3 * on_count + 2 * off_count + shadow_count + onshadow_count))" "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit")"
check "every audit row of an on for a non-style option carries that option's own citation" "$on_count|0" \
  "$(q "SELECT count(*) FILTER (WHERE note = 'authority: ' || option || ' $authority_tail') || '|' || count(*) FILTER (WHERE note IS DISTINCT FROM 'authority: ' || option || ' $authority_tail') FROM public.ca_horse_style_switch_audit WHERE new_state = 'on' AND option NOT IN ('$(echo $style | sed "s/ /','/g")')")"
check "the on_shadow options are the listed ones" "$(set -- $onshadow; echo $#)" "$onshadow_count"
check "every audit row of an on_shadow carries that option's own citation" "$onshadow_count|0" \
  "$(q "SELECT count(*) FILTER (WHERE note = 'authority: ' || option || ' $authority_tail') || '|' || count(*) FILTER (WHERE note IS DISTINCT FROM 'authority: ' || option || ' $authority_tail') FROM public.ca_horse_style_switch_audit WHERE new_state = 'on_shadow'")"
check "no audit row records on or on_shadow for an off-only option" "0" \
  "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit WHERE new_state = 'on_shadow' AND option IN ('$(echo $offonly | sed "s/ /','/g")')")"
check "no audit row records on for an off-only option" "0" \
  "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit WHERE new_state = 'on' AND option IN ('$(echo $offonly | sed "s/ /','/g")')")"
check "the audit rows name their actor" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch_audit WHERE changed_by IS DISTINCT FROM 'fixture'")"

for o in $refused; do
  check "$o is not switchable" "" "$(q "SELECT public.fn_ca_horse_option_switch_states('$o')")"
  for s in on on_shadow off; do
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
  # a style option never takes on_shadow: its shadow is its own arm
  expect_refusal "$o: the wide setter refuses on_shadow for a style option" "does not support state on_shadow" "SELECT public.fn_ca_horse_option_switch_set('$o', 'on_shadow', 'fixture', 'style')"
  expect_refusal "$o: the old style setter refuses on_shadow" "unknown style state" "SELECT public.fn_ca_horse_style_switch_set('$o', 'on_shadow', 'fixture', 'style')"
  expect_refusal "$o: the table refuses an on_shadow row for a style option from any writer" "ca_horse_style_switch_state_fits_option" "UPDATE public.ca_horse_style_switch SET state = 'on_shadow' WHERE option = '$o'"
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
  # It was installed above in version order; a second install replaces the set function with its own text, so the
  # later replacements are put back exactly as production holds them (the style-by-canary read, then the lists).
  for f in "$repo"/supabase/migrations/*_the_horse_option_switch_tells_style_options_by_name.sql "$repo"/supabase/migrations/*_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql "$last_list"; do
    [ -n "$f" ] && [ -f "$f" ] || continue
    "${psql[@]}" -f "$f"
    echo "ok    $(basename "$f") installed again after the evidence record"
  done
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
  # the two recorded here, and one per option switched on in the loop above (the evidence record was installed then)
  check "the evidence rows are the ones recorded" "$((2 + on_count))" "$(q "SELECT count(*) FROM public.ca_horse_option_switch_evidence")"

  # THE SERVING-REGISTRY GUARD (migration *_the_horse_option_switch_refuses_what_the_serving_engine_does.sql, installed
  # above in version order): a switch row for a name or state the SERVING engine does not register makes that engine
  # drop every switched option to its release default, so the two writers refuse it when a fresh published registry
  # exists, and behave as before (with a NOTICE) when none does. The writers production ends with are the ones of the
  # LATER by-name migration (*_the_horse_option_switch_tells_style_options_by_name.sql: style options told by canary,
  # so a non-style option can take shadow), which carries the guard call in both bodies; it is installed twice more
  # here and every assertion below runs against it. (The guard migration itself is never installed after a list that
  # names shadow options: its own writers tell a style option by shadow, and production installed it before them.)
  # REGISTRY_GUARD_MIGRATION names another file to prove the assertions fail without the guard.
  guard_migration="${REGISTRY_GUARD_MIGRATION:-$(ls "$repo"/supabase/migrations/*_the_horse_option_switch_tells_style_options_by_name.sql)}"
  q "SELECT public.fn_ca_horse_option_switch_set('readShrinkResponse', 'off', 'fixture', 'a row before the guard')" >/dev/null
  "${psql[@]}" -f "$guard_migration"
  "${psql[@]}" -f "$guard_migration"
  echo "ok    registry-guarded writers $(basename "$guard_migration") installed (twice)"
  # the set function production ends with is the on_shadow one (2026-11-19), later than the by-name file: it keeps
  # the guard call, so every assertion below runs against it too (not with REGISTRY_GUARD_MIGRATION set)
  if [ -z "${REGISTRY_GUARD_MIGRATION:-}" ]; then
    for f in "$repo"/supabase/migrations/*_the_horse_option_switch_on_shadow_keeps_every_rule_of_on.sql; do
      [ -f "$f" ] || continue
      "${psql[@]}" -f "$f"
      "${psql[@]}" -f "$f"
      echo "ok    on_shadow writers $(basename "$f") installed (twice)"
    done
  fi
  check "a switch row written before the guard survives it" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'readShrinkResponse'")"
  # the engine's canonical digest, computed independently: sha256 of [[name,[states...]],...] sorted by name
  digest() { python3 -c 'import hashlib,json,sys; r=json.loads(sys.argv[1]); print(hashlib.sha256(json.dumps([[k,r[k]] for k in sorted(r)],separators=(",",":")).encode()).hexdigest())' "$1"; }
  publish() { # release sha, registry json
    q "SET ROLE service_role; SELECT public.fn_ca_horse_option_registry_publish('$1', '$2'::jsonb, '$(digest "$2")')" >/dev/null
  }
  sha_r1="$(printf '1%.0s' $(seq 40))"; sha_r2="$(printf '2%.0s' $(seq 40))"; sha_old="$(printf '3%.0s' $(seq 40))"
  reg1='{"readScopedShrink":["off","on"],"readShrinkResponse":["off","on"],"handReading":["off"],"styleFoldBluff":["off","on"]}'
  notice() { "${psql[@]}" -At -c "$1" 2>&1 | grep -c 'serving-registry guard is not active' || true; }
  audit_now() { q 'SELECT count(*) FROM public.ca_horse_style_switch_audit'; }

  # no published registry yet: exactly as before, and it says so
  check "no published registry: an off row for any registered option is written, with a NOTICE" "1" \
    "$(notice "SELECT public.fn_ca_horse_option_switch_set('v7', 'off', 'fixture', 'no registry yet')")"
  check "no published registry: the row is there" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'v7'")"
  q "SELECT public.fn_ca_horse_option_switch_clear('v7', 'fixture', 'clear')" >/dev/null
  # evidence recorded while no registry is published, so the 'on' below reaches the guard
  q "SELECT public.fn_ca_horse_option_switch_record_evidence('v7', 'docs/x.md', '$sha_a', 'evidence', 'ref', NULL, 'fixture')" >/dev/null

  publish "$sha_r1" "$reg1"
  check "the publish stored one fresh release" "1|$(digest "$reg1")" "$(q "SELECT count(*) || '|' || max(registry_digest) FROM public.ca_horse_option_registry_serving WHERE seen_at >= now() - interval '5 minutes'")"
  audit_guard="$(audit_now)"
  expect_refusal "fresh registry: off for a name the serving release does not register is refused" "does not register option v7" "SELECT public.fn_ca_horse_option_switch_set('v7', 'off', 'fixture', 'trap')"
  expect_refusal "fresh registry: on for a name the serving release does not register is refused" "does not register option v7" "SELECT public.fn_ca_horse_option_switch_set('v7', 'on', 'fixture', 'authority: v7 docs/x.md sha256 $sha_a')"
  expect_refusal "fresh registry: a state the serving release does not support is refused" "does not support state shadow for option styleFoldBluff" "SELECT public.fn_ca_horse_option_switch_set('styleFoldBluff', 'shadow', 'fixture', 'style')"
  expect_refusal "fresh registry: evidence for a name the serving release does not register is refused" "does not register option v7" "SELECT public.fn_ca_horse_option_switch_record_evidence('v7', 'docs/x.md', '$sha_c', 'evidence', 'ref', NULL, 'fixture')"
  expect_refusal "fresh registry: evidence for an option the serving release holds off-only is refused" "does not support state on for option handReading" "SELECT public.fn_ca_horse_option_switch_record_evidence('handReading', 'docs/x.md', '$sha_c', 'evidence', 'ref', NULL, 'fixture')"
  check "no refused write left a row or an audit row" "0|$audit_guard" "$(q "SELECT (SELECT count(*) FROM public.ca_horse_style_switch WHERE option = 'v7') || '|' || (SELECT count(*) FROM public.ca_horse_style_switch_audit)")"
  check "fresh registry: a listed option and state is written, with no NOTICE" "0" \
    "$(notice "SELECT public.fn_ca_horse_option_switch_set('readScopedShrink', 'off', 'fixture', 'listed')")"
  check "fresh registry: the listed row is there" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'readScopedShrink'")"
  q "SELECT public.fn_ca_horse_option_switch_set('readScopedShrink', 'on', 'fixture', 'authority: readScopedShrink docs/x.md sha256 $sha_a')" >/dev/null
  check "fresh registry: on for a listed option with its recorded evidence is written" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'readScopedShrink'")"
  q "SELECT public.fn_ca_horse_option_switch_clear('v7', 'fixture', 'clear is never refused')" >/dev/null
  check "fresh registry: clear of an unregistered-by-the-release name is never refused (it can only cure the trap)" "default" "$(q "SELECT new_state FROM public.ca_horse_style_switch_audit WHERE option = 'v7' ORDER BY id DESC LIMIT 1")"

  # two fresh releases (a cutover): the name must be listed by every one of them
  publish "$sha_r2" '{"readScopedShrink":["off","on"],"v7":["off","on"],"styleFoldBluff":["off","shadow","canary","on"]}'
  expect_refusal "two fresh releases: a name only the newer one registers is still refused" "does not register option v7" "SELECT public.fn_ca_horse_option_switch_set('v7', 'off', 'fixture', 'cutover')"
  publish "$sha_r1" '{"readScopedShrink":["off","on"],"v7":["off","on"],"styleFoldBluff":["off","on"]}'
  q "SELECT public.fn_ca_horse_option_switch_set('v7', 'off', 'fixture', 'both register it')" >/dev/null
  check "two fresh releases: a name both register is written" "off" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = 'v7'")"
  check "a republish with a new registry replaces it and keeps first_seen_at" "1|true" "$(q "SELECT count(*) || '|' || bool_and(first_seen_at <= seen_at) FROM public.ca_horse_option_registry_serving WHERE release_sha = '$sha_r1' AND registry ? 'v7'")"
  q "SELECT public.fn_ca_horse_option_switch_clear('v7', 'fixture', 'clear')" >/dev/null

  # stale: no release published for 5 minutes, the guard is not active again (and says so)
  q "UPDATE public.ca_horse_option_registry_serving SET seen_at = now() - interval '6 minutes'" >/dev/null
  check "stale registries: an off row for a registered option is written again, with a NOTICE" "1" \
    "$(notice "SELECT public.fn_ca_horse_option_switch_set('handReading', 'off', 'fixture', 'stale registry')")"
  q "SELECT public.fn_ca_horse_option_switch_clear('handReading', 'fixture', 'clear')" >/dev/null
  # retention: a release not seen for 30 days goes at the next publish; a recent one stays
  q "INSERT INTO public.ca_horse_option_registry_serving (release_sha, registry, registry_digest, first_seen_at, seen_at) VALUES ('$sha_old', '{\"v7\":[\"off\"]}', '$(digest '{"v7":["off"]}')', now() - interval '40 days', now() - interval '31 days')" >/dev/null
  publish "$sha_r1" "$reg1"
  check "the publish removes a release not seen for 30 days and keeps the others" "0|2" "$(q "SELECT count(*) FILTER (WHERE release_sha = '$sha_old') || '|' || count(*) FILTER (WHERE release_sha <> '$sha_old') FROM public.ca_horse_option_registry_serving")"

  # the publish refuses what is not a release registry, and only service_role reaches it
  expect_refusal "the publish refuses a digest that does not match the registry" "does not match" "SELECT public.fn_ca_horse_option_registry_publish('$sha_r1', '$reg1'::jsonb, '$sha_a')"
  expect_refusal "the publish refuses a short release sha" "40 lowercase hex" "SELECT public.fn_ca_horse_option_registry_publish('1234567', '$reg1'::jsonb, '$(digest "$reg1")')"
  for bad in '{"not-plain":["off"]}' '{"v7":["on"]}' '{"v7":["off","maybe"]}' '{"v7":"off"}' '{}'; do
    expect_refusal "the publish refuses the registry $bad" "registry" "SELECT public.fn_ca_horse_option_registry_publish('$sha_r1', '$bad'::jsonb, '$(digest "$bad")')"
  done
  expect_refusal "anon cannot publish a registry" "permission denied" "SET ROLE anon; SELECT public.fn_ca_horse_option_registry_publish('$sha_r1', '$reg1'::jsonb, '$(digest "$reg1")')"
  expect_refusal "authenticated cannot read the registry" "permission denied" "SET ROLE authenticated; SELECT count(*) FROM public.ca_horse_option_registry_serving"
  expect_refusal "service_role cannot write the registry directly" "permission denied" "SET ROLE service_role; DELETE FROM public.ca_horse_option_registry_serving"

  # ON_SHADOW AND THE GUARD (2026-11-19): an engine that does not list on_shadow for the option rejects the whole
  # configuration on such a row, so the set function refuses it while a fresh registry does not list it.
  if [ -n "$onshadow" ] && [ -z "${REGISTRY_GUARD_MIGRATION:-}" ]; then
    os="$(set -- $onshadow; echo "$1")"
    for o in $onshadow; do is_shadow "$o" || { os="$o"; break; }; done
    sha_os="$(printf 'd%.0s' $(seq 64))"
    reg_on="{\"$os\":[\"off\",\"on\"]}"
    reg_os="{\"$os\":[\"off\",\"on_shadow\",\"on\"]}"
    q "UPDATE public.ca_horse_option_registry_serving SET seen_at = now() - interval '6 minutes'" >/dev/null
    publish "$sha_r1" "$reg_on"
    q "SELECT public.fn_ca_horse_option_switch_record_evidence('$os', 'docs/os.md', '$sha_os', 'evidence', 'ref', NULL, 'fixture')" >/dev/null
    expect_refusal "fresh registry without on_shadow: $os on_shadow is refused by the guard" "does not support state on_shadow for option $os" "SELECT public.fn_ca_horse_option_switch_set('$os', 'on_shadow', 'fixture', 'authority: $os docs/os.md sha256 $sha_os')"
    check "fresh registry without on_shadow: no row and no audit row was written" "0" "$(q "SELECT count(*) FROM public.ca_horse_style_switch WHERE option = '$os'")"
    q "SELECT public.fn_ca_horse_option_switch_set('$os', 'on', 'fixture', 'authority: $os docs/os.md sha256 $sha_os')" >/dev/null
    check "fresh registry without on_shadow: on for $os is still written" "on" "$(q "SELECT state FROM public.ca_horse_style_switch WHERE option = '$os'")"
    publish "$sha_r1" "$reg_os"
    check "the publish accepts on_shadow as a state" "1" "$(q "SELECT count(*) FROM public.ca_horse_option_registry_serving WHERE release_sha = '$sha_r1' AND registry -> '$os' ? 'on_shadow' AND seen_at >= now() - interval '5 minutes'")"
    q "SELECT public.fn_ca_horse_option_switch_set('$os', 'on_shadow', 'fixture', 'authority: $os docs/os.md sha256 $sha_os')" >/dev/null
    check "fresh registry listing on_shadow: $os on_shadow is written, in the wide read and not the style read" "on_shadow|on_shadow|" \
      "$(q "SELECT s.state || '|' || coalesce(public.fn_ca_horse_option_switch_effective()->'options'->>'$os', '') || '|' || coalesce(public.fn_ca_horse_style_switch_effective()->'options'->>'$os', '') FROM public.ca_horse_style_switch s WHERE s.option = '$os'")"
    expect_refusal "fresh registry listing on_shadow: a citation of an unrecorded sha256 is still refused" "only after its evidence is recorded" "SELECT public.fn_ca_horse_option_switch_set('$os', 'on_shadow', 'fixture', 'authority: $os docs/os.md sha256 $sha_c')"
    q "SELECT public.fn_ca_horse_option_switch_clear('$os', 'fixture', 'clear')" >/dev/null
  fi
fi

if [ "$fail" = 0 ]; then
  echo 'PASS  every option switch evidence assertion held'
else
  echo 'FAIL  the option switch accepts on for an off-only option or without the option own citation, or lost on, off, clear, audit or a refusal'
  exit 1
fi
