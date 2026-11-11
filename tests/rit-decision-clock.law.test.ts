import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

const page = readFileSync(resolve(__dirname, '../src/pages/TablePage.tsx'), 'utf8');
const parsed = ts.createSourceFile(
  'TablePage.tsx',
  page,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);
let offerHandler = '';
function visit(node: ts.Node) {
  if (ts.isIfStatement(node) && node.expression.getText(parsed) === "eventType === 'rit_offer'") {
    offerHandler = node.getText(parsed);
  }
  ts.forEachChild(node, visit);
}
visit(parsed);

describe('the run-it decision controls never spend their clock waiting to open', () => {
  it.each([undefined, 10, 25])(
    'opens immediately with server timeout %s, including an older engine',
    (timeoutSeconds) => {
      const now = Date.now();
      const open = vi.fn();
      const timer = vi.fn();
      const delayedOpen = vi.fn();
      const deadline = { current: 0 };
      const scope = {
        eventType: 'rit_offer',
        handState: {
          chooserPlayerId: 'a',
          allPlayerIds: ['a', 'b'],
          maxRuns: 3,
          timeoutSeconds,
          ...(timeoutSeconds ? { deadline_ts: now + timeoutSeconds * 1000 } : {}),
        },
        userId: 'a',
        leaveAttentionSuppressedRef: { current: false },
        showRitFeltBanner: vi.fn(),
        RIT_WAITING_BANNER: 'Waiting For Players.',
        setRitAllPlayerIds: vi.fn(),
        setRitAcceptedIds: vi.fn(),
        setRitChooserId: vi.fn(),
        setRitChooserHasDecided: vi.fn(),
        setRitChosenRuns: vi.fn(),
        setRitHeroAccepted: vi.fn(),
        setRitPotAmount: vi.fn(),
        setRitTotalSeconds: vi.fn(),
        ritDeadlineRef: deadline,
        setRitIsChooser: vi.fn(),
        setRitMaxRuns: vi.fn(),
        setRitPlayerCount: vi.fn(),
        setRitOpponent: vi.fn(),
        tableStateRef: { current: { players: [] } },
        setRitTimer: timer,
        setDecisionDeadline: vi.fn(),
        ritPanelOpenTimerRef: { current: null },
        setTimeout: delayedOpen,
        clearTimeout: vi.fn(),
        getAnimationSpeed: () => 100,
        setShowRIT: open,
      };
      expect(offerHandler).not.toBe('');
      new Function(...Object.keys(scope), ts.transpile(offerHandler))(...Object.values(scope));
      expect(open).toHaveBeenCalledWith(true);
      expect(delayedOpen).not.toHaveBeenCalled();
      expect(timer).toHaveBeenCalledWith(timeoutSeconds ?? 10);
      expect(deadline.current).toBeGreaterThanOrEqual(now + (timeoutSeconds ?? 10) * 1000);
    }
  );
});
