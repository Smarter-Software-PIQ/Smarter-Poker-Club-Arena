-- Fails on the captured pre-fix reader: a non-dealt-in caller learns a hand's existence.
SET test.viewer='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
DO $$ BEGIN
  ASSERT fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111',10)
       = fn_rabbit_hunt_replay_status('11111111-1111-1111-1111-111111111111',999),
    'Non-dealt-in caller can tell a saved hand from no hand';
END $$;
RESET test.viewer;
