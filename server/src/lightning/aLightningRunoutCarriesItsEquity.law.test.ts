/**
 * LAW - A LIGHTNING RUNOUT CARRIES ITS EQUITY (2026-11-18)
 *
 * StatsAllInEquityCoverageLow was escalated because every owed Lightning
 * runout seat (581 in one day; Classic cash and tournaments complete) was
 * written with no all_in_equity: the Lightning host ran ALL_IN_RUNOUT out and
 * never priced it, and the facts writer only read the Classic table broadcast.
 * The host now prices the first all-in point on the shared equity pool, keeps
 * it for that hand only, and passes it explicitly into the facts; the facts
 * writer prefers that explicit price. Pricing is never awaited by the runout
 * or the settlement.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const HOST = read('./LightningHandHost.ts');
const FACTS = read('./LightningHandFacts.ts');
const WRITER = read('../services/supabase/handFacts.ts');

describe('a Lightning runout carries its equity', () => {
  it('the host prices ALL_IN_RUNOUT before running the board out', () => {
    const i = HOST.indexOf("case 'ALL_IN_RUNOUT':");
    const j = HOST.indexOf('void this.runOut();', i);
    expect(i).toBeGreaterThan(0);
    expect(HOST.slice(i, j)).toContain('this.priceRunoutEquity(event);');
  });

  it('the price is never awaited, kept for its own hand only, and dropped when the hand moved on', () => {
    const i = HOST.indexOf('private priceRunoutEquity(');
    const body = HOST.slice(i, HOST.indexOf('private isMucked(', i));
    expect(body).toContain('void priceLightningRunout(');
    expect(body).not.toMatch(/\bawait\b/);
    expect(body).toContain('if (this.runoutEquityHand === this.handNumber) return;');
    expect(body).toContain(
      'token === this.runoutEquityToken && this.handNumber === hand && this.hc === hc'
    );
    expect(HOST).toContain(
      'allInEquity: this.runoutEquityHand === this.handNumber ? this.runoutEquity : null,'
    );
  });

  it('the facts input carries it and the writer prefers it over the table capture', () => {
    expect(FACTS).toContain('allInEquity: hand.allInEquity ?? null,');
    expect(WRITER).toMatch(
      /const equity: CapturedEquity \| null = input\.allInEquity\s*\?[\s\S]{0,160}: captured;/
    );
  });
});
