// Rebuilds one hand_history row (as selected by lib/sql.mjs) into players, money and decisions.
// Money rules (verified against pot_size on every PLO hand in earlier audits): bet/raise/all_in amounts are raise-to
// levels on the street; call and posts are increments; return rows are subtracted; ante and dead rows are dead money;
// uncalled bets are inferred only when the hand has no return rows, and pot_size settles the inference.
import { parseCard } from './omaha.mjs';
export const STREETS = ['preflop', 'flop', 'turn', 'river'];
const FORCED = new Set([
  'sb',
  'bb',
  'ante',
  'post',
  'post_sb',
  'post_bb',
  'blind',
  'small_blind',
  'big_blind',
  'straddle',
  'bomb_ante',
  'return',
]);
const TO = new Set(['bet', 'raise', 'all_in', 'allin']);
const INC = new Set([
  'call',
  'sb',
  'bb',
  'post',
  'post_sb',
  'post_bb',
  'blind',
  'small_blind',
  'big_blind',
  'straddle',
  'ante',
  'bomb_ante',
]);
export function sizeBucket(f) {
  return f < 0.4 ? 'under40' : f < 0.7 ? 'mid' : f <= 1.1 ? 'big' : 'over';
}
/**
 * Shown cards only: a player's hole cards are used only when the showdown list has his entry with mucked = false.
 * (The SQL already enforces this; this is the second lock.)
 */
