/** Owner 2026-11-10: celebrate only the viewing winner, including every chop. */
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('src/pages/TablePage.tsx', 'utf8');
const file = ts.createSourceFile(
  'TablePage.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
function nodes(predicate: (node: ts.Node) => boolean, root: ts.Node = file): ts.Node[] {
  const found: ts.Node[] = [];
  function visit(node: ts.Node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}
function arrow(name: string) {
  const declaration = nodes(
    (n) => ts.isVariableDeclaration(n) && n.name.getText(file) === name
  )[0] as ts.VariableDeclaration;
  expect(declaration, `missing ${name}`).toBeDefined();
  return declaration.initializer!;
}
function evaluate(node: ts.Node, scope: Record<string, unknown>) {
  const js = ts.transpileModule(`const actual = ${node.getText(file)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn actual;`)(...Object.values(scope));
}
function present(winnerIds: string[], runs = 1, userId = 'hero') {
  const payoutCelebrations: Array<() => void> = [];
  const cue = vi.fn();
  const handler = evaluate(arrow('presentPayoutVisual'), {
    userId,
    winnerIds,
    payoutCelebrations,
    ritExpectedRunsRef: { current: runs },
    ritResultRef: { current: null },
  });
  handler(cue);
  return { cue, payoutCelebrations };
}

describe('only the viewing winner receives payout celebrations', () => {
  it.each([['villain'], ['villain', 'other'], []])(
    'does not celebrate losing or spectating: %j',
    (...ids) => {
      const { cue, payoutCelebrations } = present(ids as string[]);
      expect(cue).not.toHaveBeenCalled();
      expect(payoutCelebrations).toHaveLength(0);
    }
  );
  it('does not queue a losing viewer celebration behind a runout', () => {
    const { cue, payoutCelebrations } = present(['villain'], 2);
    expect(cue).not.toHaveBeenCalled();
    expect(payoutCelebrations).toHaveLength(0);
  });
  it.each([['hero'], ['villain', 'hero'], ['hero', 'other', 'villain']])(
    'celebrates sole, chop and side-pot winners: %j',
    (...ids) => {
      const { cue } = present(ids as string[]);
      expect(cue).toHaveBeenCalledOnce();
    }
  );
  it('keeps the existing runout deferral for a chopped winner', () => {
    const { cue, payoutCelebrations } = present(['villain', 'hero'], 3);
    expect(cue).not.toHaveBeenCalled();
    expect(payoutCelebrations).toHaveLength(1);
    payoutCelebrations[0]();
    expect(cue).toHaveBeenCalledOnce();
  });
  it('never treats an absent viewer identity as a winner', () => {
    expect(present(['villain'], 1, '').cue).not.toHaveBeenCalled();
  });
});

it('a small or rake-negative chop still starts confetti', () => {
  const calls = nodes(
    (n) => ts.isCallExpression(n) && n.expression.getText(file) === 'presentPayoutVisual'
  ) as ts.CallExpression[];
  const callback = calls
    .map((c) => c.arguments[0])
    .find((n) => n.getText(file).includes('setShowConfetti'))!;
  expect(callback).toBeDefined();
  const setShowConfetti = vi.fn();
  const timers: Array<() => void> = [];
  evaluate(callback, {
    tableStateRef: { current: { blinds: { big: 2 } } },
    safeBB: () => 2,
    userId: 'hero',
    amounts: { hero: 0.5 },
    potAmount: 1,
    setShowConfetti,
    setTimeout: (cb: () => void) => timers.push(cb),
    tableScalerRef: { current: null },
    getAnimationSpeed: () => 1,
  })();
  timers.forEach((cb) => cb());
  expect(setShowConfetti).toHaveBeenLastCalledWith(true);
});

it('revealing cards cannot announce a win before the award arrives', () => {
  const showdown = nodes(
    (n) => ts.isCaseClause(n) && n.expression.getText(file) === "'SHOWDOWN'"
  )[0];
  expect(showdown).toBeDefined();
  const sounds = nodes(
    (n) =>
      ts.isCallExpression(n) &&
      /soundService\.play(?:Showdown|BigWin|Win)$/.test(n.expression.getText(file)),
    showdown
  );
  expect(sounds).toHaveLength(0);
});

it('the scoop fanfare is private to the scooping hero', () => {
  const scoop = arrow('armScoop');
  const call = nodes(
    (n) => ts.isCallExpression(n) && n.expression.getText(file) === 'soundService.playBigWin',
    scoop
  )[0];
  expect(call).toBeDefined();
  let parent = call.parent;
  while (parent && !ts.isIfStatement(parent)) parent = parent.parent;
  expect(parent && ts.isIfStatement(parent)).toBe(true);
  const condition = (parent as ts.IfStatement).expression;
  for (const scoopUserId of ['hero', 'villain']) {
    expect(
      evaluate(condition, {
        scoopUserId,
        userId: 'hero',
        soundService: { isEnabled: () => true },
        ambientSoundsAllowedRef: { current: true },
      })
    ).toBe(scoopUserId === 'hero');
  }
});

it.each([
  { enabled: true, active: true, amount: 1, sound: 'playWin' },
  { enabled: true, active: true, amount: 100, sound: 'playBigWin' },
  { enabled: false, active: true, amount: 100, sound: null },
  { enabled: true, active: false, amount: 100, sound: null },
])('retains sound preferences and win tiers: %j', ({ enabled, active, amount, sound }) => {
  const soundService = {
    isEnabled: () => enabled,
    playWin: vi.fn(),
    playBigWin: vi.fn(),
    playPotCollect: vi.fn(),
  };
  evaluate(arrow('playWinSound'), {
    soundService,
    ambientSoundsAllowed: active,
    tableStateRef: { current: { blinds: {}, pot: amount } },
    safeBB: () => 2,
  })(amount);
  expect(soundService.playWin).toHaveBeenCalledTimes(sound === 'playWin' ? 1 : 0);
  expect(soundService.playBigWin).toHaveBeenCalledTimes(sound === 'playBigWin' ? 1 : 0);
  expect(soundService.playPotCollect).toHaveBeenCalledTimes(sound ? 1 : 0);
});

it('routes confetti, particles and win audio through the same winner admission', () => {
  const calls = nodes(
    (n) => ts.isCallExpression(n) && n.expression.getText(file) === 'presentPayoutVisual'
  ) as ts.CallExpression[];
  for (const effect of ['setShowConfetti', 'setWinnerParticle', 'playWinSound']) {
    expect(
      calls.filter(
        (c) =>
          nodes((n) => ts.isCallExpression(n) && n.expression.getText(file) === effect, c).length >
          0
      )
    ).toHaveLength(1);
  }
});
