/**
 * Cross-build Horse decision replay: the pure half (no engine import, no file or network access).
 *
 * The question this answers: "does this change alter any Horse decision while its switches are as they are in
 * production?" The same decision states are fed to `HorseLogic.decide` on two builds with the same option rows and
 * the same random seeds, and the full decision JSON and the rule receipts are compared.
 *
 * This file holds what can be tested on fixtures: the state-set plan, the deterministic input variations, the
 * synthetic opponent history, the option rows and their named variants, the comparison, the grouping by receipt
 * and the printed report. The half that loads a build is horse-decision-crossbuild-replay-engine.mjs; the command
 * line is horse-decision-crossbuild-replay.mjs. Method and limits: docs/ops/horse-flag-off-check.md.
 */

export const STATE_SET_SCHEMA = 'horse-crossbuild-states/v1';
export const REPLAY_SCHEMA = 'horse-crossbuild-replay/v1';
export const DIFF_SCHEMA = 'horse-crossbuild-diff/v1';
/** 1 = the one-off harness of 2026-11-22 (person present, VPIP floor, Lightning, synthetic bomb pot);
 *  2 adds the synthetic opponent history. A replay header records it; two replays compare only on the same one. */
export const AUGMENT_VERSION = 2;
export const DEFAULT_SEEDS = Object.freeze([1, 20261122]);
/** The decision clock every replayed decision runs on (also the mood hour). */
export const FIXED_NOW_MS = 1795400000000;
export const MEMORY_MODES = Object.freeze(['some', 'off', 'all']);
/** Synthetic hands observed before a decision that carries opponent history. */
export const DEFAULT_MEMORY_HANDS = 60;
export const QUICK_SCALE = 0.21;

/**
 * The groups of the state set. `full` is the count the 2026-11-22 run used (14,051 generated states); the quick set
 * scales every group by QUICK_SCALE (about 3,000 states). `seats` cycles by hand index. `weak` marks a group whose
 * states are not dealt by the engine the way production deals them; its result is weak evidence and is printed so.
 */
export const GROUP_PLANS = Object.freeze({
  plo4_cash_6max: { variant: 'plo4', mode: 'cash', seats: [6], full: 1600, seed0: 110000 },
  plo4_cash_hu: { variant: 'plo4', mode: 'cash', seats: [2], full: 1200, seed0: 120000 },
  plo4_cash_345: { variant: 'plo4', mode: 'cash', seats: [3, 4, 5], full: 700, seed0: 130000 },
  plo5_cash_6max: { variant: 'plo5', mode: 'cash', seats: [6], full: 1600, seed0: 210000 },
  plo5_cash_hu: { variant: 'plo5', mode: 'cash', seats: [2], full: 1200, seed0: 220000 },
  plo5_cash_345: { variant: 'plo5', mode: 'cash', seats: [3, 4, 5], full: 700, seed0: 230000 },
  plo6_cash: { variant: 'plo6', mode: 'cash', seats: [6, 2, 4], full: 800, seed0: 310000 },
  plo4_tourn: {
    variant: 'plo4',
    mode: 'tournament',
    seats: [6, 6, 2, 4],
    full: 800,
    seed0: 410000,
  },
  plo5_tourn: {
    variant: 'plo5',
    mode: 'tournament',
    seats: [6, 6, 2, 4],
    full: 800,
    seed0: 510000,
  },
  nlh_cash: { variant: 'nlh', mode: 'cash', seats: [6, 2, 6, 9], full: 900, seed0: 610000 },
  nlh_tourn: { variant: 'nlh', mode: 'tournament', seats: [6, 6, 2, 9], full: 600, seed0: 710000 },
  // ordinary cash deals; the replay marks them as Lightning pools (publicMemoryDomain.speed = 'lightning')
  lightning_plo4: { variant: 'plo4', mode: 'cash', seats: [6, 6, 2, 4], full: 500, seed0: 810000 },
  lightning_plo5: { variant: 'plo5', mode: 'cash', seats: [6, 6, 2, 4], full: 500, seed0: 820000 },
  lightning_nlh: { variant: 'nlh', mode: 'cash', seats: [6, 6, 2, 4], full: 300, seed0: 830000 },
  // ordinary cash deals; the replay turns the postflop ones into bomb pots, two in three with a second board.
  // WEAK: the league generator deals single-board hands only, so the preflop action history is still there.
  bombsrc_plo4: {
    variant: 'plo4',
    mode: 'cash',
    seats: [6, 4, 5],
    full: 900,
    seed0: 910000,
    weak: 'synthetic bomb pot / double board',
  },
  bombsrc_plo5: {
    variant: 'plo5',
    mode: 'cash',
    seats: [6, 4, 5],
    full: 900,
    seed0: 920000,
    weak: 'synthetic bomb pot / double board',
  },
});
export const GROUP_NAMES = Object.freeze(Object.keys(GROUP_PLANS));
export const CASH_STACKS_BB = Object.freeze([100, 100, 40, 200, 60, 150]);
export const TOURNAMENT_STACKS_BB = Object.freeze([20, 12, 40, 30, 80, 8]);
export const BASE_STYLES = Object.freeze(['tag', 'lag', 'balanced', 'tricky', 'grinder']);

