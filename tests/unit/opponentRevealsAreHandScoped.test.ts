import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Execute the production callbacks rather than reimplementing their rules.
const source = readFileSync('src/pages/TablePage.tsx', 'utf8');
const ast = ts.createSourceFile(
  'TablePage.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
const nodes: ts.Node[] = [];
function visit(node: ts.Node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
function executable(parameters: string[], body: string) {
  const js = ts.transpileModule(body, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...parameters, js);
}
function inHandStarted(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (ts.isCaseClause(parent) && ts.isStringLiteral(parent.expression))
      return parent.expression.text === 'HAND_STARTED';
  return false;
}
const boundaryMapper = nodes.find(
  (node): node is ts.ArrowFunction =>
    ts.isArrowFunction(node) &&
    inHandStarted(node) &&
    ts.isBlock(node.body) &&
    node.body.statements.some(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) => declaration.name.getText(ast) === 'unfolded'
        )
    )
);
if (!boundaryMapper || !ts.isBlock(boundaryMapper.body))
  throw new Error('HAND_STARTED player mapper missing');
const resetPlayer = executable(
  ['p', 'userId', 'heroCardsAlreadyDealtForThisHand'],
  boundaryMapper.body.statements.map((statement) => statement.getText(ast)).join('\n')
);
const publicHold = nodes.find(
  (node): node is ts.IfStatement =>
    ts.isIfStatement(node) &&
    node.expression.getText(ast).includes('sp.holeCards') &&
    ts.isBlock(node.thenStatement) &&
    node.thenStatement.statements.some(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (declaration) => declaration.name.getText(ast) === 'prevPlayer'
        )
    )
);
if (!publicHold) throw new Error('Public opponent snapshot hold missing');
const holdDeclarations = nodes.filter(
  (node): node is ts.VariableStatement =>
    ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((declaration) =>
      /^cardHold/.test(declaration.name.getText(ast))
    )
);
const mergePlayer = executable(
  ['prev', 'mapped', 'sp', 'i'],
  `${holdDeclarations.map((node) => node.getText(ast)).join('\n')}\n${publicHold.getText(ast)}\nreturn sp;`
);
const opponent = (status = 'active') => ({
  id: 'opponent',
  isHero: false,
  status,
  holeCards: ['previous-public-one', 'previous-public-two'],
  showCards: true,
});
const hidden = { id: 'opponent', isHero: false, status: 'active', holeCards: [], showCards: false };
function merge(previous: unknown, previousHand: number | undefined, nextHand: number | undefined) {
  return mergePlayer(
    { players: [previous], handNumber: previousHand },
    { handNumber: nextHand },
    hidden,
    0
  );
}

describe('public opponent cards belong to one known hand', () => {
  it('clears previous public cards before the next hidden snapshot can hold them', () => {
    let player = opponent();
    for (let hand = 11; hand <= 14; hand++) {
      player = resetPlayer(player, 'hero', true);
      expect(player.holeCards).toEqual([]);
      expect(player.showCards).toBe(false);
      expect(merge(player, hand, hand)).toEqual(hidden);
      // Another legitimate public reveal occurs before the following hand.
      player = opponent();
    }
  });

  it('preserves an early fresh Hero deal but clears the old Hero deal', () => {
    const hero = { ...opponent(), id: 'hero', isHero: true, holeCards: ['own-one', 'own-two'] };
    expect(resetPlayer(hero, 'hero', true)).toEqual(hero);
    expect(resetPlayer(hero, 'hero', false)).toMatchObject({ holeCards: [], showCards: false });
  });

  it('resets folded opponents without changing persistent away states or empty seats', () => {
    expect(resetPlayer(opponent('folded'), 'hero', false)).toMatchObject({
      status: 'active',
      holeCards: [],
      showCards: false,
    });
    for (const status of ['away', 'sitting_out', 'disconnected']) {
      expect(resetPlayer(opponent(status), 'hero', false)).toMatchObject({
        status,
        holeCards: [],
        showCards: false,
      });
    }
    expect(resetPlayer(null, 'hero', false)).toBeNull();
  });

  it('retains a legitimate same-hand public showdown or all-in reveal', () => {
    expect(merge(opponent(), 11, 11)).toMatchObject({
      holeCards: opponent().holeCards,
      showCards: true,
    });
  });

  it.each([
    [10, 11],
    [11, 10],
    [0, 11],
    [11, 0],
    [undefined, 11],
    [11, undefined],
    [undefined, undefined],
    [NaN, NaN],
    [Infinity, Infinity],
    [-1, -1],
    [11.5, 11.5],
  ])(
    'does not restore public cards across mismatched or unknown hands (%s -> %s)',
    (previousHand, nextHand) => {
      expect(merge(opponent(), previousHand, nextHand)).toEqual(hidden);
    }
  );

  it('does not transfer another player’s public reveal into a replacement seat', () => {
    expect(merge({ ...opponent(), id: 'departed-player' }, 11, 11)).toEqual(hidden);
  });
});
