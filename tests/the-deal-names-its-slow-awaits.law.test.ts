/**
 * The deal names its slow awaits (2026-11-11).
 *
 * #10435's breach line reported three 2,091-2,572 ms cash next-hand starts
 * whose excess sat in the `dealing` stage, after the "Hand #N" log and before
 * the deal was recorded. dealHand awaits several round trips there (hand
 * number allocation, the bomb-pot claim, the cash hand manifest, the time-bank
 * reads), and the stage could not say which. Each is now its own breach
 * stage, so the next breach names the await that spent the time.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'server/src/engine/ServerTableEngineDealing.ts'),
  'utf8'
);

describe('the deal names its slow awaits', () => {
  it.each(['deal_allocate', 'deal_bomb_claim', 'deal_manifest', 'deal_time_bank_reads'])(
    '%s is a breach stage that returns to dealing afterwards',
    (stage) => {
      const at = src.indexOf(`this.cashBreachSpan?.enter('${stage}');`);
      expect(at).toBeGreaterThan(0);
      expect(src.indexOf("this.cashBreachSpan?.enter('dealing');", at)).toBeGreaterThan(at);
    }
  );
});
