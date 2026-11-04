import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
const page = readFileSync('src/pages/TablePage.tsx', 'utf8');
const from = page.indexOf(
  '          if (newSeat === heroSeat && !leaveAttentionSuppressedRef.current)'
);
const to = page.indexOf("      case 'TIMER_COUNTDOWN'", from);
const block = page.slice(from, to).replace(/\n {8}}\n {8}break;\n {6}}\n$/, '');
const js = ts.transpile(block, { target: ts.ScriptTarget.ES2022 });
describe('leave attention uses the immediate intent in discrete events', () => {
  it('suppresses the direct turn bell and haptic before a render', () => {
    const ref = { current: true };
    const soundService = { isEnabled: () => true, playTurnAlert: vi.fn() };
    const reset = vi.fn();
    new Function(
      'newSeat',
      'heroSeat',
      'leaveAttentionSuppressedRef',
      'setIsAllInMode',
      'preActionArmedRef',
      'setTurnAlertDeferred',
      'soundService',
      'isActive',
      'isMultiTable',
      'muted',
      js
    )(1, 1, ref, reset, { current: null }, vi.fn(), soundService, true, false, false);
    expect(soundService.playTurnAlert).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });
  it('keeps asynchronous haptics and timed decisions behind the same ref', () => {
    expect(
      page.match(/if \(!leaveAttentionSuppressedRef.current\) haptic.medium\(\);/g)
    ).toHaveLength(2);
    expect(page).toContain(
      'isOpen={isActive && !leaveAttentionSuppressed && !!heroPineappleCards}'
    );
    expect(page).toContain('if (heroOffer && !leaveAttentionSuppressedRef.current)');
    expect(page).toContain('if (!leaveAttentionSuppressedRef.current) setShowRIT(true);');
    expect(page).toContain('leaveAttentionSuppressedRef.current = suppressed;');
    expect(page).toContain('setLeaveAttentionSuppressedState(suppressed);');
    expect(page).toContain('setDecisionDeadline(null);');
  });
});
