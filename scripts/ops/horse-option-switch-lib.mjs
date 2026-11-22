// scripts/ops/horse-option-switch-lib.mjs
// Pure, deterministic core logic for the Horse option switch CLI.
// Zero production I/O or secret reads: all database/health/filesystem inputs are passed in.

export const LEGAL_STATES = Object.freeze(['off', 'shadow', 'on_shadow', 'on']);
export const SHADOW_STATES = Object.freeze(['shadow', 'on_shadow']);
export const EVIDENCE_REQUIRED_STATES = Object.freeze(['on', 'on_shadow']);
export const CONFIG_ALARM_FEATURES = Object.freeze([
  'option_switch_config_invalid_seen',
  'option_switch_config_unreadable_seen',
  'option_switch_config_stale_seen',
]);

export const OPTION_NAME_RE = /^[A-Za-z][A-Za-z0-9]{0,99}$/;
export const SHA256_RE = /^[0-9a-f]{64}$/;
export const RELEASE_SHA_RE = /^[0-9a-f]{40}$/;

export const DEFAULT_MIN_PICKUP_WORKERS = 8;
export const CROSS_LANE_SPACING_MINUTES = 10;
export const SELF_LANE_SPACING_MINUTES = 60;
export const WINDOW_MINUTE_MIN = 6;
export const WINDOW_MINUTE_MAX = 43;
export const DAILY_BLACKOUT_START_UTC_MINUTES = 9 * 60 + 5; // 09:05Z
export const DAILY_BLACKOUT_END_UTC_MINUTES = 10 * 60 + 45; // 10:45Z

/**
 * Parent -> nested priced children that execute ONLY inside the parent's gate.
 * Switching a parent to `off` while any listed child is `on` or `on_shadow`
 * silently disables the priced child on live tables and is hard-forbidden.
 */
export const NESTED_PRICED_CHILD_DEPENDENCIES = Object.freeze({
  holdemRiverFullHouseValue: Object.freeze(['holdemRiverFullHouseValueIsPriced']),
  v87FlopStabCheckRaise: Object.freeze(['holdemPersonaPostflopIsPriced']),
});

/**
 * Exact option names that are hard-forbidden from ever being switched here
 * (mirrors OPTION_SWITCH_REFUSED in server/src/engine/HorseOptionSwitch.ts).
 */
export const HARD_FORBIDDEN_OPTIONS = Object.freeze({
  v87DeepDiveDiscipline: 'owner hold: Pillar 2 lives inside the deep-dive discipline',
  v87ShouldSuppressOmahaPositionStab: 'owner hold: Pillar 2',
  v41Leaks: 'owner hold: leak maps',
  v31GtoSuitAware: 'owner hold: the V31 solver store (R7/R8) is registration-gated',
  v53PloTourneyIcm: 'authority-gated: held-out PLO tournament cards',
  vpipFloorDeepStackOff: 'withdrawn by law: HorseWithdrawnRulesStayOff',
  omahaPreflopCallWithActionBehind: 'withdrawn by law: HorseWithdrawnRulesStayOff',
  phase8Postflop: 'phase pack: worker-owned phase authority',
  phase8PolicyFamily: 'phase pack: worker-owned phase authority',
  phase8CatastropheGuard: 'phase pack: worker-owned phase authority',
  phase10Plo4: 'phase pack: worker-owned phase authority',
  phase11Omaha: 'phase pack: worker-owned phase authority',
  phase12Remaining: 'phase pack: worker-owned phase authority',
  phase13Joint: 'phase pack: worker-owned phase authority',
  phase14: 'phase pack: worker-owned phase authority',
  phase14Corrective: 'phase pack: worker-owned phase authority',
});

/**
 * Name patterns that are hard-forbidden (mirrors HELD_PATTERNS in HorseOptionSwitch.ts).
 */
export const HARD_FORBIDDEN_PATTERNS = Object.freeze([
  Object.freeze([/pillar/i, 'owner hold: Pillar 2']),
  Object.freeze([/^phase\d/i, 'phase pack: worker-owned phase authority']),
  Object.freeze([/held[-_]?out|holdout/i, 'owner hold: held-out packs']),
  Object.freeze([
    /v31|(^|[^a-z0-9])r[78]($|[^a-z0-9])|round[78]/i,
    'owner hold: R7/R8 solver rounds',
  ]),
  Object.freeze([/leak[-_]?map/i, 'owner hold: leak maps']),
]);

// --- Strict validators & SQL literal escaping --------------------------------------------------

export function assertSafeOptionName(option) {
  if (typeof option !== 'string' || !OPTION_NAME_RE.test(option)) {
    throw new Error(`Invalid option name "${String(option)}": must match ${OPTION_NAME_RE.source}`);
  }
  return option;
}

export function assertSafeState(state) {
  if (typeof state !== 'string' || !LEGAL_STATES.includes(state)) {
    throw new Error(
      `Invalid target state "${String(state)}": legal states are ${LEGAL_STATES.join(', ')}`
    );
  }
  return state;
}

export function assertSafeSha256(sha, label = 'evidenceSha') {
  if (typeof sha !== 'string' || !SHA256_RE.test(sha)) {
    throw new Error(`Invalid ${label} "${String(sha)}": must be 64 lowercase hex characters`);
  }
  return sha;
}

export function assertSafeActor(actor) {
  if (typeof actor !== 'string') {
    throw new Error('Actor (--changed-by) is required');
  }
  const trimmed = actor.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new Error('Actor (--changed-by) must be between 1 and 200 characters');
  }
  if (trimmed.includes('\0') || /[\r\n]/.test(trimmed)) {
    throw new Error('Actor (--changed-by) must not contain NUL bytes or newlines');
  }
  return trimmed;
}

export function assertSafeNote(note) {
  if (typeof note !== 'string') {
    throw new Error('Switch note must be a string');
  }
  if (note.includes('\0')) {
    throw new Error('Switch note must not contain NUL bytes');
  }
  if (note.length > 500) {
    throw new Error(`Switch note is ${note.length} characters (maximum 500)`);
  }
  return note;
}

/**
 * Escapes a string as a PostgreSQL standard single-quoted literal.
 * Rejects non-strings and NUL bytes so generated SQL is always injection-safe.
 */
export function sqlLiteral(value) {
  if (typeof value !== 'string') {
    throw new Error(`sqlLiteral expects a string, got ${typeof value}`);
  }
  if (value.includes('\0')) {
    throw new Error('sqlLiteral refuses strings containing NUL bytes');
  }
  return `'${value.replace(/'/g, "''")}'`;
}

// --- SQL builders (read-only & write RPC) ------------------------------------------------------

export function buildRegistryRefusalSql(option, state) {
  const safeOpt = assertSafeOptionName(option);
  const safeState = assertSafeState(state);
  return `SELECT public.fn_ca_horse_option_registry_refusal(${sqlLiteral(safeOpt)}, ${sqlLiteral(safeState)}) AS refusal;`;
}

