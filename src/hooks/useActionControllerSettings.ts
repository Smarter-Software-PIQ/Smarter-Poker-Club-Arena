import { usePlayerPreference } from './usePlayerPreference';
import {
  DEFAULT_ACTION_CONTROLLER,
  normalizeActionController,
  type ActionControllerSettings,
} from '../lib/actionController';

/** Account-wide, revision-checked persistence through the existing preference owner. */
export function useActionControllerSettings() {
  const [stored, select] = usePlayerPreference(
    'action-controller',
    DEFAULT_ACTION_CONTROLLER,
    'global'
  );
  const settings = normalizeActionController(stored);
  const update = (patch: Partial<ActionControllerSettings>) =>
    select((previous) =>
      normalizeActionController({ ...normalizeActionController(previous), ...patch })
    );
  return { settings, update };
}
