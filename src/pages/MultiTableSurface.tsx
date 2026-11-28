import MultiTablePage from './MultiTablePage';
import { ConsoleSkinProvider } from '../components/console/SpadeConsole';

/**
 * #SMARTERDESIGN for the whole table layer (Dan 2026-11-27). Every console the
 * table draws - buy-in, rebuy, settings, hand history, sit out, wait list, the
 * tournament screens - wears the arena workspace dress instead of the painted
 * master. One provider here reaches all of them, portals included.
 *
 * It lives in this lazily loaded module, not in PersistentTableLayer, because
 * that layer is part of the entry chunk every player downloads before first
 * paint (`scripts/ci/entry-chunk-delta.mjs`).
 */
export default function MultiTableSurface() {
  return (
    <ConsoleSkinProvider value="smarterdesign">
      <MultiTablePage />
    </ConsoleSkinProvider>
  );
}
