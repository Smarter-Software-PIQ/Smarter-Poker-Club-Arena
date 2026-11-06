/**
 * Phase 5.3 (2026-11-05): horse COMPLAINT replay.
 *
 * An owner or player complains about a horse hand. Step 1 extracts the hand,
 * read-only, through the Supabase MCP execute_sql:
 *
 *   python3 scripts/horse-measure/horse-release-verify.py sql complaint-extract HAND_ID
 *   python3 scripts/horse-measure/horse-release-verify.py sql complaint-extract TABLE_ID 2026-11-05T14:03:00Z
 *
 * Save the result (the raw execute_sql text is fine) to a file. Step 2, from
 * server/:
 *
 *   npx tsx ../scripts/horse-measure/horse-complaint-replay.ts --extract FILE \
 *     [--complaint "what was said"] [--ord 9,12] [--scorecard scorecard-DAY.json] [--json]
 *
 * rebuilds retained public state at every horse decision, replays the checked-out brain
 * (HorseLogic.decide) there for the live hybrid profile and every base style
 * over fixed seeds, reports whether today's brain still makes the recorded
 * action, which brain receipts fired (the rule that governs, named from
 * sql/activation.sql), and which scorecard cell the spot belongs to with its
 * measured value when a scorecard report is given.
 *
 * Step 3, once the complaint is confirmed and fixed, make it a permanent law:
 *
 *   npx tsx ../scripts/horse-measure/horse-complaint-replay.ts --extract FILE \
 *     --emit-law SLUG --forbid 9:raise,12:fold --title "..." --complaint "..." \
 *     [--control holdemPremiumAggression=false] [--out-dir src/engine/horseComplaints]
 *
 * Without --emit-law, --forbid ORD:KIND,... only checks the path: it prints
 * which profiles can still take it and exits 3 if any can (0 if none).
 *
 * --emit-law writes SLUG.fixture.json (anonymised: seats only, no user ids) and
 * SLUG.law.test.ts from templates/horse-complaint.law.test.ts.tmpl, plus its
 * docs/laws.d/ registry file when the law is inside server/src. Kinds:
 * fold, check, call, raise (not all in), jam (an all-in raise). Nothing here
 * touches a database; only --emit-law writes, and only those two files.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPLAINT_SEEDS,
  complaintPathHits,
  parseExtract,
  replayHand,
  rowsFromResultText,
  toComplaintFixture,
  type ActionKind,
  type ExtractedHand,
  type ForbiddenStep,
  type NodeReplay,
  type SpotClass,
} from '../../server/src/engine/HorseComplaintReplay.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const KINDS: ActionKind[] = ['fold', 'check', 'call', 'raise', 'jam'];

export function parseArgs(argv: string[]) {
  const a: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) throw new Error(`unexpected argument ${k}`);
    const name = k.slice(2);
    if (name === 'json') a.json = true;
    else {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${k} needs a value`);
      a[name] = v;
    }
  }
  return a;
}

export function parseForbid(s: string): ForbiddenStep[] {
  return s.split(',').map((part) => {
    const [o, k] = part.trim().split(':');
    const ord = Number(o);
    if (!Number.isInteger(ord) || ord < 1 || !KINDS.includes(k as ActionKind))
      throw new Error(`--forbid wants ORD:KIND pairs (kinds ${KINDS.join('/')}), got ${part}`);
    return { ord, kind: k as ActionKind };
  });
}

export function parseControl(s: string | undefined): Record<string, unknown> | null {
  if (!s) return null;
  const out: Record<string, unknown> = {};
  for (const part of s.split(',')) {
    const [k, v] = part.split('=');
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k ?? '')) throw new Error(`bad --control ${part}`);
    out[k] =
      v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) ? Number(v) : v;
  }
  return out;
}

/** feature -> upgrade label, from the activation template (one list for everything). */
export function receiptLabels(): Map<string, string> {
  const sql = readFileSync(join(HERE, 'sql', 'activation.sql'), 'utf8');
  const m = new Map<string, string>();
  for (const x of sql.matchAll(/\('([a-z0-9_]+)',\s*'([^']*)'\)/g)) m.set(x[1], x[2]);
  return m;
}

type Scorecard = {
  day?: string;
  cells?: Array<Record<string, unknown>>;
  v79?: Array<Record<string, unknown>>;
  v81?: { cells?: Array<Record<string, unknown>> };
  reshove?: Array<Record<string, unknown>>;
};

/** The measured value of a spot's cell in an assembled scorecard report. */
export function lookupCell(spot: SpotClass, sc: Scorecard | null): string {
  const c = spot.cell;
  if (!c) return 'no measured cell for this spot';
  if (!sc) return `cell ${c.family} ${c.key} (pass --scorecard to see its measured value)`;
  const day = sc.day ? ` on ${sc.day}` : '';
  if (c.family === 'v79') {
    const [cell, kicker] = c.key.split('|');
    const r = sc.v79?.find((x) => x.cell === cell && x.kicker === kicker);
    return r
      ? `V79/V80 cell ${cell} ${kicker}${day}: n ${r.n} in ${r.hands} hands, call EV ${r.mean_bb} bb, 95% CI [${r.lo}, ${r.hi}] (${r.verdict})`
      : `V79/V80 cell ${cell} ${kicker}: not measured${day}`;
  }
  if (c.family === 'v81') {
    const r = sc.v81?.cells?.find((x) => x.k === c.key);
    return r
      ? `V81 cell ${c.key}${day}: n ${r.n} in ${r.g} hands, call EV ${r.m} bb, 95% CI [${r.lo}, ${r.hi}] (${r.verdict})`
      : `V81 cell ${c.key}: not measured${day}`;
  }
  if (c.family === 'four_bet_fold') {
    const [variant, format] = c.key.split('|');
    const r = sc.cells?.find((x) => x.variant === variant && x.format === format);
    return r
      ? `4-bet-then-fold ${variant} ${format}${day}: ${r.four_bet_then_fold_hands} of ${r.four_bet_hands} hands with a horse 4-bet, 95% CI ${JSON.stringify(r.four_bet_then_fold_ci)}`
      : `4-bet-then-fold ${variant} ${format}: not measured${day}`;
  }
  const [tsize, depth] = c.key.split('|');
  const rows = (sc.reshove ?? []).filter((x) => x.tsize === tsize && x.depth === depth);
  if (!rows.length) return `reshove ${tsize} ${depth}: not measured${day}`;
  return `reshove ${tsize} ${depth}${day}: ${rows
    .map((r) => `opener ${r.opener_pos} n ${r.n} EV ${r.mean_ev_bb} bb [${r.lo}, ${r.hi}]`)
    .join('; ')}`;
}

/**
 * The receipts that name a rule: every upgrade receipt from activation.sql,
 * plus any other feature that is not decision plumbing (the phase13/phase15
 * graph stages, the decide counters and the preflop_v7 entry, which fire on
 * every decision and say nothing about which rule chose). --json keeps all.
 */
export function ruleReceipts(r: Record<string, number>, labels: Map<string, string>) {
  return Object.entries(r).filter(
    ([f]) =>
      !(f === 'decide' || f.startsWith('decide_')) &&
      (labels.has(f) || !(/^phase\d+_/.test(f) || f === 'preflop_v7'))
  );
}

const fmtCounts = (m: Record<string, number>) =>
  Object.entries(m)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');

export function renderText(
  hand: ExtractedHand,
  nodes: NodeReplay[],
  complaint: string,
  labels: Map<string, string>,
  sc: Scorecard | null
): string {
  const L: string[] = [];
  L.push(`Complaint: ${complaint || '(none given)'}`);
  L.push(
    `Hand ${hand.handId}${hand.handNumber ? ` (#${hand.handNumber})` : ''}, ${hand.variant} ${hand.tournamentId ? 'tournament' : 'cash'}, ${hand.createdAt ?? ''}; a person was seated: ${hand.hasHuman ? 'yes' : 'no'}`
  );
  const seeds = nodes[0]
    ? Object.values(nodes[0].profiles[0].kinds).reduce((x, y) => x + (y ?? 0), 0)
    : 0;
  L.push(
    `Horse decisions replayed: ${nodes.length}, each for the live hybrid profile and 5 base styles over ${seeds} seeds (opponent memory off).`
  );
  for (const n of nodes) {
    L.push('');
    L.push(`Decision ${n.ord} (seat ${n.seat}, ${n.street}): ${n.spot.situation}.`);
    L.push(
      `  Recorded: ${n.recorded.action}${n.recorded.amount ? ` ${n.recorded.amount}` : ''} (${n.recorded.kind}).`
    );
    for (const p of n.profiles) {
      const rec = ruleReceipts(p.receipts, labels)
        .map(([f, c]) => `${f}${labels.has(f) ? ` (${labels.get(f)})` : ''} x${c}`)
        .join(', ');
      L.push(
        `  ${p.live ? 'LIVE ' : ''}${p.profile}: ${fmtCounts(p.kinds as Record<string, number>)}${p.sizesBb.length ? `; sizes ${[...new Set(p.sizesBb)].join('/')} bb` : ''}${rec ? `; rules fired: ${rec}` : ''}`
      );
    }
    L.push(`  Verdict: ${n.verdict}.`);
    for (const limitation of n.replayLimitations) L.push(`  Limitation: ${limitation}`);
    L.push(`  Measured: ${lookupCell(n.spot, sc)}.`);
  }
  return L.join('\n');
}

export function main(argv: string[]): number {
  const a = parseArgs(argv);
  if (typeof a.extract !== 'string') {
    console.error(
      'usage: horse-complaint-replay.ts --extract FILE [--complaint TEXT] [--ord N,N] [--seeds N] [--scorecard FILE] [--json] [--emit-law SLUG --forbid ORD:KIND,... --title TEXT [--control k=v] [--out-dir DIR]]'
    );
    return 2;
  }
  const hand = parseExtract(rowsFromResultText(readFileSync(a.extract, 'utf8')));
  const complaint = typeof a.complaint === 'string' ? a.complaint : '';
  if (typeof a['emit-law'] === 'string') {
    const slug = a['emit-law'];
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug))
      throw new Error('--emit-law SLUG must be kebab-case');
    if (typeof a.forbid !== 'string' || typeof a.title !== 'string')
      throw new Error('--emit-law needs --forbid and --title');
    const fx = toComplaintFixture(hand, {
      slug,
      title: a.title,
      complaint,
      forbidden: parseForbid(a.forbid),
      control: parseControl(typeof a.control === 'string' ? a.control : undefined),
    });
    const outDir = resolve(
      typeof a['out-dir'] === 'string' ? a['out-dir'] : 'src/engine/horseComplaints'
    );
    mkdirSync(outDir, { recursive: true });
    const fixturePath = join(outDir, `${slug}.fixture.json`);
    const lawPath = join(outDir, `${slug}.law.test.ts`);
    if (existsSync(fixturePath) || existsSync(lawPath))
      throw new Error(`${slug} already exists in ${outDir}; choose another slug`);
    const clean = (s: string) =>
      s
        .replace(/\*\//g, '* /')
        .replace(/[\r\n]+/g, ' ')
        .replace(/'/g, '’');
    const tmpl = readFileSync(join(HERE, 'templates', 'horse-complaint.law.test.ts.tmpl'), 'utf8');
    const law = tmpl
      .replaceAll('__SLUG__', slug)
      .replaceAll('__TITLE__', clean(a.title))
      .replaceAll('__COMPLAINT__', clean(complaint || '(not recorded)'))
      .replaceAll('__HAND__', fx.handId)
      .replaceAll('__FMT__', fx.fmt === 'tour' ? 'tournament' : 'cash')
      .replaceAll('__VARIANT__', fx.variant)
      .replaceAll(
        '__PATH__',
        fx.forbidden.map((s) => `${s.kind} at decision ${s.ord}`).join(', then ')
      );
    writeFileSync(fixturePath, JSON.stringify(fx, null, 1) + '\n');
    writeFileSync(lawPath, law);
    console.log(`wrote ${fixturePath}\nwrote ${lawPath}`);
    // tests/law-registry.law.test.ts requires one docs/laws.d/ file per law
    // test in the repository; a law written outside it (a scratch dir) is not one.
    const repo = resolve(HERE, '..', '..');
    const rel = relative(repo, lawPath).split(sep).join('/');
    if (rel.startsWith('server/src/')) {
      const reg = join(repo, 'docs', 'laws.d', `horse-complaint-${slug}.md`);
      writeFileSync(
        reg,
        `# ${rel}\n\nHorse complaint law: ${clean(a.title)}. Hand ${fx.handId} is replayed exactly at its recorded horse decisions through today's brain (live hybrid profile and every base style, fixed seeds); no profile takes the forbidden path (${fx.forbidden.map((s) => `${s.kind} at decision ${s.ord}`).join(', then ')}).\n`
      );
      console.log(`wrote ${reg}`);
    }
    return 0;
  }
  if (typeof a.forbid === 'string') {
    const fx = toComplaintFixture(hand, {
      slug: 'check',
      title: 'check',
      complaint,
      forbidden: parseForbid(a.forbid),
    });
    const hits = complaintPathHits(fx);
    console.log(
      `Forbidden path (${fx.forbidden.map((s) => `${s.kind} at decision ${s.ord}`).join(', then ')}): ` +
        (hits.length ? `STILL taken by ${hits.join(', ')}` : 'taken by no profile at any seed')
    );
    if (!a.json && typeof a.ord !== 'string') return hits.length ? 3 : 0;
  }
  const ords =
    typeof a.ord === 'string' ? a.ord.split(',').map((x) => Number(x.trim())) : undefined;
  const nSeeds = typeof a.seeds === 'string' ? Number(a.seeds) : COMPLAINT_SEEDS.length;
  if (!Number.isInteger(nSeeds) || nSeeds < 1 || nSeeds > COMPLAINT_SEEDS.length)
    throw new Error(`--seeds must be 1..${COMPLAINT_SEEDS.length}`);
  const nodes = replayHand(hand, { ords, seeds: COMPLAINT_SEEDS.slice(0, nSeeds) });
  const sc =
    typeof a.scorecard === 'string'
      ? (JSON.parse(readFileSync(a.scorecard, 'utf8')) as Scorecard)
      : null;
  const labels = receiptLabels();
  if (a.json) {
    console.log(
      JSON.stringify(
        {
          complaint,
          hand: {
            handId: hand.handId,
            handNumber: hand.handNumber ?? null,
            tableId: hand.tableId ?? null,
            tournamentId: hand.tournamentId ?? null,
            variant: hand.variant,
            createdAt: hand.createdAt ?? null,
            hasHuman: hand.hasHuman ?? null,
          },
          seeds: COMPLAINT_SEEDS.slice(0, nSeeds),
          nodes: nodes.map((n) => ({
            ...n,
            measured: lookupCell(n.spot, sc),
            rules: Object.fromEntries(
              n.profiles.map((p) => [
                p.profile,
                Object.keys(p.receipts)
                  .filter((f) => !f.startsWith('decide_'))
                  .map((f) => (labels.has(f) ? `${f} (${labels.get(f)})` : f)),
              ])
            ),
          })),
        },
        null,
        1
      )
    );
  } else console.log(renderText(hand, nodes, complaint, labels, sc));
  return 0;
}

if (process.argv[1]?.endsWith('horse-complaint-replay.ts')) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  }
}
