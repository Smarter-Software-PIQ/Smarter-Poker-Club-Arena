import { supabase } from '../lib/supabase';
import { masterBus } from '../core/MasterBus';
import { RealizationConstants } from '../types/ev_engine.types';

/**
 * CalibrationService
 * Monitors EV cashout performance and recalibrates realization constants.
 */
class CalibrationService {
  private constants: RealizationConstants | null = null;

  constructor() {
    this.init();
  }

  private async init() {
    // Load initial constants
    const { data, error } = await supabase
      .from('ev_realization_constants')
      .select('*')
      .order('lastCalibratedAt', { ascending: false })
      .limit(1)
      .single();

    if (!error && data) {
      this.constants = data as RealizationConstants;
    }
  }

  public async recordOutcome(handId: string, expectedEV: number, realizedEV: number) {
    const drift = Math.abs(expectedEV - realizedEV);
    
    // Log to DB for auditing
    await supabase.from('ev_calibration_logs').insert({
      hand_id: handId,
      expected_ev: expectedEV,
      realized_ev: realizedEV,
      drift,
      calibrated_at: new Date().toISOString()
    });

    if (this.constants && drift > this.constants.driftThreshold) {
      this.recalibrate(realizedEV / expectedEV);
    }
  }

  private async recalibrate(newFactor: number) {
    if (!this.constants) return;

    // Apply adjustment factor
    const updatedFactor = this.constants.calibrationFactor * newFactor;
    
    await supabase
      .from('ev_realization_constants')
      .update({ calibrationFactor: updatedFactor, lastCalibratedAt: new Date().toISOString() })
      .eq('id', this.constants.id);
  }
}

export const calibrationService = new CalibrationService();
