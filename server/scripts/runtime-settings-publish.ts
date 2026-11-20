/**
 * Publishes an engine runtime settings version (2026-11-19, server/src/engine/runtimeSettings). A published version
 * goes live at each table's next hand boundary with no engine cutover. The settings are checked against THIS
 * checkout's registry first; the serving engine checks them again against its own and refuses a version it does not
 * register whole (the last good version keeps serving), so publish only keys the serving release registers.
 *
 * Run from server/:
 *   npx tsx scripts/runtime-settings-publish.ts --check <settings.json>
 *       validate only: print every value the engine would serve and what differs from the compiled defaults
 *   npx tsx scripts/runtime-settings-publish.ts --sql <settings.json> --note "<why>"
 *       print the SQL line for a migration that publishes it (the reviewed route)
 *   npx tsx scripts/runtime-settings-publish.ts --publish <settings.json> --note "<why>" --actor "<who>"
 *   npx tsx scripts/runtime-settings-publish.ts --rollback <version> --note "<why>" --actor "<who>"
 *       call the database directly (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the environment)
 *
 * <settings.json> is one JSON object of setting key to number, for example {"lightning.fastFoldMedianMs": 650}.
 * A key left out keeps its compiled default.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { RUNTIME_SETTINGS_REGISTRY } from '../src/engine/runtimeSettings/registry.js';
import { validateRuntimeSettingValues } from '../src/engine/runtimeSettings/snapshot.js';

export function checkRuntimeSettingsFile(text: string): {
  ok: boolean;
  lines: string[];
  settings?: Record<string, number>;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      lines: [`not JSON: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
  const checked = validateRuntimeSettingValues(parsed);
  if (!checked.ok) return { ok: false, lines: [`refused: ${checked.reason}`] };
  const lines = RUNTIME_SETTINGS_REGISTRY.map((spec) => {
    const value = checked.values[spec.key];
    const changed = value !== spec.compiledDefault;
    return `${changed ? '*' : ' '} ${spec.key} = ${value}${changed ? ` (compiled ${spec.compiledDefault})` : ''}`;
  });
  return { ok: true, lines, settings: parsed as Record<string, number> };
}

const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function runtimeSettingsPublishSql(
  settings: Record<string, number>,
  note: string,
  actor: string
): string {
  return (
    `SELECT public.fn_ca_engine_runtime_settings_publish(${sqlText(JSON.stringify(settings))}::jsonb, ` +
    `${sqlText(note)}, ${sqlText(actor)});`
  );
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const file = arg('--check') ?? arg('--sql') ?? arg('--publish');
  const rollback = arg('--rollback');
  const note = arg('--note');
  const actor = arg('--actor');
  if (rollback === undefined && !file) {
    console.error('usage: see the header of scripts/runtime-settings-publish.ts');
    return 2;
  }
  let settings: Record<string, number> | undefined;
  if (file) {
    const result = checkRuntimeSettingsFile(readFileSync(file, 'utf8'));
    for (const line of result.lines) console.log(line);
    if (!result.ok) return 1;
    settings = result.settings;
    if (process.argv.includes('--check')) return 0;
  }
  if (!note || note.trim().length < 3) {
    console.error('--note "<why>" is required (3 characters or more)');
    return 2;
  }
  if (process.argv.includes('--sql')) {
    console.log(runtimeSettingsPublishSql(settings!, note, actor ?? 'migration'));
    return 0;
  }
  if (!actor) {
    console.error('--actor "<who>" is required');
    return 2;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    return 2;
  }
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } =
    rollback !== undefined
      ? await client.rpc('fn_ca_engine_runtime_settings_rollback', {
          p_version: Number(rollback),
          p_note: note,
          p_actor: actor,
        })
      : await client.rpc('fn_ca_engine_runtime_settings_publish', {
          p_settings: settings,
          p_note: note,
          p_actor: actor,
        });
  if (error) {
    console.error(`refused: ${error.message}`);
    return 1;
  }
  console.log(JSON.stringify(data));
  console.log("live at each table's next hand once the engine reads it (within 30 s)");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    }
  );
}
