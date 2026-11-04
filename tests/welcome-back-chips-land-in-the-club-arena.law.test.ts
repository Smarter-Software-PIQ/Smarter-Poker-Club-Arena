/**
 * Welcome-back chips (Dan 2026-11-04).
 *
 * The join-a-club nudge links to /?join=<club code>&ref=<referral code> and
 * the chips email and play nudge link to /?welcome=chips. HomePage must open
 * the join modal with that code (and pass the referral code through), and
 * announce the welcome_chips push moment so the prompt may ask. The policy's
 * moment list and the prompt's copy table must both know the moment (the
 * World Hub keeps a matching entry in its own policy; this test reads only
 * this repo). A signed-out player who opens one of those links sees the
 * landing page, so its Sign In plate must carry the query back through
 * login instead of returning everyone to a bare '/'.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NUDGE_MOMENTS } from '../src/lib/pushNudgePolicy';

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8');

describe('welcome-back chips land in the Club Arena', () => {
  it('welcome_chips is a push-nudge moment with its own copy', () => {
    expect(NUDGE_MOMENTS).toContain('welcome_chips');
    expect(read('src/components/notifications/FirstRunPushPrompt.tsx')).toMatch(/welcome_chips: \{\s*title: 'Never Miss Free Chips Again'/);
  });

  it('HomePage opens the join modal from /?join=<code>&ref=<referral> and fires welcome_chips from /?welcome=chips', () => {
    const src = read('src/pages/HomePage.tsx');
    expect(src).toMatch(/searchParams\.get\('join'\)/);
    expect(src).toMatch(/setJoinIntent\(\{ code: joinCode\.trim\(\), watchTableId: null, ref: searchParams\.get\('ref'\)/);
    expect(src).toMatch(/setShowJoinModal\(true\)/);
    expect(src).toMatch(/initialRef=\{joinIntent\?\.ref \|\| undefined\}/);
    expect(src).toMatch(/welcome === 'chips'/);
    expect(src).toMatch(/requestPushNudge\('welcome_chips'\)/);
    // consumed once: the params are deleted after use
    expect(src).toMatch(/next\.delete\('join'\);\s*next\.delete\('ref'\);/);
    expect(src).toMatch(/next\.delete\('welcome'\)/);
  });

  it('the landing page brings a signed-out player back to the link they clicked', () => {
    const src = read('src/pages/PokerArenaLandingPage.tsx');
    expect(src).not.toMatch(/signInUrl\('\/'\)/);
    expect(src).toMatch(/signInUrl\(returnPathAfterSignIn\(\)\)/);
    expect(src).toMatch(/window\.location\.search/);
  });
});
