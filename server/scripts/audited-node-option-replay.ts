/**
 * Re-decides audited Horse decisions with a live option-switch set (arm "off") and with that set plus one or more
 * options (one arm each), and writes the replay.jsonl that scripts/audited-decision-replay.ts scores
 * (src/benchmark/AuditedDecisionReplay.ts): a meta line declaring the option set each arm handed the brain, then
 * one line per decision node {hand, seat, street, k, arms: {off: {...}, <arm>: {...}}}.
 *
 * Run from server/ (local files only; nothing is read from or written to a database):
 *   npx tsx scripts/audited-node-option-replay.ts --job <job.json> --switch <switch-rows.json> \
 *     --arms <arm>=<option>[+<option>][,<arm>=...] --out <replay.jsonl> [--seeds 1,7,42] [--shard <i>/<n>]
 *
 * job.json (scripts/hvh48-audit-nodes.py writes it): {set, hands: [{hand: <ExtractedHand of
 * engine/HorseComplaintReplay>, nodes: [{ord, seat, street, k}]}]}. switch-rows.json: the rows of
 * public.ca_horse_style_switch as read, [{option, state}].
 *
 * What a replay here is, and is not (the authority file that cites a row from it must say so):
 *  - The state is the retained public snapshot of the recorded decision (HorseComplaintReplay.stateAt) and the
 *    Horse's own hole cards; the brain is today's source at this checkout, the live hybrid profile of the hand's
 *    format, over the fixed seeds. The arm's action is the action kind most seeds chose (the first seed's on a
 *    tie); its amount is the first size that kind chose.
 *  - Opponent memory is OFF (HorseComplaintReplay.replayAt passes mind: false): an option that reads a per-opponent
 *    record sees none and falls back to whatever it uses without one. It is not the original worker request.
 *  - The base arm is the switch rows given, as the live holder would apply them: a style-switch row goes to the
 *    style options, a registered option row to the option set, an off-only option that a row holds on is set off
 *    (sanitized, counted), a row the registry does not know is dropped (sanitized, counted).
 *  - An arm option that the registry refuses is an error here, before anything runs.
 */