/** States to generate per group: `set` is 'quick' or 'full'; `scale` (a positive number) overrides the set. */
export function planTargets(set = 'quick', scale = null, groups = null) {
  if (set !== 'quick' && set !== 'full')
    throw new Error(`unknown state set "${set}" (quick or full)`);
  const f =
    scale === null || scale === undefined ? (set === 'full' ? 1 : QUICK_SCALE) : Number(scale);
  if (!Number.isFinite(f) || f <= 0 || f > 20) throw new Error('scale must be a number in (0, 20]');
  const names = groups && groups.length ? groups : GROUP_NAMES;
  const out = {};
  for (const g of names) {
    if (!GROUP_PLANS[g]) throw new Error(`unknown group "${g}" (known: ${GROUP_NAMES.join(', ')})`);
    out[g] = Math.max(1, Math.round(GROUP_PLANS[g].full * f));
  }
  return out;
}

/** The hand a group deals at hand index h: seed, seats, stack, tournament kind, hybrid or base styles. */
export function handPlan(group, h) {
  const p = GROUP_PLANS[group];
  if (!p) throw new Error(`unknown group "${group}"`);
  const seats = p.seats[h % p.seats.length];
  const stackBB = (p.mode === 'cash' ? CASH_STACKS_BB : TOURNAMENT_STACKS_BB)[h % 6];
  const kind = p.mode === 'cash' ? null : seats === 2 ? 'hu' : h % 2 === 0 ? 'mid' : 'final';
  // production Horses play the hybrid profile; every third hand seats the five base styles instead
  const hybrid = h % 3 !== 2;
  const sub = `${seats}max/${stackBB}bb${kind ? '/' + kind : ''}${hybrid ? '/hybrid' : '/base'}`;
  return {
    seed: p.seed0 + h,
    seats,
    stackBB,
    kind,
    hybrid,
    sub,
    dealerSeat: 1 + (h % seats),
    variant: p.variant,
    mode: p.mode,
  };
}

/** Preflop decisions are thinned (1 in 3 heads-up, 1 in 4 otherwise) so the later streets are well covered. */
export function keepsCapturedDecision(stage, handSeed, nthDecision, seats) {
  return stage !== 'preflop' || (handSeed * 31 + nthDecision * 17) % (seats === 2 ? 3 : 4) === 0;
}

