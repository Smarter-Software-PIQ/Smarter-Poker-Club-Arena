-- 20261115033158_midway_weekly_sheet_schedules_fixed_limit_freezeouts.sql
--
-- Version reserved by scripts/new-migration.mjs.
--
-- One fixed-limit Hold'em (FLH) and one fixed-limit Omaha hi-lo (FLO8)
-- freezeout MTT join the maintained Midway weekly sheet.
--
-- AUTHORITY. The Phase 1 overwatch (Claude session_01Gw7aDrifSS8PriUrJqsCnQ),
-- to which the owner delegated every decision (owner instruction 20:42
-- Chicago, 2026-11-14), decided at 2026-11-15T02:45:41Z: one FLH and one FLO8
-- freezeout MTT, each copying buy-in, fee, guarantee, table size (FLO8 at most
-- 10), structure/blind preset, late registration, horsesToRegister and
-- minPlayers from the smallest active weekly PLO8 schedule row, in a slot
-- inside 6 AM to 11 PM Chicago where Horse schedules already staff
-- tournaments, with the prize rules unchanged. The Fixed-Limit lane's
-- diagnosis (S-FL-TOURNAMENT-READINESS.md, 2026-11-15T02:34:06Z): every
-- creation gate already accepts flh and flo8; the sheet had no fixed-limit
-- event, and that was the whole cause. The sheet's writer (Codex lane
-- 01a1b6bf) did not answer the notice on #9983; this is the bounded builder's
-- handoff under that decision.
--
-- SOURCE ROW. The active weekly PLO8 rows: PLO8 Morning Stack e6953809 (10
-- total, 250 guaranteed), Brunch Special PKO (PLO8) bf2420ae (10, 250,
-- progressive knockout) and PLO8 Hi-Lo Turbo 4fff52fc (20, none). The first
-- two tie on buy-in and guarantee. The Morning Stack is the source because it
-- is itself a non-bounty MTT carrying every parameter the decision copies
-- (minPlayers 4, blindPreset DEEPSTACK); the PKO has a 5-chip bounty and no
-- minPlayers. Copied unchanged: 10 total (9 + 1 fee), 250 guaranteed, 9 seats,
-- maxPlayers 500, minPlayers 4, horsesToRegister 0, 5,000 chips, ladder B11
-- (5-minute levels), DEEPSTACK and NINE presets, late registration through
-- level 12, the same short description. Freezeout: no rebuy, no re-entry, no
-- add-on, in the shape of the sheet's existing 40 Chip Freezeout rows.
--
-- SLOTS. Thursday, the source's day: FLH 08:45 and FLO8 09:15, the free
-- quarter hours either side of the source's 09:00. On Thursday 2026-11-12
-- Horses filled every scheduled MTT from 08:00 to 10:30 (51, 578, 42, 70, 37,
-- 41 and 40 entrants). No active Midway schedule starts at either slot; this
-- install refuses if one does.
--
-- LIMIT STRUCTURE. A fixed-limit wager is the level's big blind preflop and on
-- the flop and twice it on the turn and river
-- (server/src/engine/BettingStructure.ts fixedLimitBetSize), so the existing
-- blind ladder states the limit structure. No new preset.
--
-- MONEY. Unchanged: entries net of the fee form the prize pool, the existing
-- affordability path funds the 250 guarantee, no bounty, no projected payout.
-- Horse work hours, caps, rest days, bankroll eligibility, payout and
-- settlement paths are untouched. Chips, not money. No engine change, new
-- trigger, cron, watcher, forced seating or schedule override.
--
-- HOW, as #10292 and #10533 did. The weekly catalog is
-- public.fn_ca_midway_weekly_catalog(); fn_tournament_schedule_board_is_hard_coded
-- repopulates schedule rows from it, and the original installer retires any
-- Midway schedule it does not list. So the two events are appended to the
-- catalog document and their two schedule rows are inserted from it. Refused
-- if either id exists, if the source no longer carries what was copied, if a
-- cheaper active PLO8 row exists, or if a slot is taken.
-- Fixture: docs/tournament-schedules/midway-weekly-2026-11-07.json (its last two events).
-- @live-proof: (SELECT count(*)=2 AND bool_and(s.active AND cardinality(s.days_of_week)=1 AND 4=ALL(s.days_of_week) AND s.config->>'type'='freezeout' AND s.config->>'gameVariant' IN ('flh','flo8') AND s.config#>>'{midwayWeeklyTerms,game_type}'=upper(s.config->>'gameVariant') AND s.config#>>'{midwayWeeklyTerms,is_rebuy}'='false' AND s.config#>>'{midwayWeeklyTerms,is_reentry}'='false' AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.fn_ca_midway_weekly_catalog()) e WHERE e->>'id'=s.id::text)) FROM public.tournament_schedules s WHERE s.id IN ('27fb3eb2-4c01-4931-8b44-0767d06ec2ef','4601510e-2b88-431c-8fa5-04b01415c9d1'))

BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='8s';

DO $fixed_limit$
DECLARE
  midway constant uuid := 'fade0000-0000-0000-0000-000000000001';
  source_id constant uuid := 'e6953809-af43-4397-a15c-4ea2ce50aa14';
  new_ids constant uuid[] := ARRAY['27fb3eb2-4c01-4931-8b44-0767d06ec2ef','4601510e-2b88-431c-8fa5-04b01415c9d1']::uuid[];
  -- Every economic, structure, seating and staffing field the decision copies.
  copied_config constant text[] := ARRAY['buyIn','banChat','tableSize','maxPlayers','minPlayers','blindPreset',
    'bigBlindAnte','bountyAmount','payoutPreset','startingStack','addonFromStart','guaranteedPrize','horsesToRegister',
    'addonBreakMinutes','lateRegistrationLevels','lateRegistrationMode','lateRegistrationMinutes','midwayWeeklyRevision'];
  copied_terms constant text[] := ARRAY['variant','tournament_type','table_size','is_bounty','is_pko','is_mystery_bounty',
    'bounty_amount','addon_from_start','addon_break_minutes','free_buy','all_in_or_fold','is_pinned','big_blind_ante',
    'synchronized_breaks','ban_chat','satellite_seats','buy_in_amount','buy_in_fee','guaranteed_prize','starting_chips',
    'late_reg_levels','late_reg_mins','accelerated_mtt','blind_speed','is_turbo','short_description'];
  additions constant jsonb := $events$[
  {
    "id": "27fb3eb2-4c01-4931-8b44-0767d06ec2ef",
    "sourceScheduleId": "27fb3eb2-4c01-4931-8b44-0767d06ec2ef",
    "sourceName": "Fixed Limit Hold'em Freezeout (FLH)",
    "name": "Fixed Limit Hold'em Freezeout (FLH)",
    "days": [
      4
    ],
    "times": [
      "08:45"
    ],
    "config": {
      "name": "Fixed Limit Hold'em Freezeout (FLH)",
      "type": "freezeout",
      "buyIn": 10,
      "banChat": true,
      "isRebuy": false,
      "addonCost": null,
      "isReentry": false,
      "rebuyCost": null,
      "tableSize": 9,
      "addonChips": 5000,
      "maxPlayers": 500,
      "minPlayers": 4,
      "rebuyChips": 5000,
      "addonLevels": null,
      "blindPreset": "DEEPSTACK",
      "gameVariant": "flh",
      "rebuyLevels": 12,
      "bigBlindAnte": false,
      "bountyAmount": 0,
      "payoutPreset": "NINE",
      "startingStack": 5000,
      "addOnAvailable": false,
      "addonFromStart": false,
      "guaranteedPrize": 250,
      "horsesToRegister": 0,
      "addonBreakMinutes": 1,
      "lateRegistrationLevels": 12,
      "lateRegistrationMode": "levels",
      "lateRegistrationMinutes": 0,
      "maxRebuys": 0,
      "maxReentries": 0,
      "addOnChips": 5000,
      "addOnCost": null,
      "midwayWeeklyRevision": "owner-sheet-2026-11-07-v1",
      "midwaySourceScheduleId": "27fb3eb2-4c01-4931-8b44-0767d06ec2ef"
    },
    "terms": {
      "game_type": "FLH",
      "variant": "freezeout",
      "tournament_type": "MTT",
      "table_size": 9,
      "is_bounty": false,
      "is_pko": false,
      "is_mystery_bounty": false,
      "bounty_amount": 0,
      "mystery_bounty_min": 0,
      "mystery_bounty_max": 0,
      "mystery_bounty_activation": "at_the_money",
      "mystery_bounty_activation_value": null,
      "mystery_bounty_profile": "classic",
      "mystery_bounty_top_percent": 20,
      "mystery_bounty_regular_pool_percent": 50,
      "mystery_bounty_pool_percent": 50,
      "is_rebuy": false,
      "is_reentry": false,
      "rebuy_cost": null,
      "max_rebuys": 0,
      "max_reentries": 0,
      "add_on_available": false,
      "addon_cost": null,
      "addon_from_start": false,
      "addon_break_minutes": 1,
      "free_buy": false,
      "all_in_or_fold": false,
      "is_pinned": false,
      "big_blind_ante": false,
      "synchronized_breaks": true,
      "ban_chat": true,
      "satellite_seats": null,
      "name": "Fixed Limit Hold'em Freezeout (FLH)",
      "buy_in_amount": 9,
      "buy_in_fee": 1,
      "guaranteed_prize": 250,
      "starting_chips": 5000,
      "late_reg_levels": 12,
      "late_reg_mins": 0,
      "rebuy_chips": null,
      "rebuy_levels": null,
      "addon_chips": null,
      "addon_levels": null,
      "accelerated_mtt": false,
      "blind_speed": "turbo",
      "is_turbo": true,
      "short_description": "5,000 Starting Chips. 5 Minute Levels. Late Registration Through Level 12."
    },
    "blindProfile": "B11"
  },
  {
    "id": "4601510e-2b88-431c-8fa5-04b01415c9d1",
    "sourceScheduleId": "4601510e-2b88-431c-8fa5-04b01415c9d1",
    "sourceName": "Fixed Limit Omaha Hi-Lo Freezeout (FLO8)",
    "name": "Fixed Limit Omaha Hi-Lo Freezeout (FLO8)",
    "days": [
      4
    ],
    "times": [
      "09:15"
    ],
    "config": {
      "name": "Fixed Limit Omaha Hi-Lo Freezeout (FLO8)",
      "type": "freezeout",
      "buyIn": 10,
      "banChat": true,
      "isRebuy": false,
      "addonCost": null,
      "isReentry": false,
      "rebuyCost": null,
      "tableSize": 9,
      "addonChips": 5000,
      "maxPlayers": 500,
      "minPlayers": 4,
      "rebuyChips": 5000,
      "addonLevels": null,
      "blindPreset": "DEEPSTACK",
      "gameVariant": "flo8",
      "rebuyLevels": 12,
      "bigBlindAnte": false,
      "bountyAmount": 0,
      "payoutPreset": "NINE",
      "startingStack": 5000,
      "addOnAvailable": false,
      "addonFromStart": false,
      "guaranteedPrize": 250,
      "horsesToRegister": 0,
      "addonBreakMinutes": 1,
      "lateRegistrationLevels": 12,
      "lateRegistrationMode": "levels",
      "lateRegistrationMinutes": 0,
      "maxRebuys": 0,
      "maxReentries": 0,
      "addOnChips": 5000,
      "addOnCost": null,
      "midwayWeeklyRevision": "owner-sheet-2026-11-07-v1",
      "midwaySourceScheduleId": "4601510e-2b88-431c-8fa5-04b01415c9d1"
    },
    "terms": {
      "game_type": "FLO8",
      "variant": "freezeout",
      "tournament_type": "MTT",
      "table_size": 9,
      "is_bounty": false,
      "is_pko": false,
      "is_mystery_bounty": false,
      "bounty_amount": 0,
      "mystery_bounty_min": 0,
      "mystery_bounty_max": 0,
      "mystery_bounty_activation": "at_the_money",
      "mystery_bounty_activation_value": null,
      "mystery_bounty_profile": "classic",
      "mystery_bounty_top_percent": 20,
      "mystery_bounty_regular_pool_percent": 50,
      "mystery_bounty_pool_percent": 50,
      "is_rebuy": false,
      "is_reentry": false,
      "rebuy_cost": null,
      "max_rebuys": 0,
      "max_reentries": 0,
      "add_on_available": false,
      "addon_cost": null,
      "addon_from_start": false,
      "addon_break_minutes": 1,
      "free_buy": false,
      "all_in_or_fold": false,
      "is_pinned": false,
      "big_blind_ante": false,
      "synchronized_breaks": true,
      "ban_chat": true,
      "satellite_seats": null,
      "name": "Fixed Limit Omaha Hi-Lo Freezeout (FLO8)",
      "buy_in_amount": 9,
      "buy_in_fee": 1,
      "guaranteed_prize": 250,
      "starting_chips": 5000,
      "late_reg_levels": 12,
      "late_reg_mins": 0,
      "rebuy_chips": null,
      "rebuy_levels": null,
      "addon_chips": null,
      "addon_levels": null,
      "accelerated_mtt": false,
      "blind_speed": "turbo",
      "is_turbo": true,
      "short_description": "5,000 Starting Chips. 5 Minute Levels. Late Registration Through Level 12."
    },
    "blindProfile": "B11"
  }
]$events$::jsonb;
  source text := pg_get_functiondef('public.fn_ca_midway_weekly_catalog()'::regprocedure);
  original text := split_part(source,'$catalog$',2);
  doc jsonb := original::jsonb;
  morning jsonb;
  addition jsonb;
  field text;
  inserted integer;
BEGIN
  IF jsonb_array_length(additions) <> 2
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(doc->'events') e WHERE (e->>'id')::uuid = ANY(new_ids))
     OR EXISTS (SELECT 1 FROM public.tournament_schedules WHERE id = ANY(new_ids)) THEN
    RAISE EXCEPTION 'Fixed-limit weekly events changed since qualification: already installed';
  END IF;

  SELECT e INTO morning FROM jsonb_array_elements(doc->'events') e WHERE (e->>'id')::uuid = source_id;
  IF morning IS NULL OR NOT EXISTS (
       SELECT 1 FROM public.tournament_schedules s
       WHERE s.id = source_id AND s.active AND s.config->>'gameVariant' = 'plo8'
         AND s.config->>'midwayWeeklyRevision' = morning#>>'{config,midwayWeeklyRevision}') THEN
    RAISE EXCEPTION 'PLO8 Morning Stack changed since qualification: not an active weekly PLO8 row';
  END IF;
  -- Still the smallest active weekly PLO8 row: lowest total, ties by guarantee.
  IF EXISTS (
       SELECT 1 FROM public.tournament_schedules s
       WHERE s.active AND (s.club_id = midway OR s.union_id = midway) AND s.config->>'gameVariant' = 'plo8'
         AND ((s.config->>'buyIn')::numeric, coalesce((s.config->>'guaranteedPrize')::numeric, 0))
           < ((morning#>>'{config,buyIn}')::numeric, (morning#>>'{config,guaranteedPrize}')::numeric)) THEN
    RAISE EXCEPTION 'PLO8 Morning Stack changed since qualification: a smaller active PLO8 row exists';
  END IF;

  FOR addition IN SELECT value FROM jsonb_array_elements(additions) LOOP
    FOREACH field IN ARRAY copied_config LOOP
      IF NOT (morning->'config' ? field) OR addition->'config'->field IS DISTINCT FROM morning->'config'->field THEN
        RAISE EXCEPTION 'PLO8 Morning Stack changed since qualification: config %', field;
      END IF;
    END LOOP;
    FOREACH field IN ARRAY copied_terms LOOP
      IF NOT (morning->'terms' ? field) OR addition->'terms'->field IS DISTINCT FROM morning->'terms'->field THEN
        RAISE EXCEPTION 'PLO8 Morning Stack changed since qualification: terms %', field;
      END IF;
    END LOOP;
    IF addition->'days' IS DISTINCT FROM morning->'days'
       OR addition->>'blindProfile' IS DISTINCT FROM morning->>'blindProfile'
       OR jsonb_typeof(doc->'profiles'->(addition->>'blindProfile')) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'PLO8 Morning Stack changed since qualification: day or ladder';
    END IF;
    -- A fixed-limit freezeout MTT; four-card Omaha seats at most ten.
    IF addition#>>'{terms,game_type}' NOT IN ('FLH','FLO8')
       OR addition#>>'{config,gameVariant}' IS DISTINCT FROM lower(addition#>>'{terms,game_type}')
       OR addition#>>'{config,type}' IS DISTINCT FROM 'freezeout'
       OR addition#>'{terms,is_rebuy}' IS DISTINCT FROM 'false'::jsonb
       OR addition#>'{terms,is_reentry}' IS DISTINCT FROM 'false'::jsonb
       OR addition#>'{terms,add_on_available}' IS DISTINCT FROM 'false'::jsonb
       OR (addition#>>'{terms,table_size}')::integer > 10
       OR addition->>'name' IS DISTINCT FROM addition#>>'{config,name}'
       OR addition->>'name' IS DISTINCT FROM addition#>>'{terms,name}'
       OR addition->>'id' IS DISTINCT FROM addition#>>'{config,midwaySourceScheduleId}' THEN
      RAISE EXCEPTION 'Fixed-limit event % is not a coherent fixed-limit freezeout', addition->>'name';
    END IF;
    -- One weekly slot inside 6 AM to 11 PM Chicago that no active Midway schedule uses.
    IF jsonb_array_length(addition->'days') <> 1 OR jsonb_array_length(addition->'times') <> 1
       OR addition#>>'{times,0}' NOT BETWEEN '06:00' AND '23:00'
       OR EXISTS (
         SELECT 1 FROM public.tournament_schedules s
         WHERE s.active AND (s.club_id = midway OR s.union_id = midway)
           AND (addition#>>'{days,0}')::integer = ANY(s.days_of_week)
           AND addition#>>'{times,0}' = ANY(s.start_times_utc)) THEN
      RAISE EXCEPTION 'Fixed-limit slot for % is taken or outside 6 AM to 11 PM', addition->>'name';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT (e#>>'{days,0}') || ' ' || (e#>>'{times,0}')) FROM jsonb_array_elements(additions) e) <> 2 THEN
    RAISE EXCEPTION 'The two fixed-limit events share a slot';
  END IF;

  doc := jsonb_set(doc, '{events}', (doc->'events') || additions);
  EXECUTE replace(source, '$catalog$'||original||'$catalog$', '$catalog$'||doc::text||'$catalog$');

  INSERT INTO public.tournament_schedules(id,club_id,union_id,name,description,active,days_of_week,start_times_utc,interval_minutes,time_zone,config)
  SELECT r.id,r.club_id,r.union_id,r.name,r.description,r.active,r.days_of_week,r.start_times_utc,r.interval_minutes,r.time_zone,r.config
  FROM jsonb_populate_recordset(NULL::public.tournament_schedules, public.fn_ca_midway_weekly_catalog()) r
  WHERE r.id = ANY(new_ids);
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted <> 2 OR (
       SELECT count(*) FROM public.tournament_schedules s
       WHERE s.id = ANY(new_ids) AND s.active
         AND public.fn_ca_midway_weekly_terms(s.id)->>'game_type' = upper(s.config->>'gameVariant')
         AND s.config->'blindStructure' = (SELECT m.config->'blindStructure' FROM public.tournament_schedules m WHERE m.id = source_id)) <> 2 THEN
    RAISE EXCEPTION 'Fixed-limit weekly schedules did not install from the catalog';
  END IF;
END $fixed_limit$;
COMMIT;
