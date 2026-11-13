import type { BlindLevel } from './blindStructures';

/**
 * CUSTOM STRUCTURE VALIDATION, MIRRORING THE DATABASE CONTRACT.
 *
 * A standalone club or union authors its own ladder, and the database already
 * refuses a bad one in `fn_ca_mtt_blind_contract`. Without a client check the
 * creator sees that refusal as a raw database error after submitting; with it
 * they are told which level is wrong while they can still fix it.
 *
 * This is deliberately NOT a second contract. Every rule below exists because
 * `fn_ca_mtt_blind_contract` raises on it, and the messages name the same
 * conditions. The database stays authoritative: this never admits anything the
 * contract would refuse, it only refuses earlier and more legibly. If the
 * contract changes, this changes with it.
 */
export interface CustomStructureProblem {
  level: number;
  message: string;
}

export function validateCustomStructure(levels: readonly BlindLevel[]): CustomStructureProblem[] {
  const problems: CustomStructureProblem[] = [];
  const playable = levels.filter((row) => !row.isBreak);

  if (playable.length === 0) {
    return [{ level: 0, message: 'A Structure Needs At Least One Playable Level' }];
  }

  let previousSmall = -1;
  let previousBig = -1;

  levels.forEach((row, index) => {
    const position = index + 1;
    const small = Number(row.smallBlind);
    const big = Number(row.bigBlind);
    const ante = Number(row.ante ?? 0);
    const minutes = Number(row.durationMinutes);

    if (!Number.isFinite(minutes) || minutes <= 0) {
      problems.push({ level: position, message: 'Level Needs A Positive Duration' });
    }

    if (row.isBreak) {
      if (index === 0) {
        problems.push({ level: position, message: 'A Structure Cannot Open With A Break' });
      }
      if (small !== 0 || big !== 0 || ante !== 0) {
        problems.push({ level: position, message: 'A Break Carries No Blinds Or Ante' });
      }
      return;
    }

    if (!Number.isFinite(small) || !Number.isFinite(big) || !Number.isFinite(ante)) {
      problems.push({ level: position, message: 'Level Has Invalid Blinds Or Ante' });
      return;
    }
    if (big <= 0 || small > big) {
      problems.push({
        level: position,
        message: 'Big Blind Must Be Positive And At Least The Small Blind',
      });
    }
    if (ante < 0) {
      problems.push({ level: position, message: 'Ante Cannot Be Negative' });
    }
    if (small < previousSmall || big < previousBig) {
      problems.push({ level: position, message: 'Blinds Cannot Decrease' });
    }
    previousSmall = small;
    previousBig = big;
  });

  return problems;
}

/** True when the authored ladder would be accepted by the database contract. */
export function customStructureIsValid(levels: readonly BlindLevel[]): boolean {
  return validateCustomStructure(levels).length === 0;
}