export function shownCards(h) {
  const out = new Map();
  const showOk = new Set((h.sd ?? []).filter((s) => s && s[2] === false).map((s) => s[1]));
  for (const [u, cs] of Object.entries(h.hc ?? {})) {
    if (!showOk.has(u)) continue;
    const cards = (Array.isArray(cs) ? cs : []).map(parseCard);
    if ((cards.length === 4 || cards.length === 5) && cards.every((c) => c !== null))
      out.set(u, cards);
  }
  return out;
}
export function parseHand(h) {
  const bb = Number(h.bb);
  const pl = (h.pl ?? []).map((p) => ({
    seat: Number(p[0]),
    uid: p[1],
    endStack: Number(p[2] ?? 0),
    name: p[3],
    isHorse: p[4] === true,
  }));
  const seats = pl.map((p) => p.seat).sort((a, b) => a - b);
  const bySeat = new Map(pl.map((p) => [p.seat, p]));
  const byUid = new Map(pl.map((p) => [p.uid, p]));
  const n = seats.length;
  const btn = Number(h.btn);
  // postflop acting order: higher acts later; button last
  const orderKey = (seat) => {
    if (!seats.includes(btn)) return seats.indexOf(seat);
    const off = (seats.indexOf(seat) - seats.indexOf(btn) + n) % n;
    return (off - 1 + n) % n;
  };
  const key = new Map(pl.map((p) => [p.uid, orderKey(p.seat)]));
  const level = { preflop: 0, flop: 0, turn: 0, river: 0 };
  const com = new Map(); // uid|street -> committed live
  const dead = new Map(),
    ret = new Map();
  const folded = new Set();
  let hasRet = false,
    rit = false;
  const decisions = [];
  const pfRaises = [];
  const streetRaisers = { preflop: [], flop: [], turn: [], river: [] };
  const levelSetter = { preflop: null, flop: null, turn: null, river: null };
  const streetFirst = { preflop: null, flop: null, turn: null, river: null };
  const comOf = (u, s) => com.get(u + '|' + s) ?? 0;
  const totalIn = (u) => {
    let t = 0;
    for (const s of STREETS) t += comOf(u, s);
    return t + (dead.get(u) ?? 0);
  };
  for (let i = 0; i < (h.ac ?? []).length; i++) {
    const [seat, stage, act0, amt0, origin, dd, pnPot, pnToCall, auid] = h.ac[i];
    const act = String(act0 ?? '').toLowerCase();
    if (act.startsWith('rit_board')) {
      rit = true;
      continue;
    }
    if (!(stage in level)) continue;
    const amt = Number(amt0 ?? 0);
    const u = auid ?? bySeat.get(Number(seat))?.uid;
    if (!u) continue;
    const isDead = dd === true || act === 'ante' || act === 'bomb_ante';
    const c = comOf(u, stage);
    if (!FORCED.has(act) && origin !== 'forced') {
      const liveUids = pl.filter((p) => !folded.has(p.uid)).map((p) => p.uid);
      let pot = 0;
      for (const v of com.values()) pot += v;
      for (const v of dead.values()) pot += v;
      for (const v of ret.values()) pot -= v;
      if (pnPot !== null && pnPot !== undefined) pot = Number(pnPot);
      let toCall = Math.max(0, level[stage] - c);
      if (pnToCall !== null && pnToCall !== undefined) toCall = Number(pnToCall);
      const isRaise =
        act === 'bet' ||
        act === 'raise' ||
        ((act === 'all_in' || act === 'allin') && amt > level[stage] + 1e-9);
      const prev = stage === 'preflop' ? null : STREETS[STREETS.indexOf(stage) - 1];
      decisions.push({
        i,
        u,
        street: stage,
        act: act === 'allin' ? 'all_in' : act,
        amt,
        origin,
        pot,
        toCall,
        isRaise,
        firstWager: isRaise && level[stage] === 0 && stage !== 'preflop',
        streetLevel: level[stage],
        myCom: c,
        live: liveUids.length,
        liveUids,
        oop: liveUids.some((x) => x !== u && key.get(x) > key.get(u)),
        k: stage === 'preflop' ? pfRaises.length : null,
        lastPfRaiser: pfRaises.length ? pfRaises[pfRaises.length - 1] : null,
        facing: levelSetter[stage],
        wageredPrev: prev ? streetRaisers[prev].slice() : null,
        totalInBefore: totalIn(u),
        inSnap: Object.fromEntries(liveUids.map((x) => [x, totalIn(x)])),
        nStreetRaises: streetRaisers[stage].length,
        streetFirstSize: streetFirst[stage] ? streetFirst[stage].size : null,
        limpersBefore:
          stage === 'preflop' && pfRaises.length === 0
            ? decisions.filter((x) => x.street === 'preflop' && x.act === 'call').length
            : 0,
        callersSinceRaise:
          stage === 'preflop' && pfRaises.length > 0
            ? (() => {
                let c2 = 0;
                for (let q = decisions.length - 1; q >= 0; q--) {
                  const x = decisions[q];
                  if (x.street !== 'preflop') continue;
                  if (x.isRaise && x.amt > bb + 1e-9) break;
                  if (x.act === 'call') c2++;
                }
                return c2;
              })()
            : 0,
      });
      if (stage !== 'preflop' && isRaise && level[stage] === 0)
        streetFirst[stage] = { u, size: amt / Math.max(pot, 1e-9) };
    }
    if (act === 'fold') folded.add(u);
    else if (act === 'return') {
      ret.set(u, (ret.get(u) ?? 0) + amt);
      hasRet = true;
    } else if (isDead) dead.set(u, (dead.get(u) ?? 0) + amt);
    else if (TO.has(act)) {
      if (amt > level[stage] + 1e-9) {
        if (stage === 'preflop') {
          if (amt > bb + 1e-9) {
            pfRaises.push(u);
            streetRaisers.preflop.push(u);
            levelSetter.preflop = u;
          }
        } else {
          streetRaisers[stage].push(u);
          levelSetter[stage] = u;
        }
        level[stage] = amt;
      }
      com.set(u + '|' + stage, Math.max(c, amt));
    } else if (INC.has(act)) {
      com.set(u + '|' + stage, c + amt);
      if (c + amt > level[stage]) {
        level[stage] = c + amt;
        if (act === 'bb' || act === 'post' || act === 'straddle')
          levelSetter[stage] = levelSetter[stage] ?? null;
      }
    }
  }
  const inv = new Map();
  for (const [k2, v] of com) {
    const u = k2.split('|')[0];
    inv.set(u, (inv.get(u) ?? 0) + v);
  }
  for (const [u, v] of dead) inv.set(u, (inv.get(u) ?? 0) + v);
  for (const [u, v] of ret) inv.set(u, (inv.get(u) ?? 0) - v);
  if (!hasRet) {
    const infer = new Map();
    for (const s of STREETS) {
      const vals = [...com]
        .filter(([k2]) => k2.endsWith('|' + s))
        .map(([k2, v]) => [v, k2.split('|')[0]])
        .sort((a, b) => b[0] - a[0]);
      if (vals.length) {
        const nxt = vals.length > 1 ? vals[1][0] : 0;
        if (vals[0][0] - nxt > 0.005)
          infer.set(vals[0][1], (infer.get(vals[0][1]) ?? 0) + vals[0][0] - nxt);
      }
    }
    let tot = 0;
    for (const v of inv.values()) tot += v;
    let itot = 0;
    for (const v of infer.values()) itot += v;
    const pot = Number(h.pot ?? 0);
    if (!(itot > 0 && Math.abs(tot - itot - pot) >= 0.02 && Math.abs(tot - pot) < 0.02))
      for (const [u, v] of infer) inv.set(u, inv.get(u) - v);
  }
  const won = new Map();
  for (const w of h.w ?? []) won.set(w.userId, (won.get(w.userId) ?? 0) + Number(w.amount ?? 0));
  const players = pl.map((p) => {
    const i2 = inv.get(p.uid) ?? 0,
      w2 = won.get(p.uid) ?? 0;
    return {
      ...p,
      inv: i2,
      won: w2,
      net: w2 - i2,
      startStack: p.endStack + i2 - w2,
      folded: folded.has(p.uid),
    };
  });
  const start = new Map(players.map((p) => [p.uid, p.startStack]));
  for (const d of decisions) {
    d.stackLeft = Math.max(0, (start.get(d.u) ?? 0) - d.totalInBefore);
    d.stacks = Object.fromEntries(
      Object.entries(d.inSnap).map(([x, v]) => [x, Math.max(0, (start.get(x) ?? 0) - v)])
    );
    delete d.inSnap;
  }
  let board = (h.cc ?? []).map(parseCard);
  if (board.some((c) => c === null)) board = [];
  const reached = new Set((h.ac ?? []).map((a) => a[1]));
  const shown = shownCards(h);
  const potsArr = (h.pots ?? []).map((p) => ({
    amount: Number(p.amount ?? 0),
    eligible: p.eligible ?? [],
  }));
  return {
    id: h.id,
    t: String(h.created_at),
    gv: String(h.gv).toLowerCase(),
    bb,
    build: h.build ? String(h.build).slice(0, 8) : 'none',
    tid: h.tid,
    rake: Number(h.rake ?? 0),
    bbj: Number(h.bbj ?? 0),
    pot: Number(h.pot ?? 0),
    bomb: h.bomb === true,
    rit: rit || !!h.cc2 || (Array.isArray(h.rit) && h.rit.length > 0),
    players,
    byUid: new Map(players.map((p) => [p.uid, p])),
    decisions,
    board,
    shown,
    pots: potsArr,
    pfRaises,
    reached,
    key,
    hasPerson: players.some((p) => !p.isHorse),
    hasHorse: players.some((p) => p.isHorse),
  };
}