export function mulberry32(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const DECK = [];
for (const rank of ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'])
  for (const suit of ['clubs', 'diamonds', 'hearts', 'spades']) DECK.push({ rank, suit });

// ---------------------------------------------------------------------------------------------------------------
// Options: the production switch snapshot (docs/horse-option-switch-state.json) and named variants
// ---------------------------------------------------------------------------------------------------------------

const SWITCH_STATES = new Set(['off', 'on', 'shadow', 'on_shadow', 'canary']);

/**
 * Option rows from an options file. Two layouts are read:
 *   - the repo snapshot `horse-option-switch-state/v1`: { rows: { <option>: { state, auditId, changedAt } } }
 *   - plain rows: { rows: { <option>: "on" | "off" | ... } } (what `select option, state` gives)
 */
export function optionRowsFromJson(json) {
  if (!json || typeof json !== 'object' || !json.rows || typeof json.rows !== 'object')
    throw new Error('options file has no "rows" object');
  const rows = {};
  for (const [name, value] of Object.entries(json.rows)) {
    const state =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? value.state
          : undefined;
    if (!SWITCH_STATES.has(state))
      throw new Error(`options file: "${name}" has no usable state (${JSON.stringify(value)})`);
    rows[name] = state;
  }
  if (Object.keys(rows).length === 0) throw new Error('options file has no rows');
  return {
    rows,
    source: {
      schema: typeof json.schema === 'string' ? json.schema : 'plain-rows',
      asOfUtc: typeof json.asOfUtc === 'string' ? json.asOfUtc : null,
      auditMax: Number.isFinite(json.auditMax) ? json.auditMax : null,
    },
  };
}

/**
 * A named variant of the option set.
 *   "+omahaStreetPlan=on"            sets that option's ROW (mapped by each build's own switch code, so a build that
 *                                    refuses or does not know the option does not get it, and the replay says so)
 *   "+raw:someDecideOption=true"     sets a decide option directly, past the switch registry (a dark option that
 *                                    has no row); the value is JSON
 */
export function parseVariant(text) {
  const m = /^\+?(raw:)?([A-Za-z][A-Za-z0-9_.]*)=(.+)$/.exec(String(text).trim());
  if (!m) throw new Error(`variant "${text}" is not "+option=on|off" or "+raw:option=<json>"`);
  if (m[1]) {
    let value;
    try {
      value = JSON.parse(m[3]);
    } catch {
      throw new Error(`variant "${text}": the raw value is not JSON`);
    }
    return { kind: 'raw', name: m[2], value };
  }
  if (!SWITCH_STATES.has(m[3]))
    throw new Error(`variant "${text}": state must be one of ${[...SWITCH_STATES].join(', ')}`);
  return { kind: 'row', name: m[2], state: m[3] };
}

/** The rows with the row variants applied, and the raw decide options to lay over the mapped set. */
export function applyVariants(rows, variants = []) {
  const out = { ...rows };
  const raw = {};
  const expect = {};
  for (const v of variants.map((x) => (typeof x === 'string' ? parseVariant(x) : x))) {
    if (v.kind === 'raw') raw[v.name] = v.value;
    else {
      out[v.name] = v.state;
      expect[v.name] = v.state;
    }
  }
  return { rows: out, raw, expect };
}

/** Stable short digest of an option row set or a received decide-option set (sorted keys). */
export function digestOf(value) {
  const sorted = (v) =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted(v[k])])
          )
        : v;
  const text = JSON.stringify(sorted(value));
  return (
    hashString(text).toString(16).padStart(8, '0') +
    hashString(text.split('').reverse().join('')).toString(16).padStart(8, '0')
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Deterministic input variations: they depend only on the state line and its index, never on the build
// ---------------------------------------------------------------------------------------------------------------

/** True when state index `idx` carries a synthetic opponent history under memory mode `mode`. */
export function stateCarriesMemory(idx, mode = 'some') {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return idx % 4 === 2;
}

/**
 * Mutates the state and returns its tags. Identical on both builds. `journal_*` groups (real recorded requests)
 * are replayed as recorded.
 */
export function augmentState(st, idx, { memory = 'some' } = {}) {
  const tags = [];
  const gs = st.gs;
  const g = String(st.group ?? '');
  const real = g.startsWith('journal');
  if (g.startsWith('lightning_')) {
    gs.publicMemoryDomain = { ...(gs.publicMemoryDomain ?? {}), speed: 'lightning' };
    tags.push('lightning');
  }
  if (g.startsWith('bombsrc_')) {
    gs.bombPot = true;
    if (idx % 3 !== 0 && (gs.communityCards?.length ?? 0) >= 3) {
      const used = new Set(
        [...(st.player.cards ?? []), ...gs.communityCards].map((c) => c.rank + c.suit)
      );
      const rest = DECK.filter((c) => !used.has(c.rank + c.suit));
      const r = mulberry32(st.seed * 131 + idx);
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      gs.communityCards2 = rest.slice(0, gs.communityCards.length);
      gs.boardCount = 2;
      tags.push('bomb_double_board');
    } else {
      gs.boardCount = 1;
      tags.push('bomb_single_board');
    }
  }
  if (!real && gs.gameMode === 'cash') {
    if (idx % 2 === 1) {
      const opp = (gs.players ?? []).find((p) => p.seat !== st.player.seat && !p.is_folded);
      if (opp) {
        gs.humanUserIds = [opp.user_id];
        tags.push('person_present');
      }
    }
    if (idx % 3 === 0 && gs.stage === 'preflop') {
      gs.vpipFloor = 50;
      gs.vpipWindowHands = 30;
      gs.ownVpip = { hands: 30, vpip: [20, 45, 56.7, 36.7][((idx / 3) % 4) | 0] };
      tags.push('vpip_floor');
    }
  }
  if (!real && stateCarriesMemory(idx, memory)) tags.push('opponent_memory');
  return tags;
}

export const MEMORY_PERSONAS = Object.freeze({
  //            open  3bet  callPre  cbet  barrel  foldToBet  raiseBet  size
  maniac: {
    open: 0.55,
    reraise: 0.3,
    callPre: 0.3,
    bet: 0.8,
    barrel: 0.7,
    foldToBet: 0.15,
    raiseBet: 0.3,
    size: 0.9,
  },
  nit: {
    open: 0.12,
    reraise: 0.03,
    callPre: 0.1,
    bet: 0.35,
    barrel: 0.3,
    foldToBet: 0.75,
    raiseBet: 0.03,
    size: 0.5,
  },
  station: {
    open: 0.1,
    reraise: 0.02,
    callPre: 0.7,
    bet: 0.15,
    barrel: 0.1,
    foldToBet: 0.1,
    raiseBet: 0.02,
    size: 0.4,
  },
  regular: {
    open: 0.28,
    reraise: 0.1,
    callPre: 0.25,
    bet: 0.6,
    barrel: 0.5,
    foldToBet: 0.45,
    raiseBet: 0.1,
    size: 0.66,
  },
});
const PERSONA_NAMES = Object.keys(MEMORY_PERSONAS);

/** The persona a seat plays in the synthetic history: fixed per (user id, state), so reads differ across states. */
export function memoryPersonaOf(userId, stateKey) {
  return PERSONA_NAMES[hashString(`${userId}|${stateKey}`) % PERSONA_NAMES.length];
}

/**
 * The synthetic opponent history of one state: `hands` complete hands among the state's own seats, each a list of
 * action records in the engine's history layout ({seat, userId, action, amount, timestamp, stage}), plus the players
 * who reached showdown. Every seat plays a fixed persona (maniac, nit, station, regular) drawn from its id and the
 * state key, so a read-dependent rule meets real evidence rather than an empty prior. Deterministic: it depends
 * only on the state and the hand count. It is NOT a recorded history and proves nothing about a real opponent.
 */
export function syntheticMemoryHands(st, { hands = DEFAULT_MEMORY_HANDS } = {}) {
  const gs = st.gs;
  const players = (gs.players ?? [])
    .filter((p) => p && typeof p.user_id === 'string')
    .slice()
    .sort((a, b) => a.seat - b.seat);
  if (players.length < 2) return [];
  const bb = Number(gs.bigBlind) > 0 ? Number(gs.bigBlind) : 2;
  const base = hashString(String(st.k));
  const out = [];
  for (let h = 0; h < hands; h++) {
    const r = mulberry32(base ^ Math.imul(h + 1, 0x9e3779b1));
    const order = players.map((_, i) => players[(i + h) % players.length]);
    let ts = 900_000_000 + h * 1000;
    const history = [];
    const push = (p, action, amount, stage, full) => {
      const rec = { seat: p.seat, userId: p.user_id, action, amount, timestamp: ts++, stage };
      if (full) rec.isFullRaise = true;
      history.push(rec);
    };
    // preflop: one orbit, at most one open and one re-raise
    let live = [];
    let price = bb;
    let opener = null;
    let reraiser = null;
    const paid = new Map();
    for (const p of order) {
      const persona = MEMORY_PERSONAS[memoryPersonaOf(p.user_id, st.k)];
      const x = r();
      if (!opener) {
        if (x < persona.open) {
          price = bb * 3;
          opener = p;
          push(p, 'raise', price, 'preflop', true);
          paid.set(p.user_id, price);
          live.push(p);
        } else if (x < persona.open + persona.callPre * 0.5) {
          push(p, 'call', bb, 'preflop');
          paid.set(p.user_id, bb);
          live.push(p);
        } else push(p, 'fold', 0, 'preflop');
      } else if (!reraiser && x < persona.reraise) {
        price = price * 3;
        reraiser = p;
        push(p, 'raise', price, 'preflop', true);
        paid.set(p.user_id, price);
        live.push(p);
      } else if (x < persona.reraise + persona.callPre) {
        push(p, 'call', price - (paid.get(p.user_id) ?? 0), 'preflop');
        paid.set(p.user_id, price);
        live.push(p);
      } else push(p, 'fold', 0, 'preflop');
    }
    // seats that put in less than the final price answer it once
    for (const p of live.slice()) {
      if ((paid.get(p.user_id) ?? 0) >= price) continue;
      const persona = MEMORY_PERSONAS[memoryPersonaOf(p.user_id, st.k)];
      if (r() < persona.foldToBet) {
        push(p, 'fold', 0, 'preflop');
        live = live.filter((q) => q !== p);
      } else {
        push(p, 'call', price - (paid.get(p.user_id) ?? 0), 'preflop');
        paid.set(p.user_id, price);
      }
    }
    let pot = [...paid.values()].reduce((a, b) => a + b, 0) || bb;
    let aggressor = reraiser ?? opener;
    for (const stage of ['flop', 'turn', 'river']) {
      if (live.length < 2) break;
      let bettor = null;
      let bet = 0;
      for (const p of live.slice()) {
        const persona = MEMORY_PERSONAS[memoryPersonaOf(p.user_id, st.k)];
        if (!bettor) {
          const want =
            p === aggressor
              ? stage === 'flop'
                ? persona.bet
                : persona.barrel
              : persona.bet * 0.35;
          if (r() < want) {
            bet = Math.max(bb, Math.round(pot * persona.size));
            bettor = p;
            push(p, 'bet', bet, stage, true);
          } else push(p, 'check', 0, stage);
        } else {
          const x = r();
          if (x < persona.foldToBet) {
            push(p, 'fold', 0, stage);
            live = live.filter((q) => q !== p);
          } else if (x < persona.foldToBet + persona.raiseBet) {
            push(p, 'raise', bet * 3, stage, true);
            // the bettor answers the raise once
            const bp = MEMORY_PERSONAS[memoryPersonaOf(bettor.user_id, st.k)];
            if (r() < bp.foldToBet) {
              push(bettor, 'fold', 0, stage);
              live = live.filter((q) => q !== bettor);
            } else push(bettor, 'call', bet * 2, stage);
            pot += bet * 6;
            aggressor = p;
            bettor = p;
            bet = bet * 3;
          } else {
            push(p, 'call', bet, stage);
            pot += bet;
          }
        }
      }
      if (bettor) {
        // seats that checked before the bet answer it once
        for (const p of live.slice()) {
          if (p === bettor) continue;
          const last = [...history]
            .reverse()
            .find((a) => a.userId === p.user_id && a.stage === stage);
          if (!last || last.action !== 'check') continue;
          const persona = MEMORY_PERSONAS[memoryPersonaOf(p.user_id, st.k)];
          if (r() < persona.foldToBet) {
            push(p, 'fold', 0, stage);
            live = live.filter((q) => q !== p);
          } else {
            push(p, 'call', bet, stage);
            pot += bet;
          }
        }
        pot += bet;
        aggressor = bettor;
      }
    }
    const showdown =
      live.length >= 2 ? live.map((p) => ({ user_id: p.user_id, mucked: false })) : null;
    out.push({ key: `xbuild:${st.k}:${h}`, history, showdown });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------------------------------------------

export function decisionKey(row) {
  return `${row.k}#${row.seed}`;
}

/** What the Horse faces in a state, for the breakdown of a report. */
export function facingOf(st) {
  const gs = st?.gs;
  if (!gs) return 'unknown';
  const aggressive = (gs.actionHistory ?? []).filter(
    (a) => a.stage === gs.stage && ['bet', 'raise', 'all_in'].includes(a.action)
  ).length;
  if (gs.stage === 'preflop')
    return !(gs.toCall > 0)
      ? 'pre_option_check'
      : aggressive === 0
        ? 'pre_unraised'
        : aggressive === 1
          ? 'pre_facing_raise'
          : 'pre_facing_3bet+';
  return !(gs.toCall > 0) ? 'checked_to_or_first' : aggressive <= 1 ? 'facing_bet' : 'facing_raise';
}

/** The JSON paths at which the base decision `a` and the head decision `b` differ (array indexes folded into "[]"; at most `cap` paths). */
export function jsonPaths(a, b, cap = 60) {
  const out = [];
  const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'arr' : typeof v);
  const walk = (x, y, p) => {
    if (out.length > cap || x === y) return;
    const tx = kind(x);
    const ty = kind(y);
    if (tx !== ty || (tx !== 'object' && tx !== 'arr')) {
      out.push(p || '.');
      return;
    }
    if (tx === 'arr') {
      if (x.length !== y.length) {
        out.push(p + '[len]');
        return;
      }
      for (let i = 0; i < x.length; i++) walk(x[i], y[i], p + '[]');
      return;
    }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (!(k in x)) out.push(`${p}.${k} (only head)`);
      else if (!(k in y)) out.push(`${p}.${k} (only base)`);
      else walk(x[k], y[k], `${p}.${k}`);
    }
  };
  walk(a, b, '');
  return [...new Set(out)];
}

const receiptName = (fire) => String(fire).replace(/:\d+$/, '');

/** Receipts of one decision against the other: names only one side fired, and names both fired a different number of times. */
export function receiptDelta(headFires = [], baseFires = []) {
  const count = (fires) => {
    const m = new Map();
    for (const f of fires) {
      const n = Number(/:(\d+)$/.exec(String(f))?.[1] ?? 1);
      m.set(receiptName(f), (m.get(receiptName(f)) ?? 0) + n);
    }
    return m;
  };
  const h = count(headFires);
  const b = count(baseFires);
  const onlyHead = [...h.keys()].filter((n) => !b.has(n)).sort();
  const onlyBase = [...b.keys()].filter((n) => !h.has(n)).sort();
  const countChanged = [...h.keys()].filter((n) => b.has(n) && b.get(n) !== h.get(n)).sort();
  return { onlyHead, onlyBase, countChanged };
}

/** The receipt signature a differing decision is grouped under. */
export function receiptSignature(delta) {
  const parts = [];
  if (delta.onlyHead.length) parts.push(`head only: ${delta.onlyHead.join(', ')}`);
  if (delta.onlyBase.length) parts.push(`base only: ${delta.onlyBase.join(', ')}`);
  if (!parts.length && delta.countChanged.length)
    parts.push(`fired a different number of times: ${delta.countChanged.join(', ')}`);
  return parts.length ? parts.join(' | ') : '(no receipt difference)';
}

const bump = (map, key, by = 1) => {
  map[key] = (map[key] ?? 0) + by;
};

/**
 * Compares two replays of the same states. `head` and `base` are iterables of replay rows; `states` (optional) maps a
 * state key to its state, for the "facing" breakdown. A decision differs when ANY of these differ: the action or
 * amount, the full decision JSON, the receipts, an error on either side, the opponent-history seeding status, or
 * its presence in only one replay.
 */
export function diffDecisions({ head, base, states = null }) {
  const H = new Map();
  const B = new Map();
  for (const r of head) H.set(decisionKey(r), r);
  for (const r of base) B.set(decisionKey(r), r);
  const emptyGroup = () => ({
    decisionsHead: 0,
    decisionsBase: 0,
    compared: 0,
    identical: 0,
    actionAmountDiffs: 0,
    actionDiffs: 0,
    amountOnlyDiffs: 0,
    jsonOnlyDiffs: 0,
    receiptsOnlyDiffs: 0,
    errorDiffs: 0,
    memoryStatusDiffs: 0,
    missing: 0,
    errorsHead: 0,
    errorsBase: 0,
    bothErrored: 0,
    byStage: {},
    byTag: {},
  });
  const groups = {};
  const of = (g) => (groups[g] ??= emptyGroup());
  const differences = [];
  for (const [key, h] of H) {
    const s = of(h.group);
    s.decisionsHead++;
    const b = B.get(key);
    if (!b) {
      s.missing++;
      differences.push({
        key,
        k: h.k,
        seed: h.seed,
        group: h.group,
        kind: 'missing',
        side: 'base',
        signature: 'decision missing from the base replay',
      });
      continue;
    }
    s.compared++;
    if (h.error) s.errorsHead++;
    if (b.error) s.errorsBase++;
    if (h.error || b.error) {
      if (h.error && b.error && h.error === b.error) {
        s.bothErrored++;
        continue;
      }
      s.errorDiffs++;
      differences.push({
        key,
        k: h.k,
        seed: h.seed,
        group: h.group,
        kind: 'error',
        signature: `decide threw on ${h.error && b.error ? 'both builds, differently' : h.error ? 'head only' : 'base only'}`,
        headError: h.error ?? null,
        baseError: b.error ?? null,
      });
      continue;
    }
    bump(s.byStage, h.stage);
    for (const t of h.tags?.length ? h.tags : ['none']) bump(s.byTag, t);
    const delta = receiptDelta(h.fires, b.fires);
    const receiptsDiffer = (h.fires ?? []).join(',') !== (b.fires ?? []).join(',');
    const st = states ? states.get(h.k) : null;
    const common = {
      key,
      k: h.k,
      seed: h.seed,
      group: h.group,
      sub: h.sub ?? null,
      stage: h.stage,
      tags: h.tags ?? [],
      facing: st ? facingOf(st) : null,
      head: [h.action, h.amount ?? null],
      base: [b.action, b.amount ?? null],
      receipts: delta,
      signature: receiptSignature(delta),
    };
    const paths = () => {
      try {
        return jsonPaths(JSON.parse(b.j), JSON.parse(h.j)).slice(0, 25);
      } catch {
        return ['(decision JSON unreadable)'];
      }
    };
    if (h.action !== b.action || (h.amount ?? null) !== (b.amount ?? null)) {
      s.actionAmountDiffs++;
      if (h.action !== b.action) s.actionDiffs++;
      else s.amountOnlyDiffs++;
      differences.push({
        ...common,
        kind: h.action !== b.action ? 'action' : 'amount',
        paths: paths(),
      });
    } else if (h.j !== b.j) {
      s.jsonOnlyDiffs++;
      differences.push({ ...common, kind: 'json', paths: paths() });
    } else if (receiptsDiffer) {
      s.receiptsOnlyDiffs++;
      differences.push({ ...common, kind: 'receipts' });
    } else if ((h.mem ?? null) !== (b.mem ?? null)) {
      s.memoryStatusDiffs++;
      differences.push({
        ...common,
        kind: 'memory',
        signature: `opponent history seeded differently (head ${h.mem ?? 'none'}, base ${b.mem ?? 'none'})`,
      });
    } else s.identical++;
  }
  for (const [key, b] of B) {
    const s = of(b.group);
    s.decisionsBase++;
    if (!H.has(key)) {
      s.missing++;
      differences.push({
        key,
        k: b.k,
        seed: b.seed,
        group: b.group,
        kind: 'missing',
        side: 'head',
        signature: 'decision missing from the head replay',
      });
    }
  }
  const totals = emptyGroup();
  for (const s of Object.values(groups))
    for (const [k, v] of Object.entries(s)) if (typeof v === 'number') totals[k] += v;
  delete totals.byStage;
  delete totals.byTag;
  return {
    schema: DIFF_SCHEMA,
    totals,
    differences: differences.length,
    groups,
    byReceipt: groupByReceipt(differences),
    examples: differences,
  };
}

/** Differing decisions grouped by receipt signature, largest group first. */
export function groupByReceipt(differences) {
  const by = new Map();
  for (const d of differences) {
    let g = by.get(d.signature);
    if (!g) {
      g = {
        signature: d.signature,
        decisions: 0,
        states: new Set(),
        kinds: {},
        groups: {},
        transitions: {},
        stages: {},
        facing: {},
        tags: {},
        example: d,
      };
      by.set(d.signature, g);
    }
    g.decisions++;
    g.states.add(d.k);
    bump(g.kinds, d.kind);
    bump(g.groups, d.group);
    if (d.head && d.base)
      bump(
        g.transitions,
        `${d.base[0]}${d.base[1] === null ? '' : ' ' + d.base[1]} -> ${d.head[0]}${d.head[1] === null ? '' : ' ' + d.head[1]}`.replace(
          / \d+(\.\d+)?/g,
          ''
        )
      );
    if (d.stage) bump(g.stages, d.stage);
    if (d.facing) bump(g.facing, d.facing);
    for (const t of d.tags ?? []) bump(g.tags, t);
  }
  return [...by.values()]
    .map((g) => ({ ...g, states: g.states.size }))
    .sort((a, b) => b.decisions - a.decisions || (a.signature < b.signature ? -1 : 1));
}

const tally = (m) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

/**
 * Things that make a comparison unsound or weaker than it looks, read from the two replay headers: a different
 * state set, seeds, input variations or Node version, an option one build did not receive, engine parts one build
 * does not have, opponent history that could not be seeded.
 */
export function headerWarnings(headHeader, baseHeader) {
  const w = [];
  if (!headHeader || !baseHeader)
    return ['a replay header is missing: the two replays cannot be checked against each other'];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(headHeader.stateSet?.id, baseHeader.stateSet?.id))
    w.push(
      `REFUSE: the two replays read different state sets (${headHeader.stateSet?.id} vs ${baseHeader.stateSet?.id})`
    );
  if (!same(headHeader.seeds, baseHeader.seeds))
    w.push(
      `REFUSE: the two replays used different seeds (${headHeader.seeds} vs ${baseHeader.seeds})`
    );
  if (
    headHeader.augmentVersion !== baseHeader.augmentVersion ||
    headHeader.memory !== baseHeader.memory ||
    headHeader.memoryHands !== baseHeader.memoryHands
  )
    w.push(
      'REFUSE: the two replays used different input variations (augment version or opponent-history setting)'
    );
  if (headHeader.options?.rowsDigest !== baseHeader.options?.rowsDigest)
    w.push(
      `NOTE: the two replays were given different option rows (${(headHeader.options?.variants ?? []).join(' ') || 'no variant'} vs ${(baseHeader.options?.variants ?? []).join(' ') || 'no variant'}); differences below include that`
    );
  if (headHeader.node !== baseHeader.node)
    w.push(`the builds ran on different Node versions (${headHeader.node} vs ${baseHeader.node})`);
  const ho = headHeader.options?.received ?? {};
  const bo = baseHeader.options?.received ?? {};
  const onlyHead = Object.keys(ho)
    .filter((k) => !(k in bo))
    .sort();
  const onlyBase = Object.keys(bo)
    .filter((k) => !(k in ho))
    .sort();
  const valueDiffers = Object.keys(ho)
    .filter((k) => k in bo && !same(ho[k], bo[k]))
    .sort();
  if (onlyHead.length)
    w.push(
      `options only the head build received (the base build does not know them): ${onlyHead.map((k) => `${k}=${JSON.stringify(ho[k])}`).join(', ')}`
    );
  if (onlyBase.length)
    w.push(
      `options only the base build received: ${onlyBase.map((k) => `${k}=${JSON.stringify(bo[k])}`).join(', ')}`
    );
  if (valueDiffers.length)
    w.push(`options the two builds mapped to different values: ${valueDiffers.join(', ')}`);
  for (const [name, h] of [
    ['head', headHeader],
    ['base', baseHeader],
  ]) {
    if (h.options?.refusedOnThisBuild?.length)
      w.push(
        `the ${name} build refuses the switch row(s) ${h.options.refusedOnThisBuild.join(', ')}: dropped there, every other row kept (in production that build would refuse the whole set)`
      );
    if (h.missingParts?.length)
      w.push(`the ${name} build has no ${h.missingParts.join(', ')}: that part was skipped there`);
    if (h.memoryStatus && (h.memoryStatus.error > 0 || h.memoryStatus.unavailable > 0))
      w.push(
        `opponent history could not be seeded on the ${name} build for ${h.memoryStatus.error + h.memoryStatus.unavailable} decisions (${h.memoryStatus.firstError ?? 'no observe function'})`
      );
    if (h.build?.dirtyFiles > 0)
      w.push(
        `the ${name} build's checkout has ${h.build.dirtyFiles} uncommitted change(s) under server/src: the commit in its header is not all it ran`
      );
  }
  return w;
}

