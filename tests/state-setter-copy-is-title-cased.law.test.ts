/**
 * STATE A PAGE PRINTS IS COPY (2026-11-28)
 *
 * check-title-case read JSX text, UI attributes, copy properties and native
 * dialogs. A message handed to a state setter - setError('Failed to load agent
 * hierarchy') - is stored and then rendered as the page's error line, yet it is
 * a call argument, so about ninety such strings shipped lower case ("User not
 * found", "Failed to send request"). The gate now reads setters named for a
 * player-facing message (setError, setLoadError, setStatusMessage, setNotice,
 * setWarning and the like), and only prose, so a status value such as
 * setFeedback('idle') or setError(null) is left alone.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function gate(source: string): { ok: boolean; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'title-case-setters-'));
  mkdirSync(join(dir, 'pages'));
  writeFileSync(join(dir, 'pages', 'Fixture.tsx'), source);
  try {
    const output = execFileSync('node', ['scripts/ci/check-title-case.mjs'], {
      env: { ...process.env, TITLE_CASE_SOURCE_DIR: dir },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { ok: true, output };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('a message given to a state setter is Title Cased', () => {
  it.each([
    "setError('Failed to load agent hierarchy');",
    "setLoadError('Achievement progress could not be loaded.');",
    "setStatusMessage('Join request cancelled.');",
    "setNotice('Could not load avatars. Please try again shortly.');",
    'setActionError(`Launch failed: ${reason}`);',
    "setError(ok ? null : 'Enter a valid amount');",
  ])('flags %s', (line) => {
    const result = gate(`export function f(reason: string, ok: boolean) {\n  ${line}\n}\n`);
    expect(result.ok, result.output).toBe(false);
    expect(result.output).toMatch(/\(\) copy\]/);
  });

  it.each([
    "setError('Failed To Load Agent Hierarchy');",
    "setFeedback('idle');",
    "setStatus('loading');",
    'setError(null);',
    "setMessage('ok');",
  ])('accepts %s', (line) => {
    const result = gate(`export function f() {\n  ${line}\n}\n`);
    expect(result.ok, result.output).toBe(true);
  });
});
