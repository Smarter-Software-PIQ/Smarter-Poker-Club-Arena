// The real-filesystem probe drive-loss-lib.mjs is evaluated against. Tests inject their own.
import { existsSync, statSync } from 'node:fs';

export function fsDriveProbe() {
  return {
    exists: (p) => existsSync(p),
    dev: (p) => statSync(p).dev,
    bootDev: statSync('/').dev,
  };
}