export function buildStatusQueries() {
  return {
    switchRows:
      'SELECT option, state, updated_by, updated_at, note FROM public.ca_horse_style_switch ORDER BY option;',
    recentAudit:
      'SELECT id, option, old_state, new_state, changed_by, changed_at, note FROM public.ca_horse_style_switch_audit ORDER BY changed_at DESC, id DESC LIMIT 50;',
    servingRegistries:
      "SELECT release_sha, registry, registry_digest, first_seen_at, seen_at FROM public.ca_horse_option_registry_serving WHERE seen_at >= now() - interval '5 minutes' ORDER BY seen_at DESC, release_sha;",
    maintenanceState:
      "SELECT public.fn_platform_frozen() AS platform_frozen, to_regclass('public.engine_maintenance_break') IS NOT NULL AS has_break_table, to_regclass('public.engine_maintenance_windows') IS NOT NULL AS has_windows_table;",
    maintenanceBreakRows:
      'SELECT id, phase, announced_at, break_started_at, break_ends_at, enforce_freeze, reason, updated_at FROM public.engine_maintenance_break;',
    maintenanceWindowsRows:
      'SELECT * FROM public.engine_maintenance_windows WHERE now() BETWEEN COALESCE(player_notice_at, not_before, starts_at) AND COALESCE(not_after, ends_at) LIMIT 10;',
    recentConfigAlarms:
      "SELECT feature, sum(fires)::bigint AS fires, max(updated_at) AS last_at FROM public.horse_brain_telemetry WHERE day >= current_date - 1 AND feature LIKE 'option\\_switch\\_config\\_%' ESCAPE '\\' GROUP BY 1 ORDER BY 1;",
  };
}

export function buildEvidenceLookupSql(option, evidenceSha) {
  const safeOpt = assertSafeOptionName(option);
  const safeSha = assertSafeSha256(evidenceSha);
  return `SELECT id, option, evidence_path, evidence_sha256, kind, recorded_at FROM public.ca_horse_option_switch_evidence WHERE option = ${sqlLiteral(safeOpt)} AND evidence_sha256 = ${sqlLiteral(safeSha)} LIMIT 1;`;
}

export function buildSwitchSetSql({ option, targetState, changedBy, note }) {
  const safeOpt = assertSafeOptionName(option);
  const safeState = assertSafeState(targetState);
  const safeActor = assertSafeActor(changedBy);
  const safeNote = assertSafeNote(note);
  return `SELECT public.fn_ca_horse_option_switch_set(${sqlLiteral(safeOpt)}, ${sqlLiteral(safeState)}, ${sqlLiteral(safeActor)}, ${sqlLiteral(safeNote)}) AS result;`;
}

export function buildReadbackSql(option) {
  const safeOpt = assertSafeOptionName(option);
  return `SELECT s.option, s.state, s.updated_by, s.updated_at, s.note, (SELECT max(a.id) FROM public.ca_horse_style_switch_audit a WHERE a.option = s.option) AS latest_audit_id FROM public.ca_horse_style_switch s WHERE s.option = ${sqlLiteral(safeOpt)};`;
}

export function buildPickupTelemetrySql(option, expectedState) {
  const safeOpt = assertSafeOptionName(option);
  const safeState = assertSafeState(expectedState);
  const seenFeature = `option_switch_${safeOpt}_${safeState}_seen`;
  return `SELECT feature, sum(fires)::bigint AS fires, max(updated_at) AS last_at FROM public.horse_brain_telemetry WHERE day >= current_date - 1 AND (feature = ${sqlLiteral(seenFeature)} OR feature LIKE 'option\\_switch\\_config\\_%' ESCAPE '\\') GROUP BY 1 ORDER BY 1;`;
}

// --- Supabase CLI JSON output parser -----------------------------------------------------------

/**
 * Parses `supabase db query --linked -o json` output, handling:
 * - plain JSON array `[...]`
 * - object envelope `{ rows: [...] }` or `{ data: [...] }`
 * - CLI upgrade notice lines appended to stdout/stderr
 */
export function parseSupabaseQueryJson(rawOutput) {
  const text = String(rawOutput ?? '').trim();
  if (!text) return [];

  const tryParse = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };

  let parsed = tryParse(text);
  if (parsed === undefined) {
    // Strip leading/trailing non-JSON lines (e.g., CLI version notices or agent envelopes).
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      parsed = tryParse(text.slice(firstBracket, lastBracket + 1));
    }
  }
  if (parsed === undefined) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      parsed = tryParse(text.slice(firstBrace, lastBrace + 1));
    }
  }
  if (parsed === undefined) {
    throw new Error(`Unable to parse JSON from supabase db query output: ${text.slice(0, 240)}`);
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  if (parsed && Array.isArray(parsed.data)) return parsed.data;
  if (parsed && typeof parsed === 'object') return [parsed];
  throw new Error('Unexpected JSON shape from supabase db query output');
}

// --- Note builder (DB constraint compliant) ----------------------------------------------------

