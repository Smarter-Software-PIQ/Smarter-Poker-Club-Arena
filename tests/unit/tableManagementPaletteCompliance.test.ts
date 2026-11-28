import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/pages/GameManagementPage.module.css'), 'utf8');

const rule = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`, 's'))?.[0] ?? '';
};

describe('Table Management uses the #SmarterDesign status palette (Dan 2026-11-27)', () => {
  it('uses the chrome blue for live and positive, gold for scheduled and warnings', () => {
    expect(rule('.healthGood')).toContain('color: #74dfff');
    expect(rule('.healthWarn,\n.healthAlert')).toContain('color: #ffd700');
    expect(rule('.statusRail.live')).toContain('background: #45adff');
    expect(rule('.statusRail.scheduled')).toContain('background: #ffd700');
    expect(rule('.ready')).toContain('color: #74dfff');
  });

  it('uses the refusal red for every destructive state', () => {
    expect(rule('.locked,\n.blocked,\n.commandRejected')).toContain('color: #ff5a6a');
    expect(css).toMatch(/\.rowActions > \.danger:not\(:disabled\)\s*\{[^}]*color: #ff5a6a/);
    expect(rule('.dialogError')).toContain('color: #ff5a6a');
  });

  it('does not restore the off-palette legacy status colors, greens included', () => {
    for (const legacy of [
      '#73e093',
      '#ffb94a',
      '#33d268',
      '#ff7282',
      '#78e09a',
      '#c8ffd2',
      '#35d95a',
    ]) {
      expect(css).not.toContain(legacy);
    }
  });
});
