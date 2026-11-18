import { HorseAutoTuner } from './HorseAutoTuner';

describe('HorseAutoTuner', () => {
  it('should initialize correctly', () => {
    const tuner = new HorseAutoTuner();
    expect(tuner).toBeDefined();
  });
});
