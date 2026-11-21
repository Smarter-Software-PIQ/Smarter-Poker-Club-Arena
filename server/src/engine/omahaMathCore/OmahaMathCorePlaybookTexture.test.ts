/**
 * Law: board texture moves the measured fold share of a responder (lane PLAYBOOK). Constructed boards.
 */
import { describe, expect, it } from 'vitest';
import { parseCardString } from './OmahaMathCoreEval.js';
import { OMAHA_MATH_CORE_ALLOWED_PROVENANCE } from './OmahaMathCoreTables.js';
import {
  PLAYBOOK_TEXTURE_TABLE,
  boardTexture,
  textureFold,
} from './OmahaMathCorePlaybookTexture.js';

describe('omahaMathCore PLAYBOOK board texture', () => {
  it('the table is public provenance', () => {
    expect(OMAHA_MATH_CORE_ALLOWED_PROVENANCE.has(PLAYBOOK_TEXTURE_TABLE.provenance)).toBe(true);
  });

  it('classifies boards', () => {
    expect(boardTexture(parseCardString('Ks9s5s'))).toBe('unpaired_flush3');
    expect(boardTexture(parseCardString('KsKd5h'))).toBe('paired_rainbow');
    expect(boardTexture(parseCardString('Ks9d5h'))).toBe('unpaired_rainbow');
    expect(boardTexture(parseCardString('Ks9s5h2d'))).toBe('unpaired_twotone');
    expect(boardTexture([])).toBeNull();
  });

  it('a paired flop raises the pooled fold share against a small heads-up bet; an unpaired rainbow flop lowers it', () => {
    const base = {
      street: 'flop' as const,
      band: 'small' as const,
      players: 'hu' as const,
      p: 0.2,
    };
    const paired = textureFold({ ...base, board: parseCardString('KsKd5h') });
    const dry = textureFold({ ...base, board: parseCardString('Ks9d5h') });
    expect(paired.p).toBeGreaterThan(0.2);
    expect(dry.p).toBeLessThan(0.2);
    expect(paired.source).toContain('texture paired_rainbow');
  });

  it("the adjustment is a ratio on the core's own fold probability", () => {
    const k = {
      street: 'flop' as const,
      band: 'small' as const,
      players: 'hu' as const,
      board: parseCardString('KsKd5h'),
    };
    const a = textureFold({ ...k, p: 0.1 });
    const b = textureFold({ ...k, p: 0.3 });
    expect(b.p / a.p).toBeCloseTo(3, 6);
  });

  it('bad input or a missing cell leaves the fold share unchanged, never throws', () => {
    const k = {
      street: 'flop' as const,
      band: 'small' as const,
      players: 'hu' as const,
    };
    expect(textureFold({ ...k, board: [], p: 0.4 }).p).toBe(0.4);
    expect(textureFold({ ...k, board: parseCardString('Ks9d5h'), p: 0 }).p).toBe(0);
    expect(textureFold({ ...k, board: parseCardString('Ks9d5h'), p: Number.NaN }).p).toBe(0);
    expect(
      textureFold({
        ...k,
        street: 'river',
        band: 'allin',
        players: 'mw',
        board: parseCardString('Ks9d5h2c3d'),
        p: 0.5,
      }).p
    ).toBeGreaterThanOrEqual(0);
  });
});
