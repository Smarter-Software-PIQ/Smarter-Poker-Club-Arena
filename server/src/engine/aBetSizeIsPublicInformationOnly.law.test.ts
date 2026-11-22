/**
 * LAW: THE SIZE OF A HORSE BET IS PUBLIC INFORMATION ONLY (PLO Strategy lane
 * 2026-11-16, option omahaBetSizeByPublicState, default OFF; owner 2026-11-15:
 * "HE GETS THEM TO FOLD WHEN HE WANTS A FOLD, AND GETS A CALL WHEN HE WANTS A
 * CALL").
 *
 * With the option on, the size of an own PLO4/PLO5 cash postflop bet or raise
 * has ONE producer, horsePublicBetSizeTo, fed by HorseLogic.publicBetSizeSpot.
 * This law reads the source, so a later edit that hands either of them a hole
 * card, an equity, a hand class, the proposed amount or the strategy random
 * stream fails here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENGINE = join(process.cwd(), 'src', 'engine');
const read = (name: string) => readFileSync(join(ENGINE, name), 'utf8');
/** Source without comments (block and line), so prose cannot satisfy or break a rule. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const LOGIC = code(read('HorseLogic.ts'));
const SIZE = code(read('horsePublicBetSize.ts'));

function body(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  const to = source.indexOf(end, from + start.length);
  expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

/** Names that carry the private hand, the strategy stream, or say which rule decided. */
const PRIVATE =
  /fastRandom|saveFastRandom|difficultyHint|madeCategory|equity|holeCards|\.cards\b|player\.|hero\.|omahaNut|hasRiverNuts|strength|policyOwnership|preflopAuthority|decision\.|amount\b|HorseEval/;

describe('a Horse bet size is public information only', () => {
  it('the size module reads no private name and no strategy random stream', () => {
    expect(SIZE).not.toMatch(PRIVATE);
    const imports = [...SIZE.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(['../types.js', 'node:crypto']);
    // Its only randomness is its own stream.
    expect(SIZE).toMatch(/let sizeState = \(randomBytes\(4\)/);
    expect(SIZE).not.toMatch(/Math\.random/);
  });

  it('the public spot type carries no card of the seat, no hand class and no proposed amount', () => {
    const spot = body(SIZE, 'export interface HorsePublicBetSizeSpot', '\n}');
    const fields = [...spot.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).sort();
    expect(fields).toEqual(
      [
        'board',
        'currentBet',
        'inPosition',
        'kind',
        'maxTo',
        'minTo',
        'opponentFoldToBet',
        'opponents',
        'pot',
        'seatBet',
        'seatStack',
        'street',
      ].sort()
    );
  });

  it('the spot handed to it is built from the public state alone', () => {
    const spot = body(LOGIC, 'static publicBetSizeSpot(', 'static publicTimingSpot(');
    expect(spot).not.toMatch(PRIVATE);
    // The only "cards" it may name are the community cards.
    const cardWords = spot.match(/\b\w*[cC]ards\w*\b/g) ?? [];
    expect(cardWords.filter((w) => !/^communityCards$/.test(w))).toEqual([]);
    // Its one read of the opponent is the measured fold-to-bet read.
    expect(spot.match(/HorseMind\.\w+\(/g) ?? []).toEqual(['HorseMind.omahaReadConditionalOf(']);
  });

  it('the rule passes the size function nothing but that spot, and runs only on an explicit true', () => {
    const rule = body(
      LOGIC,
      'private static omahaBetSizeByPublicStateRule(',
      'private static publicBetSizeInGame('
    );
    expect(rule).toMatch(/if \(opts\.omahaBetSizeByPublicState !== true\) return decision;/);
    // The draw is the decision's one size draw (wave two: the pricing rules
    // price the size the public policy bets, so they share it), and that draw
    // is the size module's own stream and nothing else.
    expect(rule.match(/horsePublicBetSizeTo\(([^)]*)\)/g)).toEqual([
      'horsePublicBetSizeTo(spot, omahaPublicSizeUnitOf)',
    ]);
    const unit = body(LOGIC, 'function omahaPublicSizeUnitOf(', '\n}');
    expect(unit).toMatch(/omahaPublicSizeUnit = horseBetSizeRandom\(\)/);
    expect(unit).not.toMatch(PRIVATE);
    expect(rule).toMatch(
      /const spot = HorseLogic\.publicBetSizeSpot\(\s*gs,\s*player\.user_id,\s*decision\.action,\s*opts\.mind !== false\s*\)/
    );
    // Only the size changes; the one action change is the all-in the legalizer
    // makes of a wager of every chip.
    expect(rule).toMatch(/return \{ \.\.\.decision, amount: legal\.amount \};/);
    expect(rule).not.toMatch(/action:\s*'/);
    expect(rule.match(/action: legal\.action/g)).toHaveLength(1);
    expect(rule).toMatch(/const committed = legal\.action === 'all_in';/);
    // The one private read is omahaNutClassValueSize's own gate, and it keeps the decision.
    expect(rule).toMatch(
      /if \(opts\.omahaNutClassValueSize === true && omahaNutClassNow\(player, gs\)\) \{\s*if \(tele\) noteFire\('omaha_public_bet_size_nut_class_kept'\);\s*return decision;/
    );
    // horsePublicBetSizeTo has exactly one caller in HorseLogic.
    expect(LOGIC.match(/horsePublicBetSizeTo\(/g)).toHaveLength(1);
  });

  it('the option is read only as an explicit true, and the rule closes the wager_rules node', () => {
    // Every read is an explicit true (the rule, and the pricing rules that
    // price the public size: omahaPublicSizedBet and omahaCardImpactRule).
    const reads = LOGIC.match(/opts\.omahaBetSizeByPublicState\b[^;\n]*/g) ?? [];
    expect(reads.length).toBeGreaterThan(0);
    for (const r of reads) expect(r).toMatch(/^opts\.omahaBetSizeByPublicState [!=]== true\b/);
    const node = body(
      LOGIC,
      'const wagerRulesNode = (): { decision: HorseDecision } =>',
      "reconcileHorsePhaseReceipts(phaseReceiptsBeforeLaterOwners, decision, 'wager_rules'"
    );
    // Both of the node's answers pass through it, outermost of the owner rules (only the default-off
    // horseRiverNoBlockerBet, riverNoBlocker, wraps the node's answer after it: a river first bet only).
    // (EMERG FACING 2026-11-19: the facing-bet answer is publicSized as ownersFinal, then only a final fold may
    // become the call: omahaFacingBetIsPricedByEquity, default off.)
    expect(node.match(/decision: publicSized\(/g)).toHaveLength(1);
    expect(node.match(/const ownersFinal = publicSized\(/g)).toHaveLength(1);
    // (omahaMathCore, default OFF, 2026-11-19: the node's third return is the core's, outermost over
    // riverNoBlocker(wagerRulesNode()); with the switch off it returns that answer unchanged.)
    // (omahaFourBetFoldPricedCall, default OFF, lane PREFLOP-UNCONTESTED 2026-11-20: the node's fourth return is
    // the four-bet rule's. It turns only a final preflop fold into the legal call; the amount is the price to
    // call (the smaller of the call and the stack), so it carries no bet size and nothing chosen from cards.)
    expect(node.match(/return \{\s*decision:/g)).toHaveLength(4);
    expect(node.match(/return \{\s*(?:\/\/[^\n]*\s*)*decision: omahaMathCoreRule\(/g)).toHaveLength(
      1
    );
    expect(node).toContain("graph.run('wager_rules', decision, () => {");
    expect(node).toContain('const ruled = riverNoBlocker(wagerRulesNode());');
  });
});