export function buildSwitchNote({
  option,
  targetState,
  reason,
  authority,
  evidenceSha,
  isStyleOption = false,
  isRollback = false,
}) {
  const safeOpt = assertSafeOptionName(option);
  const safeState = assertSafeState(targetState);
  const cleanReason = String(reason ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  const cleanAuthority = String(authority ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim();

  if (EVIDENCE_REQUIRED_STATES.includes(safeState) && !isStyleOption) {
    if (!cleanAuthority) {
      throw new Error(
        `State "${safeState}" for non-style option "${safeOpt}" requires --authority <path>`
      );
    }
    const safeSha = assertSafeSha256(evidenceSha, '--evidence-sha');
    const prefix = `authority: ${safeOpt} ${cleanAuthority} sha256 ${safeSha}`;
    if (prefix.length > 500) {
      throw new Error(`Authority citation exceeds 500 chars (${prefix.length})`);
    }
    if (!cleanReason) return prefix;
    const tag = isRollback ? 'rollback: ' : '';
    const combined = `${prefix} | ${tag}${cleanReason}`;
    if (combined.length <= 500) return combined;
    const budget = 500 - prefix.length - 3 - tag.length;
    if (budget <= 0) return prefix;
    return `${prefix} | ${tag}${cleanReason.slice(0, budget)}`;
  }

  if (!cleanReason) {
    throw new Error(`State "${safeState}" requires --reason "<why>"`);
  }
  const lead = isRollback ? `rollback: ${cleanReason}` : `${safeState}: ${cleanReason}`;
  const full = cleanAuthority ? `${lead}; authority: ${cleanAuthority}` : lead;
  return assertSafeNote(full);
}

// --- Individual fail-closed guards -------------------------------------------------------------

export function checkHardForbiddenOption(option) {
  const safeOpt = assertSafeOptionName(option);
  if (Object.hasOwn(HARD_FORBIDDEN_OPTIONS, safeOpt)) {
    return {
      ok: false,
      code: 'HARD_FORBIDDEN_OPTION',
      reason: `Option "${safeOpt}" is hard-forbidden (${HARD_FORBIDDEN_OPTIONS[safeOpt]})`,
    };
  }
  for (const [pattern, why] of HARD_FORBIDDEN_PATTERNS) {
    if (pattern.test(safeOpt)) {
      return {
        ok: false,
        code: 'HARD_FORBIDDEN_PATTERN',
        reason: `Option "${safeOpt}" matches hard-forbidden pattern (${why})`,
      };
    }
  }
  return { ok: true };
}

export function checkNestedChildDependency(option, targetState, currentRows) {
  if (targetState !== 'off') return { ok: true };
  const children = NESTED_PRICED_CHILD_DEPENDENCIES[option];
  if (!children || children.length === 0) return { ok: true };

  const stateByOption = new Map((currentRows ?? []).map((r) => [r.option, r.state]));
  const blocking = children.filter((child) => {
    const childState = stateByOption.get(child);
    return childState === 'on' || childState === 'on_shadow';
  });

  if (blocking.length > 0) {
    return {
      ok: false,
      code: 'NESTED_PRICED_CHILD_ACTIVE',
      reason: `Refusing to switch "${option}" to off while nested priced child(ren) are active: ${blocking
        .map((c) => `${c}=${stateByOption.get(c)}`)
        .join(', ')}`,
    };
  }
  return { ok: true };
}

export function checkServingRegistry({ option, targetState, registryRefusal, servingRegistries }) {
  if (
    registryRefusal !== null &&
    registryRefusal !== undefined &&
    String(registryRefusal).trim() !== ''
  ) {
    return {
      ok: false,
      code: 'SERVING_REGISTRY_REFUSAL',
      reason: `fn_ca_horse_option_registry_refusal refused ${option}=${targetState}: ${registryRefusal}`,
    };
  }

  const fresh = Array.isArray(servingRegistries) ? servingRegistries : [];
  if (fresh.length === 0) {
    return {
      ok: false,
      code: 'NO_FRESH_SERVING_REGISTRY',
      reason:
        'No serving engine published its option registry in the last 5 minutes (fail-closed: cannot prove serving build supports option)',
    };
  }

  for (const row of fresh) {
    const reg = row.registry && typeof row.registry === 'object' ? row.registry : {};
    const shaShort = String(row.release_sha || 'unknown').slice(0, 12);
    if (!Object.hasOwn(reg, option)) {
      return {
        ok: false,
        code: 'OPTION_NOT_IN_SERVING_REGISTRY',
        reason: `Serving release ${shaShort} does not register option "${option}"`,
      };
    }
    const supported = Array.isArray(reg[option]) ? reg[option] : [];
    if (!supported.includes(targetState)) {
      return {
        ok: false,
        code: 'STATE_NOT_SUPPORTED_BY_SERVING_REGISTRY',
        reason: `Serving release ${shaShort} does not support state "${targetState}" for "${option}" (supported: ${supported.join(', ')})`,
      };
    }
  }

  const firstSupported = fresh[0].registry[option] ?? [];
  return {
    ok: true,
    isStyleOption: firstSupported.includes('canary'),
    supportedStates: firstSupported,
  };
}

export function checkShadowConcurrency({
  option,
  targetState,
  currentRows,
  releaseDefaultOn = false,
}) {
  const rows = Array.isArray(currentRows) ? currentRows : [];
  const currentRow = rows.find((r) => r.option === option) ?? null;

  if (SHADOW_STATES.includes(targetState)) {
    const activeShadow = rows.filter((r) => SHADOW_STATES.includes(r.state));
    if (activeShadow.length > 0) {
      return {
        ok: false,
        code: 'SHADOW_CONCURRENCY_VIOLATION',
        reason: `Active shadow/on_shadow row(s) already exist across lanes (must be 0 before entering ${targetState}): ${activeShadow
          .map((r) => `${r.option}=${r.state}`)
          .join(', ')}`,
      };
    }

    // SHADOW-PLAN-1 safety: moving an ON row to `shadow` drops it to source default (off for most options).
    if (targetState === 'shadow' && currentRow?.state === 'on' && !releaseDefaultOn) {
      return {
        ok: false,
        code: 'SHADOW_WOULD_DISABLE_LIVE_ON_ROW',
        reason: `Option "${option}" is currently "on" and not release-default ON: entering "shadow" would turn it OFF live. Use "on_shadow" instead.`,
      };
    }
  }

  return { ok: true, currentState: currentRow?.state ?? null };
}

export function checkUtcWindowAndBlackout({
  nowUtc,
  isRollback = false,
  allowWindowOverride = false,
  reason = '',
}) {
  const dt = nowUtc instanceof Date ? nowUtc : new Date(nowUtc);
  if (Number.isNaN(dt.getTime())) {
    return {
      ok: false,
      code: 'INVALID_CLOCK',
      reason: 'Invalid UTC timestamp supplied to window guard',
    };
  }

  const utcHour = dt.getUTCHours();
  const utcMinute = dt.getUTCMinutes();
  const utcMinutesOfDay = utcHour * 60 + utcMinute;

  const inDailyBlackout =
    utcMinutesOfDay >= DAILY_BLACKOUT_START_UTC_MINUTES &&
    utcMinutesOfDay <= DAILY_BLACKOUT_END_UTC_MINUTES;
  const inMinuteWindow = utcMinute >= WINDOW_MINUTE_MIN && utcMinute <= WINDOW_MINUTE_MAX;

  if (!inDailyBlackout && inMinuteWindow) {
    return { ok: true };
  }

  const detail = inDailyBlackout
    ? `UTC time ${String(utcHour).padStart(2, '0')}:${String(utcMinute).padStart(2, '0')}Z is inside daily 09:05Z-10:45Z blackout`
    : `UTC minute :${String(utcMinute).padStart(2, '0')} is outside legal :06-:43 switch window`;

  if (allowWindowOverride) {
    if (!isRollback) {
      return {
        ok: false,
        code: 'WINDOW_OVERRIDE_ROLLBACK_ONLY',
        reason: `${detail} (window override is permitted ONLY for explicit --rollback with audit --reason)`,
      };
    }
    if (!String(reason ?? '').trim()) {
      return {
        ok: false,
        code: 'WINDOW_OVERRIDE_REASON_REQUIRED',
        reason: `${detail} (rollback window override requires non-empty --reason)`,
      };
    }
    return {
      ok: true,
      overridden: true,
      warning: `Rollback window override applied: ${detail}`,
    };
  }

  return {
    ok: false,
    code: inDailyBlackout ? 'DAILY_BLACKOUT_WINDOW' : 'OUTSIDE_UTC_MINUTE_WINDOW',
    reason: detail,
  };
}

/**
 * Infers a canonical lane key from a `changed_by` actor string so cross-lane
 * vs self-lane spacing is accurate even when session IDs rotate.
 */
export function inferLaneFromActor(actor) {
  const s = String(actor ?? '').trim();
  if (!s) return 'unknown';
  const lower = s.toLowerCase();
  if (/horse[\s_-]*switch|hs-switch/i.test(s)) return 'horse-switch';
  if (/plo[\s_-]*owner|plo[\s_-]*lead/i.test(s)) return 'plo-owner';
  if (/holdem[\s_-]*strategy/i.test(s)) return 'holdem-strategy';
  if (/horse[\s_-]*decisions/i.test(s)) return 'horse-decisions';
  if (/release[\s_-]*operator|engine[\s_-]*custodian/i.test(s)) return 'release';
  return lower.replace(/\s+/g, ' ');
}

export function checkAuditSpacing({
  nowUtc,
  auditRows,
  changedBy,
  lane,
  option,
  isRollback = false,
}) {
  const dt = nowUtc instanceof Date ? nowUtc : new Date(nowUtc);
  if (Number.isNaN(dt.getTime())) {
    return { ok: false, code: 'INVALID_CLOCK', reason: 'Invalid UTC timestamp for spacing check' };
  }
  const rows = Array.isArray(auditRows) ? auditRows : [];
  if (rows.length === 0) return { ok: true };

  const sorted = [...rows]
    .filter((r) => r && r.changed_at)
    .map((r) => ({ ...r, tsMs: new Date(r.changed_at).getTime() }))
    .filter((r) => !Number.isNaN(r.tsMs))
    .sort((a, b) => b.tsMs - a.tsMs);

  if (sorted.length === 0) return { ok: true };

  const actorLane = (lane && String(lane).trim().toLowerCase()) || inferLaneFromActor(changedBy);
  const nowMs = dt.getTime();

  // 1. Cross-lane spacing: >= 10 minutes since ANY audit write
  //    (same-option rollback is allowed immediately to protect live tables)
  const latestAny = sorted[0];
  const sinceAnyMin = (nowMs - latestAny.tsMs) / 60_000;
  const isSameOptionRollback = isRollback && latestAny.option === option;
  if (sinceAnyMin < CROSS_LANE_SPACING_MINUTES && !isSameOptionRollback) {
    return {
      ok: false,
      code: 'CROSS_LANE_SPACING_VIOLATION',
      reason: `Cross-lane spacing violated: last switch write (${latestAny.option} -> ${latestAny.new_state} by ${latestAny.changed_by}) was ${sinceAnyMin.toFixed(1)} min ago (< ${CROSS_LANE_SPACING_MINUTES} min minimum)`,
    };
  }

  // 2. Self-lane spacing: >= 60 minutes since same lane's write (exempt for rollback)
  if (!isRollback) {
    const latestSelf = sorted.find((r) => {
      const rowLane = inferLaneFromActor(r.changed_by);
      return rowLane === actorLane || (changedBy && r.changed_by === changedBy);
    });
    if (latestSelf) {
      const sinceSelfMin = (nowMs - latestSelf.tsMs) / 60_000;
      if (sinceSelfMin < SELF_LANE_SPACING_MINUTES) {
        return {
          ok: false,
          code: 'SELF_LANE_SPACING_VIOLATION',
          reason: `Self-lane spacing violated for lane "${actorLane}": last write (${latestSelf.option} -> ${latestSelf.new_state}) was ${sinceSelfMin.toFixed(1)} min ago (< ${SELF_LANE_SPACING_MINUTES} min minimum; rollback is exempt)`,
        };
      }
    }
  }

  return { ok: true };
}

/**
 * Returns true when the text immediately preceding a `SEALED` token in the same clause
 * expresses a future/conditional target (e.g. "UNTIL 1:00 AM CST SEALED", "HOLD ... -> ... SEALED",
 * "NOT SEALED") or references an already-serving historical build ("ON SEALED <sha>").
 */
function isProspectiveOrReferenceSealPrefix(textBefore) {
  const clause = textBefore.slice(textBefore.lastIndexOf(';') + 1);
  if (/->|→/.test(clause)) return true;
  if (
    /\b(?:AFTER|UNTIL|TILL|BEFORE|NOT|ONCE|WHEN|WAITING\s+FOR|HELD|HOLD(?!\s+LIFTED)|HOLDING|NO\s+MERGES?|STOP\s+ALL|PAUSE)\b/i.test(
      clause
    )
  ) {
    return true;
  }
  if (/(?:\b(?:ON|OF|FROM|FOR)\s+|(?:POST|PRE)-)$/i.test(clause)) {
    return true;
  }
  return false;
}

/**
 * Fixed coordination inbox freeze parser (replaces switch.sh's brittle freeze_state()).
 * Handles:
 * - Both `T` and space between date and time, with or without `:SS` seconds
 * - Authoritative `CUTOVER-N BOOKING` vs `CUTOVER-N (IS )?SEALED` and `SEALED <sha> (...CUTOVER-N...)`
 * - Newer non-numbered / dated cutover seals (`SEALED: 7:00 AM CST (13:00Z) ENGINE CUTOVER <sha>`,
 *   `7:00 AM CST (13:00Z) SEALED`, `Engine Release <sha> SEALED`, `1906z SEALED <sha>`) clearing
 *   earlier booked cutovers while older numbered seals (`CUTOVER-8 SEALED`) never clear a newer
 *   numbered booking (`CUTOVER-9 BOOKING`)
 * - Prospective/conditional clauses (`AFTER`, `UNTIL`, `FOR`, `BEFORE`, `NOT`, `ONCE`, `WHEN`,
 *   `TILL`, `HOLD ... -> ... SEALED`, `POST-`, `PRE-`) so incidental mentions never unlock an active cutover
 * - Authoritative `BOOKING MERGED`, `MAIN LOCKED`, `ENGINE CUTOVER DISPATCHED`, and active
 *   `COMBINED CUTOVER HOLD` / `CUTOVER HOLD` entries detected fail-closed until cleared
 */
export function evaluateInboxFreezeState(inboxText) {
  if (typeof inboxText !== 'string') {
    return {
      frozen: true,
      reason: 'Coordination inbox unreadable: treated as locked (fail-closed)',
    };
  }

  const cutoverBookingRe =
    /(?<!AFTER )(?<!UNTIL )(?<!BEFORE )(?<!FOR THE )(?<!ON THE )\bCUTOVER-(\d+) BOOKING\b(?!\s+TIME\b)/g;
  const cutoverSealedRe = /\bCUTOVER-(\d+) (?:IS )?SEALED\b/g;
  const sealedShaRe = /(?<!\w)SEALED:?\s+`?[0-9a-f]{7,}\b/;
  const namedCutoverSealedRe =
    /\b(?:[Ee]ngine\s+(?:[Cc]utover|[Rr]elease)|ENGINE\s+(?:CUTOVER|RELEASE)|CUTOVER|WINDOW)\b[^;]*\bSEALED\b/;
  const datedCutoverSealedRe =
    /(?:\b\d{1,2}:\d{2}\s*(?:AM|PM)\s*(?:CST|CDT|CT|UTC)\b|\b\d{2}:?\d{2}[Zz]\b)[^;]*\bSEALED\b/;
  const headingRe = /^## (\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?Z\s+(.*)$/gm;
  const releaseAuthorityRe =
    /\b(?:ENGINE )?CUSTODIAN\b|Dedicated Engine (?:Custodian|Cutover)|RELEASE (?:OPERATOR|OWNER)|\bRELEASE-\d+\b|\bRELEASE[-_ ]VERIFY\b|\bPLO-OWNER lead-\d+\b/i;

  const booked = new Map();
  const sealed = new Map();
  let genericSeal = null;
  let lock = null;
  let seal = null;
  let holdLift = null;

  for (const m of inboxText.matchAll(headingRe)) {
    const ts = `${m[1]}T${m[2]}${m[3] || ':00'}Z`;
    const rest = m[4];
    const sm = /SUBJECT:\s*(.*)$/.exec(rest);
    const subj = sm ? sm[1] : rest.replace(/^(?:\u2014|--)\s*/, '');
    const head = rest.includes(' TO ') ? rest.split(' TO ')[0] : rest;
    const isAuthorityOrBare = releaseAuthorityRe.test(head) || !/\bFROM\b/.test(head);

    if (isAuthorityOrBare) {
      for (const bm of subj.matchAll(cutoverBookingRe)) {
        const n = Number(bm[1]);
        if (!booked.has(n) || ts > booked.get(n)) booked.set(n, ts);
      }
    }

    const sealedNums = [];
    for (const csm of subj.matchAll(cutoverSealedRe)) {
      if (!isProspectiveOrReferenceSealPrefix(subj.slice(0, csm.index))) {
        sealedNums.push(Number(csm[1]));
      }
    }
    const isLeadingSeal = /^`?SEALED\b/.test(subj);
    if (isLeadingSeal) {
      const firstClause = subj.split(';')[0];
      for (const cn of firstClause.matchAll(/\bCUTOVER-(\d+)\b/g)) {
        sealedNums.push(Number(cn[1]));
      }
    }
    for (const n of sealedNums) {
      if (!sealed.has(n) || ts > sealed.get(n)) sealed.set(n, ts);
    }

    if (isAuthorityOrBare) {
      let isGenuineSeal = isLeadingSeal || sealedNums.length > 0;
      if (!isGenuineSeal) {
        const shaMatch = sealedShaRe.exec(subj);
        if (shaMatch && !isProspectiveOrReferenceSealPrefix(subj.slice(0, shaMatch.index))) {
          isGenuineSeal = true;
        }
      }
      if (!isGenuineSeal) {
        const namedMatch = namedCutoverSealedRe.exec(subj);
        if (namedMatch) {
          const sealedOffset = namedMatch.index + namedMatch[0].lastIndexOf('SEALED');
          if (!isProspectiveOrReferenceSealPrefix(subj.slice(0, sealedOffset))) {
            isGenuineSeal = true;
          }
        }
      }
      if (!isGenuineSeal) {
        const datedMatch = datedCutoverSealedRe.exec(subj);
        if (datedMatch) {
          const sealedOffset = datedMatch.index + datedMatch[0].lastIndexOf('SEALED');
          if (!isProspectiveOrReferenceSealPrefix(subj.slice(0, sealedOffset))) {
            isGenuineSeal = true;
          }
        }
      }

      if (isGenuineSeal) {
        if (!seal || ts > seal.ts) seal = { ts, subj: subj.slice(0, 90) };
        if (sealedNums.length === 0) {
          if (!genericSeal || ts > genericSeal.ts) {
            genericSeal = { ts, subj: subj.slice(0, 90) };
          }
        }
      } else if (
        /^(?:CUTOVER-\d+ )?BOOKING MERGED\b/.test(subj) ||
        /\bMAIN (?:IS |STAYS |NOW )?LOCKED\b/.test(subj)
      ) {
        if (!lock || ts > lock.ts) {
          lock = { ts, kind: 'lock', label: 'MAIN LOCKED', subj: subj.slice(0, 90) };
        }
      } else if (
        /(?<!NOT )(?<!WAS )\b(?:ENGINE\s+CUTOVER|CUTOVER-\d+(?:\s+CERTIFIED\s*\+)?|\d{4}[Zz])\s+DISPATCHED\b/.test(
          subj
        ) &&
        !/\bkeep-serving\b/i.test(subj)
      ) {
        if (!lock || ts > lock.ts) {
          lock = { ts, kind: 'lock', label: 'CUTOVER DISPATCHED', subj: subj.slice(0, 90) };
        }
      } else if (
        /\b(?:COMBINED\s+)?CUTOVER\s+HOLD\b/.test(subj) &&
        !/\bHOLD\s+LIFTED\b/i.test(subj) &&
        !/\bACTIVE\s+AT\b/i.test(subj)
      ) {
        if (!lock || ts > lock.ts) {
          lock = { ts, kind: 'hold', label: 'COMBINED CUTOVER HOLD', subj: subj.slice(0, 90) };
        }
      }

      if (/\bHOLD\s+LIFTED\b/i.test(subj)) {
        if (!holdLift || ts > holdLift.ts) holdLift = { ts, subj: subj.slice(0, 90) };
      }
    }
  }

  if (booked.size > 0) {
    const maxN = Math.max(...booked.keys());
    const bookedTs = booked.get(maxN);
    let clearingSealTs = '';
    for (const [n, ts] of sealed.entries()) {
      if (n >= maxN && ts > clearingSealTs) clearingSealTs = ts;
    }
    if (genericSeal && genericSeal.ts > clearingSealTs) {
      clearingSealTs = genericSeal.ts;
    }
    if (clearingSealTs < bookedTs) {
      return {
        frozen: true,
        reason: `CUTOVER-${maxN} booked at ${bookedTs} and not SEALED since`,
      };
    }
  }

  if (lock) {
    const clearedBySeal = Boolean(seal && seal.ts >= lock.ts);
    const clearedByLift = lock.kind === 'hold' && Boolean(holdLift && holdLift.ts >= lock.ts);
    if (!clearedBySeal && !clearedByLift) {
      return {
        frozen: true,
        reason: `${lock.label} at ${lock.ts} (${lock.subj}), no later SEALED`,
      };
    }
  }

  let bestSealTs = genericSeal?.ts ?? '';
  let bestSealDesc = genericSeal ? `last SEALED ${genericSeal.ts}` : '';
  if (seal && seal.ts > bestSealTs) {
    bestSealTs = seal.ts;
    bestSealDesc = `last SEALED ${seal.ts}`;
  }
  for (const [n, ts] of sealed.entries()) {
    if (ts >= bestSealTs) {
      bestSealTs = ts;
      bestSealDesc = `last CUTOVER-${n} SEALED ${ts}`;
    }
  }
  if (bestSealDesc) {
    return {
      frozen: false,
      reason: `not frozen (${bestSealDesc})`,
    };
  }
  return {
    frozen: false,
    reason: `not frozen (last lock ${lock ? lock.ts : 'none'}, last SEALED ${seal ? seal.ts : 'none'})`,
  };
}

/**
 * Evaluates live cutover/maintenance holds from all structured sources:
 * 1. DB `fn_platform_frozen()` + `engine_maintenance_break` (hard freeze holds — block even rollbacks)
 *    + optional `engine_maintenance_windows` (advisory cutover hold)
 * 2. Repo `server/release/owner-maintenance-windows.json` (advisory cutover hold)
 * 3. Live engine `/health` maintenance & readiness state (advisory cutover hold)
 * 4. Optional coordination inbox text (fixed freeze_state parser; advisory cutover hold)
 *
 * When `isRollback === true` and `hardFreezeHolds.length === 0`, emergency rollbacks are NEVER
 * blocked by advisory cutover bookings or `/health` blips — they return `{ ok: true }` with
 * explicit warnings listing every advisory hold.
 */
export function checkMaintenanceAndCutoverHold({
  nowUtc,
  dbMaintenance = null,
  ownerWindowsConfig = null,
  engineHealth = null,
  inboxText = undefined,
  requireInbox = false,
  isRollback = false,
}) {
  const dt = nowUtc instanceof Date ? nowUtc : new Date(nowUtc);
  const nowMs = dt.getTime();
  const hardFreezeHolds = [];
  const advisoryCutoverHolds = [];

  // 1. DB maintenance state (fn_platform_frozen / engine_maintenance_break / engine_maintenance_windows)
  if (dbMaintenance) {
    if (dbMaintenance.platformFrozen === true) {
      hardFreezeHolds.push('DB fn_platform_frozen() is TRUE');
    }
    const breakRows = Array.isArray(dbMaintenance.breakRows) ? dbMaintenance.breakRows : [];
    for (const row of breakRows) {
      const phase = String(row.phase || '').toLowerCase();
      if (row.enforce_freeze === true || phase === 'last_hand' || phase === 'counting_down') {
        hardFreezeHolds.push(
          `DB engine_maintenance_break active (phase=${row.phase}, enforce_freeze=${row.enforce_freeze})`
        );
      }
    }
    const winRows = Array.isArray(dbMaintenance.windowRows) ? dbMaintenance.windowRows : [];
    if (winRows.length > 0) {
      advisoryCutoverHolds.push(
        `DB engine_maintenance_windows has ${winRows.length} active window(s)`
      );
    }
  }

  // 2. server/release/owner-maintenance-windows.json
  if (ownerWindowsConfig && Array.isArray(ownerWindowsConfig.windows) && !Number.isNaN(nowMs)) {
    for (const w of ownerWindowsConfig.windows) {
      const startIso = w.playerNoticeAt || w.notBefore;
      const endIso = w.notAfter;
      if (!startIso || !endIso) continue;
      const startMs = new Date(startIso).getTime();
      const endMs = new Date(endIso).getTime();
      if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && nowMs >= startMs && nowMs <= endMs) {
        advisoryCutoverHolds.push(
          `owner-maintenance-windows.json window "${w.id || 'unnamed'}" active (${startIso} .. ${endIso})`
        );
      }
    }
  }

  // 3. Live engine /health maintenance & readiness
  if (engineHealth) {
    if (engineHealth.error) {
      advisoryCutoverHolds.push(`Engine /health unreachable: ${engineHealth.error}`);
    } else {
      if (engineHealth.status && engineHealth.status !== 'ok') {
        advisoryCutoverHolds.push(`Engine /health status=${engineHealth.status}`);
      }
      if (engineHealth.liveness && engineHealth.liveness !== 'ok') {
        advisoryCutoverHolds.push(`Engine /health liveness=${engineHealth.liveness}`);
      }
      const m = engineHealth.maintenance;
      if (m && typeof m === 'object') {
        if (m.active === true) {
          advisoryCutoverHolds.push(
            `Engine /health maintenance.active=true (phase=${m.phase ?? 'unknown'})`
          );
        } else if (m.phase && m.phase !== 'idle') {
          advisoryCutoverHolds.push(`Engine /health maintenance.phase=${m.phase}`);
        } else if (m.readyForRestart === true || m.durableConfirmed === true) {
          advisoryCutoverHolds.push(
            `Engine /health maintenance restart armed (readyForRestart=${m.readyForRestart}, durableConfirmed=${m.durableConfirmed})`
          );
        }
      }
      const lhd = engineHealth.liveHorseDecision;
      if (lhd && typeof lhd === 'object') {
        if (lhd.phase && lhd.phase !== 'ready') {
          advisoryCutoverHolds.push(`Engine liveHorseDecision.phase=${lhd.phase}`);
        }
        const manifestSha = lhd.upgradeManifest?.sourceRevision;
        if (manifestSha && engineHealth.releaseSha && manifestSha !== engineHealth.releaseSha) {
          advisoryCutoverHolds.push(
            `Engine decision service revision mismatch (${String(manifestSha).slice(0, 12)} != ${String(engineHealth.releaseSha).slice(0, 12)})`
          );
        }
      }
    }
  }

  // 4. Optional coordination inbox check
  if (requireInbox || inboxText !== undefined) {
    const inboxEval = evaluateInboxFreezeState(inboxText);
    if (inboxEval.frozen) {
      advisoryCutoverHolds.push(`Coordination inbox freeze: ${inboxEval.reason}`);
    }
  }

  const holds = [...hardFreezeHolds, ...advisoryCutoverHolds];

  if (isRollback && hardFreezeHolds.length === 0) {
    const warnings = advisoryCutoverHolds.map(
      (h) => `Rollback bypassing advisory cutover/health hold: ${h}`
    );
    return {
      ok: true,
      holds: [],
      hardFreezeHolds: [],
      advisoryCutoverHolds,
      warnings,
      isRollback: true,
    };
  }

  if (holds.length > 0) {
    const activeBlockers = isRollback ? hardFreezeHolds : holds;
    return {
      ok: false,
      code: 'MAINTENANCE_OR_CUTOVER_HOLD',
      reason: `Cutover/maintenance hold active (${activeBlockers.length}): ${activeBlockers.join('; ')}`,
      holds,
      hardFreezeHolds,
      advisoryCutoverHolds,
      isRollback,
    };
  }

  return {
    ok: true,
    holds: [],
    hardFreezeHolds: [],
    advisoryCutoverHolds: [],
    warnings: [],
  };
}

