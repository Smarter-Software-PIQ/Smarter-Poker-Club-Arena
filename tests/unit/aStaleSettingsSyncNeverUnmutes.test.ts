/**
 * A STALE SETTINGS SYNC NEVER CHANGES A PLAYER'S SOUND (2026-09-27, 2026-11-14).
 *
 * TablePage had a SETTINGS_UPDATED listener that read `soundEnabled` out of the
 * Settings page's cached copy. The account sync and the theme mirror re-send
 * that copy, and it goes stale the moment a player changes sound at the table.
 *
 *   2026-09-27: a stale `true` un-muted a muted player. The listener was made
 *               mute-only.
 *   2026-11-14: a stale `false` then re-muted a player who had turned sound on
 *               at the table. Narrowed to the Settings page's own save, and
 *               later the same day removed: the Settings page already reaches
 *               the table through useTableSettings in both directions, so the
 *               listener carried nothing that route does not.
 *
 * Nothing at the table reads that cache now. This keeps it that way.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p: string) => strip(readFileSync(resolve(__dirname, '../..', p), 'utf8'));
const TABLE = read('src/pages/TablePage.tsx');

describe('the table and the Settings page cache', () => {
  it('the table page does not listen for SETTINGS_UPDATED', () => {
    expect(TABLE).not.toContain("'SETTINGS_UPDATED'");
  });

  it('nothing in the table page sets sound from a payload', () => {
    expect(TABLE).not.toMatch(/\.soundEnabled === false/);
    expect(TABLE).not.toMatch(/setEnabled\(s\.soundEnabled\)/);
    expect(TABLE).not.toMatch(/soundService\.setEnabled\((true|false)\)/);
  });

  it('the Settings page reaches the table through the table settings store', () => {
    const SETTINGS = read('src/pages/SettingsPage.tsx');
    expect(SETTINGS).toMatch(/updateSettings: updateTableSettings \} = useTableSettings\(\)/);
    expect(SETTINGS).toMatch(/updateTableSettings\(patch\)/);
    expect(read('src/lib/settingsBridge.ts')).toMatch(/isSoundEnabled: s\.soundEnabled/);
  });
});
