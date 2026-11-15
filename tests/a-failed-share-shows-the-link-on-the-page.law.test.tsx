/**
 * LAW: A FAILED SHARE SHOWS THE LINK ON THE PAGE, NEVER ONLY IN A TOAST
 * (2026-11-15, found during the signed-in check on production).
 *
 * src/lib/share.ts answers "failed" only when the share sheet, the Clipboard
 * API and the selection copy all refused; the caller then owes the player the
 * link so it can be copied by hand. Tournament Details and the Referral
 * Dashboard put it in an error toast ("Could Not Share. Copy This Link:
 * <url>"), and the Toast layer sanitises error text (utils/safeErrorMessage.ts,
 * a URL reads as a machine fingerprint). On production the player read
 * "Could Not Share. Copy This Link. Please Try Again." with no link anywhere.
 *
 * The link now goes on the page in components/common/ShareLinkFallback.tsx,
 * selected so Cmd+C or a long-press copies it.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen } from '@testing-library/react';
import { ShareLinkFallback } from '../src/components/common/ShareLinkFallback';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe('a failed share shows the link on the page', () => {
  it('no error toast carries a link for the player to copy', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) =>
        /toast\??\.error\??\.?\(\s*`[^`]*\$\{\s*(url|link|shareUrl|referralLink)\s*\}/.test(
          readFileSync(f, 'utf8')
        )
      )
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('the two surfaces that used to do it render the fallback instead', () => {
    for (const rel of [
      'src/pages/tournament/TournamentDetails.tsx',
      'src/components/social/ReferralDashboard.tsx',
    ]) {
      const code = readFileSync(join(ROOT, rel), 'utf8');
      expect(code, rel).toMatch(/else if \(outcome === 'failed'\) setShareFallbackUrl\(url\);/);
      expect(code, rel).toMatch(
        /\{shareFallbackUrl && <ShareLinkFallback url=\{shareFallbackUrl\}/
      );
    }
  });

  it('the fallback says so, shows the link and selects it', () => {
    const url = 'https://smarter.poker/t/0cce336e-0829-46da-a5f5-ab4511cd8316';
    render(<ShareLinkFallback url={url} label="Tournament Link" />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Copy Is Blocked Here. The Tournament Link Is Selected, Copy It By Hand.'
    );
    const input = screen.getByRole('textbox', { name: 'Tournament Link' }) as HTMLInputElement;
    expect(input.value).toBe(url);
    expect(input.readOnly).toBe(true);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, url.length]);
  });
});
