# server/src/engine/HorseUpgradeLiveEvidence.law.test.ts

Every enabled entry in the Horse upgrade activation manifest names at least one counter the engine emits on that upgrade's own path (`HORSE_UPGRADE_LIVE_EVIDENCE`), and every named counter still has an emitting line in non-test engine source, so an upgrade can never again be declared enabled with nothing the serving engine produces to show it ran.