/** The printed report. Its first line is "0 differences" exactly when nothing differs. */
export function formatDiffReport(
  diff,
  { headHeader = null, baseHeader = null, maxGroups = 30, weakGroups = null } = {}
) {
  const t = diff.totals;
  const lines = [];
  const weak =
    weakGroups ??
    Object.fromEntries(
      Object.entries(GROUP_PLANS)
        .filter(([, p]) => p.weak)
        .map(([g, p]) => [g, p.weak])
    );
  lines.push(
    diff.differences === 0
      ? `0 differences (${t.compared} decisions compared: same action, amount, full decision JSON and receipts)`
      : `${diff.differences} differences in ${t.compared} decisions compared (${t.actionAmountDiffs} action or amount, ${t.jsonOnlyDiffs} decision JSON only, ${t.receiptsOnlyDiffs} receipts only, ${t.errorDiffs} errors, ${t.memoryStatusDiffs} history seeding, ${t.missing} missing)`
  );
  const describe = (name, h) =>
    h
      ? `${name}: commit ${h.build?.commit ?? 'unknown'}${h.build?.dirtyFiles ? ' (+uncommitted changes)' : ''}, Node ${h.node}, ${Object.keys(h.options?.received ?? {}).length} decide options from ${h.options?.source?.schema ?? 'rows'}${h.options?.source?.asOfUtc ? ' as of ' + h.options.source.asOfUtc : ''}${h.options?.variants?.length ? ' ' + h.options.variants.join(' ') : ''}`
      : null;
  for (const l of [describe('head', headHeader), describe('base', baseHeader)])
    if (l) lines.push(l);
  if (headHeader)
    lines.push(
      `states: ${headHeader.stateSet?.id ?? 'unknown'}, seeds ${headHeader.seeds?.join(',')}, opponent history ${headHeader.memory}${headHeader.memory === 'off' ? '' : ' (' + headHeader.memoryHands + ' synthetic hands)'}`
    );
  for (const w of headHeader || baseHeader ? headerWarnings(headHeader, baseHeader) : [])
    lines.push(/^(NOTE|REFUSE): /.test(w) ? w : `WARNING: ${w}`);
  if (t.bothErrored)
    lines.push(
      `WARNING: decide threw the same error on both builds for ${t.bothErrored} decisions; those say nothing`
    );
  lines.push('');
  lines.push(
    'group                 decisions  action/amount  json-only  receipts-only  other  identical'
  );
  for (const [g, s] of Object.entries(diff.groups)) {
    const other = s.errorDiffs + s.memoryStatusDiffs + s.missing;
    lines.push(
      `${g.padEnd(21)} ${String(s.compared).padStart(9)}  ${String(s.actionAmountDiffs).padStart(13)}  ${String(s.jsonOnlyDiffs).padStart(9)}  ${String(s.receiptsOnlyDiffs).padStart(13)}  ${String(other).padStart(5)}  ${String(s.identical).padStart(9)}${weak[g] ? '   WEAK (' + weak[g] + ')' : ''}`
    );
  }
  if (diff.differences > 0) {
    lines.push('');
    lines.push(
      `Differing decisions grouped by receipt (${diff.byReceipt.length} group${diff.byReceipt.length === 1 ? '' : 's'}):`
    );
    diff.byReceipt.slice(0, maxGroups).forEach((g, i) => {
      lines.push(
        `${i + 1}. ${g.decisions} decision${g.decisions === 1 ? '' : 's'} in ${g.states} state${g.states === 1 ? '' : 's'} - ${g.signature}`
      );
      lines.push(`   kind: ${tally(g.kinds)}; where: ${tally(g.groups)}`);
      if (Object.keys(g.transitions).length) lines.push(`   base -> head: ${tally(g.transitions)}`);
      const where = [
        Object.keys(g.stages).length ? `street: ${tally(g.stages)}` : '',
        Object.keys(g.facing).length ? `facing: ${tally(g.facing)}` : '',
        Object.keys(g.tags).length ? `tags: ${tally(g.tags)}` : '',
      ].filter(Boolean);
      if (where.length) lines.push(`   ${where.join('; ')}`);
      const e = g.example;
      lines.push(
        `   example: ${e.key}${e.base ? ` base ${e.base[0]}${e.base[1] === null ? '' : ' ' + e.base[1]}, head ${e.head[0]}${e.head[1] === null ? '' : ' ' + e.head[1]}` : ''}${e.headError || e.baseError ? ` head error: ${e.headError ?? 'none'}; base error: ${e.baseError ?? 'none'}` : ''}`
      );
      if (e.paths?.length)
        lines.push(
          `   decision JSON differs at: ${e.paths.slice(0, 8).join(', ')}${e.paths.length > 8 ? ', ...' : ''}`
        );
    });
    if (diff.byReceipt.length > maxGroups)
      lines.push(`... ${diff.byReceipt.length - maxGroups} more group(s) in the JSON report`);
  }
  return lines.join('\n');
}

/** True when the headers say the two replays must not be compared at all. */
export function comparisonRefused(headHeader, baseHeader) {
  return headerWarnings(headHeader, baseHeader).some(
    (w) => w.startsWith('REFUSE') || w.startsWith('a replay header is missing')
  );
}

/** The bisect step: is a mid build's replay of the differing states the base's, the head's, or neither? */
export function classifyAgainst(midRows, baseRows, headRows) {
  const sig = (r) =>
    r.error ? `E:${r.error}` : `${r.action}|${r.amount ?? ''}|${r.j}|${(r.fires ?? []).join(',')}`;
  const M = new Map(midRows.map((r) => [decisionKey(r), sig(r)]));
  let likeBase = 0;
  let likeHead = 0;
  let neither = 0;
  for (const r of baseRows) {
    const m = M.get(decisionKey(r));
    const h = headRows.find((x) => decisionKey(x) === decisionKey(r));
    if (m === sig(r)) likeBase++;
    else if (h && m === sig(h)) likeHead++;
    else neither++;
  }
  return {
    likeBase,
    likeHead,
    neither,
    verdict:
      likeHead === 0 && neither === 0 ? 'base' : likeBase === 0 && neither === 0 ? 'head' : 'mixed',
  };
}