// --- Full preflight orchestration (pure) -------------------------------------------------------

export function evaluatePreflight(input) {
  const {
    option,
    targetState,
    nowUtc = new Date(),
    changedBy = '',
    lane = '',
    reason = '',
    authority = '',
    evidenceSha = '',
    isRollback = false,
    allowWindowOverride = false,
    currentRows = [],
    auditRows = [],
    servingRegistries = [],
    registryRefusal = null,
    evidenceRecorded = null,
    releaseDefaultOn = false,
    dbMaintenance = null,
    ownerWindowsConfig = null,
    engineHealth = null,
    inboxText = undefined,
    requireInbox = false,
    recentConfigAlarms = [],
  } = input;

  const failures = [];
  const warnings = [];

  // 1. Strict option name and target state validation
  try {
    assertSafeOptionName(option);
  } catch (err) {
    failures.push({ code: 'INVALID_OPTION_NAME', reason: err.message });
  }
  try {
    assertSafeState(targetState);
  } catch (err) {
    failures.push({ code: 'INVALID_TARGET_STATE', reason: err.message });
  }
  if (failures.length > 0) {
    return { ok: false, failures, warnings, isStyleOption: false, currentState: null };
  }

  // 2. Hard-forbidden options (Pillar 2 / owner-held / withdrawn / phase packs)
  const forbidden = checkHardForbiddenOption(option);
  if (!forbidden.ok) failures.push(forbidden);

  // 3. Nested priced child dependency guard
  const nested = checkNestedChildDependency(option, targetState, currentRows);
  if (!nested.ok) failures.push(nested);

  // 4. Serving registry & fn_ca_horse_option_registry_refusal guard
  const regCheck = checkServingRegistry({
    option,
    targetState,
    registryRefusal,
    servingRegistries,
  });
  if (!regCheck.ok) failures.push(regCheck);
  const isStyleOption = Boolean(regCheck.isStyleOption);

  // 5. Shadow concurrency & SHADOW-PLAN-1 live-ON guard
  const shadowCheck = checkShadowConcurrency({
    option,
    targetState,
    currentRows,
    releaseDefaultOn,
  });
  if (!shadowCheck.ok) failures.push(shadowCheck);

  // 6. UTC minute window (:06-:43) & daily blackout (09:05Z-10:45Z)
  const windowCheck = checkUtcWindowAndBlackout({
    nowUtc,
    isRollback,
    allowWindowOverride,
    reason,
  });
  if (!windowCheck.ok) failures.push(windowCheck);
  else if (windowCheck.warning) warnings.push(windowCheck.warning);

  // 7. Cross-lane (>=10m) & self-lane (>=60m, rollback exempt) audit spacing
  const spacingCheck = checkAuditSpacing({
    nowUtc,
    auditRows,
    changedBy,
    lane,
    option,
    isRollback,
  });
  if (!spacingCheck.ok) failures.push(spacingCheck);

  // 8. Live cutover / maintenance hold
  const maintCheck = checkMaintenanceAndCutoverHold({
    nowUtc,
    dbMaintenance,
    ownerWindowsConfig,
    engineHealth,
    inboxText,
    requireInbox,
    isRollback,
  });
  if (!maintCheck.ok) failures.push(maintCheck);
  else if (Array.isArray(maintCheck.warnings) && maintCheck.warnings.length > 0) {
    warnings.push(...maintCheck.warnings);
  }

  // 9. Active recent config alarms check (within last 15 minutes)
  const dtMs = (nowUtc instanceof Date ? nowUtc : new Date(nowUtc)).getTime();
  const hotAlarms = (recentConfigAlarms ?? []).filter((a) => {
    if (!a || !a.feature || !String(a.feature).startsWith('option_switch_config_')) return false;
    if (Number(a.fires ?? 0) <= 0 || !a.last_at) return false;
    const lastMs = new Date(a.last_at).getTime();
    return !Number.isNaN(lastMs) && !Number.isNaN(dtMs) && dtMs - lastMs <= 15 * 60_000;
  });
  if (hotAlarms.length > 0 && !isRollback) {
    failures.push({
      code: 'ACTIVE_CONFIG_ALARMS',
      reason: `Workers reported switch config alarm(s) in the last 15 minutes: ${hotAlarms
        .map((a) => `${a.feature}(fires=${a.fires}, last=${a.last_at})`)
        .join(', ')}`,
    });
  }

  // 10. Evidence & authority check for `on` and `on_shadow` (non-style options)
  if (EVIDENCE_REQUIRED_STATES.includes(targetState) && !isStyleOption) {
    if (!String(authority ?? '').trim()) {
      failures.push({
        code: 'AUTHORITY_REQUIRED',
        reason: `State "${targetState}" requires --authority <path>`,
      });
    }
    if (!SHA256_RE.test(String(evidenceSha ?? ''))) {
      failures.push({
        code: 'EVIDENCE_SHA_REQUIRED',
        reason: `State "${targetState}" requires --evidence-sha <64 lowercase hex>`,
      });
    } else if (evidenceRecorded === false) {
      failures.push({
        code: 'EVIDENCE_NOT_RECORDED',
        reason: `Evidence sha256 ${evidenceSha} for "${option}" is not recorded in public.ca_horse_option_switch_evidence`,
      });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    isStyleOption,
    currentState: shadowCheck.currentState ?? null,
  };
}

// --- Source registry metadata helper (pure) ----------------------------------------------------

/**
 * Parses `OPTION_SWITCH_RELEASE_DEFAULT_ON` option names from `server/src/engine/HorseOptionSwitch.ts`
 * source text so `preflight`/`set` knows whether an explicit `on` row is release-default-ON.
 */
export function parseReleaseDefaultOnOptions(sourceText) {
  const result = new Set();
  if (typeof sourceText !== 'string' || !sourceText) return result;
  const anchor =
    /export\s+const\s+OPTION_SWITCH_RELEASE_DEFAULT_ON\b[^=]*=\s*(?:Object\.freeze\s*\(\s*)?\[/.exec(
      sourceText
    );
  if (!anchor) return result;
  const openIdx = anchor.index + anchor[0].length - 1;
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let closeIdx = -1;
  for (let i = openIdx; i < sourceText.length; i += 1) {
    const ch = sourceText[i];
    const next = sourceText[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (inSingle) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === "'") {
        inSingle = false;
      }
      continue;
    }
    if (inDouble) {
      if (ch === '\\') {
        i += 1;
      } else if (ch === '"') {
        inDouble = false;
      }
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0) return result;
  const block = sourceText
    .slice(openIdx + 1, closeIdx)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  for (const m of block.matchAll(/['"]([A-Za-z][A-Za-z0-9]{0,99})['"]/g)) {
    result.add(m[1]);
  }
  return result;
}

// --- Pickup verification (pure) ----------------------------------------------------------------

/**
 * Extracts a `{ [feature]: fires }` map of pre-existing `option_switch_config_*` alarm counts
 * from telemetry rows captured before a switch write so `verify-pickup` diffs against them.
 */
export function extractAlarmBaseline(telemetryRows) {
  const baseline = {};
  for (const row of telemetryRows ?? []) {
    if (
      !row ||
      typeof row.feature !== 'string' ||
      !row.feature.startsWith('option_switch_config_')
    ) {
      continue;
    }
    const fires = Number(row.fires ?? 0);
    if (Number.isFinite(fires) && fires > 0) {
      baseline[row.feature] = (baseline[row.feature] ?? 0) + Math.floor(fires);
    }
  }
  return baseline;
}

/**
 * Strictly parses and validates a JSON object passed to `--alarm-baseline <json>`.
 */
export function parseAlarmBaselineJson(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return {};
  }
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch (err) {
    throw new Error(`Invalid --alarm-baseline JSON: ${err?.message || String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid --alarm-baseline: must be a JSON object mapping feature -> count');
  }
  const normalized = {};
  for (const [feature, count] of Object.entries(parsed)) {
    if (!feature.startsWith('option_switch_config_') || !/^[A-Za-z0-9_]+$/.test(feature)) {
      throw new Error(
        `Invalid --alarm-baseline key "${feature}": must match option_switch_config_*`
      );
    }
    const num = Number(count);
    if (!Number.isInteger(num) || num < 0) {
      throw new Error(
        `Invalid --alarm-baseline count for "${feature}": must be a non-negative integer, got "${count}"`
      );
    }
    normalized[feature] = num;
  }
  return normalized;
}

export function evaluatePickup({
  option,
  expectedState,
  telemetryRows = [],
  baseline = 0,
  minWorkers = DEFAULT_MIN_PICKUP_WORKERS,
  alarmBaseline = {},
}) {
  const safeOpt = assertSafeOptionName(option);
  const safeState = assertSafeState(expectedState);
  const baseNum = Number(baseline);
  if (!Number.isFinite(baseNum) || baseNum < 0) {
    throw new Error(`Invalid --baseline "${baseline}": must be a non-negative integer`);
  }
  const minW = Number(minWorkers);
  if (!Number.isFinite(minW) || minW < 1) {
    throw new Error(`Invalid --min-workers "${minWorkers}": must be >= 1`);
  }
  if (!alarmBaseline || typeof alarmBaseline !== 'object' || Array.isArray(alarmBaseline)) {
    throw new Error('Invalid alarmBaseline: must be a plain object');
  }

  const targetFeature = `option_switch_${safeOpt}_${safeState}_seen`;
  const byFeature = new Map();
  for (const row of telemetryRows ?? []) {
    if (!row || !row.feature) continue;
    byFeature.set(row.feature, {
      fires: Number(row.fires ?? 0),
      lastAt: row.last_at ?? null,
    });
  }

  const seenEntry = byFeature.get(targetFeature) ?? { fires: 0, lastAt: null };
  const delta = seenEntry.fires - baseNum;

  const alarms = [];
  for (const [feature, entry] of byFeature.entries()) {
    if (!feature.startsWith('option_switch_config_')) continue;
    const prev = Number(alarmBaseline?.[feature] ?? 0);
    if (!Number.isFinite(prev) || prev < 0) {
      throw new Error(
        `Invalid alarmBaseline value for "${feature}": ${String(alarmBaseline[feature])}`
      );
    }
    const alarmDelta = entry.fires - prev;
    if (alarmDelta > 0) {
      alarms.push({ feature, fires: entry.fires, delta: alarmDelta, lastAt: entry.lastAt });
    }
  }

  const failures = [];
  if (alarms.length > 0) {
    failures.push({
      code: 'PICKUP_CONFIG_ALARM',
      reason: `Detected ${alarms.length} option_switch_config_* alarm(s): ${alarms
        .map((a) => `${a.feature} (+${a.delta})`)
        .join(', ')}`,
    });
  }
  if (delta < minW) {
    failures.push({
      code: 'PICKUP_INSUFFICIENT_WORKERS',
      reason: `${targetFeature} delta is ${delta} (current=${seenEntry.fires}, baseline=${baseNum}), need >= ${minW} workers`,
    });
  }

  return {
    ok: failures.length === 0,
    targetFeature,
    currentFires: seenEntry.fires,
    baseline: baseNum,
    delta,
    minWorkers: minW,
    alarmBaseline,
    alarms,
    failures,
  };
}

// --- Structured SWITCH-CHANGES.log audit line formatter ----------------------------------------

export function formatChicagoTimestamp(utcDate) {
  const dt = utcDate instanceof Date ? utcDate : new Date(utcDate);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).formatToParts(dt);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')} ${get('timeZoneName')}`;
}

export function formatSwitchChangeLogLine({
  timestampUtc,
  option,
  fromState,
  toState,
  changedBy,
  reason,
  verified,
}) {
  const dt = timestampUtc instanceof Date ? timestampUtc : new Date(timestampUtc);
  const utcIso = dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const chicago = formatChicagoTimestamp(dt);
  const safeOpt = assertSafeOptionName(option);
  const safeFrom = fromState || 'default';
  const safeTo = assertSafeState(toState);
  const safeActor = String(changedBy || 'unknown')
    .replace(/[|\r\n]+/g, ' ')
    .trim();
  const safeReason = String(reason || '')
    .replace(/\|/g, '/')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 200);
  const safeVerified = String(verified || 'pending')
    .replace(/[|\r\n]+/g, ' ')
    .trim();

  return `${utcIso} | ${chicago} | ${safeOpt} | ${safeFrom} -> ${safeTo} | ${safeActor} | ${safeReason} | verified: ${safeVerified}`;
}

// --- CLI argument parser (pure) ----------------------------------------------------------------

export function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? [...argv] : [];
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    return { command: 'help', positionals: [], flags: {} };
  }

  const command = args.shift();
  const positionals = [];
  const flags = {
    json: false,
    dryRun: false,
    rollback: false,
    allowWindowOverride: false,
    requireInbox: false,
    reason: '',
    authority: '',
    evidenceSha: '',
    changedBy: '',
    lane: '',
    logFile: '',
    healthUrl: 'https://engine.smarter.poker/health',
    windowsFile: 'server/release/owner-maintenance-windows.json',
    inboxFile: '',
    workdir: '',
    baseline: 0,
    minWorkers: DEFAULT_MIN_PICKUP_WORKERS,
    alarmBaseline: {},
    now: '',
  };

  const valueFlags = new Map([
    ['--reason', 'reason'],
    ['--authority', 'authority'],
    ['--evidence-sha', 'evidenceSha'],
    ['--changed-by', 'changedBy'],
    ['--lane', 'lane'],
    ['--log-file', 'logFile'],
    ['--health-url', 'healthUrl'],
    ['--windows-file', 'windowsFile'],
    ['--inbox-file', 'inboxFile'],
    ['--workdir', 'workdir'],
    ['--baseline', 'baseline'],
    ['--min-workers', 'minWorkers'],
    ['--alarm-baseline', 'alarmBaseline'],
    ['--now', 'now'],
  ]);

  const boolFlags = new Map([
    ['--json', 'json'],
    ['--dry-run', 'dryRun'],
    ['--rollback', 'rollback'],
    ['--allow-window-override', 'allowWindowOverride'],
    ['--require-inbox', 'requireInbox'],
  ]);

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (boolFlags.has(token)) {
      flags[boolFlags.get(token)] = true;
    } else if (valueFlags.has(token)) {
      if (i + 1 >= args.length) {
        throw new Error(`Flag ${token} requires a value`);
      }
      const key = valueFlags.get(token);
      const val = args[++i];
      if (key === 'baseline' || key === 'minWorkers') {
        const num = Number(val);
        if (!Number.isInteger(num) || num < 0) {
          throw new Error(`Flag ${token} must be a non-negative integer, got "${val}"`);
        }
        flags[key] = num;
      } else if (key === 'alarmBaseline') {
        flags[key] = parseAlarmBaselineJson(val);
      } else {
        flags[key] = val;
      }
    } else if (token.startsWith('-')) {
      throw new Error(`Unknown flag: ${token}`);
    } else {
      positionals.push(token);
    }
  }

  return { command, positionals, flags };
}
