# tests/horse-fleet-not-seated-honours-the-night-curve.law.test.ts

HorseFleetNotSeated in infra/monitoring/alert-rules.yml uses the derived overnight floor (NIGHT_MIN_OPEN_TABLES * NIGHT_MIN_PLAYERS = 12), sits strictly below the designed overnight operating band and seat ceiling across every night hour (03:00-07:59 Chicago), and preserves both the maintenance-break and owner-floor-park guards.
