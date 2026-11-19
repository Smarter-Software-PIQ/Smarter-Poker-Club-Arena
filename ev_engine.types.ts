/**
 * Realization Constants for EV Calibration
 */
export interface RealizationConstants {
  /** The id of the constant set */
  id: string;
  /** Calibration factor (multiplicative) */
  calibrationFactor: number;
  /** Drift threshold before recalibration */
  driftThreshold: number;
  /** Last calibration timestamp */
  lastCalibratedAt: string;
}