import { createWriteStream, readFileSync } from 'node:fs';
import {
  actionKind,
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from '../src/engine/HorseComplaintReplay.js';
import {
  OPTION_SWITCH_PLAIN_NAMES,
  optionSwitchDecisionOpts,
  optionSwitchOffOnly,
  optionSwitchStatesFrom,
} from '../src/engine/HorseOptionSwitch.js';
import {
  STYLE_SWITCH_OPTIONS,
  styleSwitchBrainOpts,
  styleSwitchDecisionOpts,
  type StyleSwitchStates,
} from '../src/engine/HorseStyleSwitch.js';
import { replayReceiptKeep } from '../src/benchmark/ReplayArmReceipts.js';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const need = (name: string): string => {
  const v = opt(name);
  if (!v) throw new Error(`--${name} is required`);
  return v;
};

interface JobNode {
  ord: number;
  seat: number;
  street: string;
  k: number;
}
interface Job {
  set: string;
  hands: { hand: ExtractedHand; nodes: JobNode[] }[];
}
const job = JSON.parse(readFileSync(need('job'), 'utf8')) as Job;
const rows = JSON.parse(readFileSync(need('switch'), 'utf8')) as {
  option: string;
  state: string;
}[];
const seeds = (opt('seeds') ?? '1,7,42').split(',').map(Number);
const [shard, shards] = (opt('shard') ?? '0/1').split('/').map(Number);

// The base arm: the rows as the live holder applies them.
const style: Record<string, string> = Object.fromEntries(
  STYLE_SWITCH_OPTIONS.map((o) => [o, 'off'])
);
const base: Record<string, 'on' | 'off'> = {};
const sanitized: Record<string, number> = {};
const nodeCount = job.hands.reduce((n, h) => n + h.nodes.length, 0);
for (const r of rows) {
  if ((STYLE_SWITCH_OPTIONS as readonly string[]).includes(r.option)) style[r.option] = r.state;
  else if (!OPTION_SWITCH_PLAIN_NAMES.includes(r.option))
    sanitized[`${r.option}:${r.state}>dropped`] = nodeCount;
  else if (r.state === 'on' && optionSwitchOffOnly(r.option)) {
    base[r.option] = 'off';
    sanitized[`${r.option}:on>off`] = nodeCount;
  } else if (r.state === 'on' || r.state === 'off') base[r.option] = r.state;
  else sanitized[`${r.option}:${r.state}>dropped`] = nodeCount;
}
const arms: Record<string, Record<string, 'on' | 'off'>> = { off: base };
for (const spec of need('arms').split(',')) {
  const [arm, list] = spec.split('=');
  if (!arm || !list || arm === 'off')
    throw new Error(`--arms: "${spec}" is not <arm>=<option>[+<option>]`);
  const set = { ...base };
  for (const o of list.split('+')) set[o] = 'on';
  arms[arm] = set;
}
for (const [arm, set] of Object.entries(arms))
  if (optionSwitchStatesFrom(set) === null)
    throw new Error(
      `arm ${arm}: today's option registry refuses its option set; nothing would be switched`
    );

// The receipts each arm keeps: those the ledger attributes to the options under test, plus the earlier families
// (src/benchmark/ReplayArmReceipts.ts). An option the ledger names no receipt for is reported, not guessed.
const receiptKeep = replayReceiptKeep(
  Object.values(arms).flatMap((set) =>
    Object.keys(set).filter((o) => set[o] === 'on' && base[o] !== 'on')
  )
);
for (const o of receiptKeep.unattributed)
  console.error(
    `note: the ledger names no receipt for ${o}; its rows keep only the receipt families`
  );

const brainOpts = (set: Record<string, 'on' | 'off'>, horseId: string) => ({
  ...styleSwitchBrainOpts(
    styleSwitchDecisionOpts(style as unknown as StyleSwitchStates, horseId, false)
  ),
  ...optionSwitchDecisionOpts(optionSwitchStatesFrom(set)),
});

/** The engine action word of an action kind at this node (a wager facing nothing is a bet). */
const word = (kind: string, toCall: number): string =>
  kind === 'jam' ? 'all_in' : kind === 'raise' ? (toCall > 0 ? 'raise' : 'bet') : kind;

const out = createWriteStream(need('out'));
out.write(
  JSON.stringify({
    meta: {
      arms: Object.fromEntries(
        Object.entries(arms).map(([arm, options]) => [arm, { options, sanitized }])
      ),
      set: job.set,
      seeds,
      style,
      shard: `${shard}/${shards}`,
    },
  }) + '\n'
);
let done = 0;
let errors = 0;
const started = Date.now();
job.hands.forEach((item, hi) => {
  if (hi % shards !== shard) return;
  const hand = item.hand;
  for (const n of item.nodes) {
    const node = hand.actions.find((a: ComplaintAction) => a.ord === n.ord);
    const line: Record<string, unknown> = {
      hand: hand.handId,
      seat: n.seat,
      street: n.street,
      k: n.k,
    };
    const armsOut: Record<string, unknown> = {};
    for (const [arm, set] of Object.entries(arms)) {
      try {
        if (!node?.publicNode) throw new Error('no recorded public snapshot at this node');
        const st = stateAt(hand, node);
        const prof = replayProfiles(st.pn.mode).find((p) => p.live)!;
        const r = replayAt(st, prof, seeds, brainOpts(set, node.userId ?? ''));
        const kinds = Object.entries(r.kinds).sort((a, b) => b[1]! - a[1]!);
        let kind = kinds[0][0];
        if (kinds.length > 1 && kinds[0][1] === kinds[1][1]) {
          // a tie: the first seed's kind
          const first = replayAt(st, prof, seeds.slice(0, 1), brainOpts(set, node.userId ?? ''));
          kind = Object.keys(first.kinds)[0];
        }
        armsOut[arm] = {
          action: word(kind, st.pn.toCall),
          amount: kind === 'raise' || kind === 'jam' ? (r.sizesBb[0] ?? null) : null,
          legal: true,
          refusal: false,
          receipts: Object.keys(r.receipts).filter(receiptKeep.keep),
          kinds: r.kinds,
        };
      } catch (e) {
        errors++;
        armsOut[arm] = { action: 'error', error: String((e as Error).message ?? e).slice(0, 200) };
      }
    }
    line.arms = armsOut;
    line.recorded = node?.publicNode
      ? word(actionKind(node.action, node.amount, node.publicNode as never), node.publicNode.toCall)
      : null;
    out.write(JSON.stringify(line) + '\n');
    done++;
    if (done % 100 === 0)
      console.error(
        `${done} nodes, ${errors} arm errors, ${Math.round((Date.now() - started) / 1000)} s`
      );
  }
});
out.end(() =>
  console.error(
    `done: ${done} nodes, ${errors} arm errors, ${Math.round((Date.now() - started) / 1000)} s`
  )
);
