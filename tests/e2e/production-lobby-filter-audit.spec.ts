import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { test, expect, devices, type Page, type Locator } from '@playwright/test';
import {
  FILTER_SPECS,
  type GameFilterValue,
  type GameFilterSpec,
} from '../../src/components/lobby/advancedFilterSpec';
import { readLobbyPreferenceOwner } from './support/lobbyPreferenceProof';
import { prepareCashLobbyActions } from './support/cashLobbyOverlays';
import { diamondEntryRead, settleDiamondSpinsOffer } from './support/diamondInvitationOffer';

// The catalogue supplies control names only. Expected membership below is an
// independent calculation over actual responses, never the product matcher.
const TYPES = ['HOLDEM', 'OMAHA', 'LIMIT', 'MTT', 'SPIN', 'SNG', 'SATELLITE'] as const;
type Tab = (typeof TYPES)[number];
type Row = Record<string, unknown> & { id: string };
const CLUB_ID = process.env.E2E_CLUB_ID || 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4';
const LABEL: Record<Tab, string> = {
  HOLDEM: 'NLH',
  OMAHA: 'PLO',
  LIMIT: 'LIMIT',
  MTT: "MTT'S",
  SPIN: 'SPINS',
  SNG: "SIT N GO'S",
  SATELLITE: 'SATELLITES',
};
const CASH = new Set<string>(['HOLDEM', 'OMAHA', 'LIMIT']);
const SORTS = [
  ['recommended', 'Recommended'],
  ['stakes_high', 'Stakes: High To Low'],
  ['stakes_low', 'Stakes: Low To High'],
  ['players', 'Most Players'],
  ['starting_soon', 'Starting Time'],
] as const;
test.use({
  ...devices['iPhone 13'],
  viewport: { width: 393, height: 852 },
  timezoneId: 'America/Chicago',
  trace: 'retain-on-failure',
  actionTimeout: 10_000,
});
test.describe.configure({ mode: 'default', timeout: 180_000 });

const actionTimelines = new WeakMap<Page, unknown[]>();
const diagnosticRows = new WeakMap<Page, Map<string, Row>>();
const publicRowFields = [
  'id',
  'club_id',
  'union_id',
  'game_type',
  'game_variant',
  'variant',
  'tournament_type',
  'format_contract',
  'status',
  'lifecycle',
  'is_deleted',
  'current_players',
  'max_players',
  'buy_in_amount',
  'buy_in_fee',
  'small_blind',
  'big_blind',
  'cluster_id',
  'start_time',
  'started_at',
  'ended_at',
  'created_at',
  'satellite_target_id',
  'is_satellite',
  'proof_board_census',
];
function persistProgress(page: Page) {
  const output = test.info().outputPath('attachments', 'filter-action-progress.json');
  mkdirSync(dirname(output), { recursive: true });
  const observer = observationHandles.get(page);
  writeFileSync(
    output,
    JSON.stringify({
      observedAt: Date.now(),
      actions: actionTimelines.get(page),
      sourceRows: [...(diagnosticRows.get(page)?.values() || [])].map((row) =>
        Object.fromEntries(
          publicRowFields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]])
        )
      ),
      observerErrors: observer?.errors,
      lifecycleWitnesses: observer?.witnesses,
    })
  );
}
const observationHandles = new WeakMap<
  Page,
  { finish: () => Promise<void>; errors: unknown[]; witnesses: unknown[] }
>();
test.afterEach(async ({ page }, info) => {
  const observer = observationHandles.get(page);
  if (!observer) return;
  await observer.finish();
  await info.attach('filter-source-observations.json', {
    body: Buffer.from(
      JSON.stringify({
        errors: observer.errors,
        lifecycleWitnesses: observer.witnesses,
        actions: actionTimelines.get(page),
      })
    ),
    contentType: 'application/json',
  });
  expect(
    observer.errors,
    'Every asynchronous source observation must complete successfully'
  ).toEqual([]);
});

async function clickControl(locator: Locator, options?: Parameters<Locator['click']>[0]) {
  const control = locator.toString();
  const started = Date.now();
  const page = locator.page();
  const action: Record<string, unknown> = { control, started, phase: 'starting', completed: false };
  actionTimelines.get(page)?.push(action);
  persistProgress(page);
  await test.step(control, async () => {
    try {
      action.before = await locator.evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const details = element.closest('details');
          const ancestors = [];
          for (let parent = element.parentElement; parent; parent = parent.parentElement) {
            if (parent.scrollHeight > parent.clientHeight) {
              const box = parent.getBoundingClientRect();
              ancestors.push({
                className: parent.className,
                scrollTop: parent.scrollTop,
                height: parent.clientHeight,
                scrollHeight: parent.scrollHeight,
                top: box.top,
                bottom: box.bottom,
              });
            }
          }
          return {
            text: element.textContent?.trim().slice(0, 100),
            rect: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
            detailsOpen: details?.open,
            display: getComputedStyle(element).display,
            visibility: getComputedStyle(element).visibility,
            ancestors,
          };
        })
      );
      action.phase = 'native-scroll';
      persistProgress(page);
      // Scroll the real overflow owner before Playwright's actionability check.
      // Retain the ordinary visible, stable, enabled and hit-target checks.
      await locator.scrollIntoViewIfNeeded({ timeout: 10_000 });
      action.phase = 'click';
      persistProgress(page);
      const closesSheet =
        control.includes('Close Game Filters') || /name: ['"]Done['"]/.test(control);
      const dialog = closesSheet ? locator.locator('xpath=ancestor::*[@role="dialog"]') : null;
      await locator.click({ ...options, timeout: 10_000 });
      if (dialog) await expect(dialog).toBeHidden();
      action.completed = true;
    } catch (error) {
      action.error = error instanceof Error ? error.message : String(error);
      persistProgress(page);
      try {
        await page.screenshot({
          path: test.info().outputPath('filter-control-failure.png'),
          timeout: 5_000,
        });
      } catch (capture) {
        action.captureError = capture instanceof Error ? capture.message : String(capture);
      }
      throw error;
    } finally {
      action.elapsedMs = Date.now() - started;
      persistProgress(page);
    }
  });
}

const text = (v: unknown) => String(v ?? '');
const number = (v: unknown) => Number(v) || 0;
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const sorted = (ids: string[]) => [...ids].sort();
function variant(row: Row, cash: boolean): string {
  const value = text(cash ? row.game_variant : row.game_type || row.variant).toLowerCase();
  const names: [string, RegExp][] = [
    ['flo8', /flo8|limit[_ ]omaha/],
    ['plo8', /plo8|hi\/lo|hilo/],
    ['plo6', /plo6/],
    ['plo5', /plo5/],
    ['plo4', /plo4|^plo$/],
    ['short_deck', /short|^6\+$/],
    ['flh', /flh|limit[_ ]holdem/],
    ['pineapple', /pineapple/],
    ['nlh', /nlh|hold'?em/],
  ];
  return names.find(([, pattern]) => pattern.test(value))?.[0] ?? value;
}
function satellite(row: Row): boolean | null {
  if (
    text(row.variant).toLowerCase() === 'satellite' ||
    text(row.tournament_type).toUpperCase() === 'SATELLITE' ||
    row.satellite_target_id ||
    row.satellite_target ||
    row.format_contract === 'seat-first-satellite-v1'
  )
    return true;
  if (['sng-v1', 'spin-v1'].includes(text(row.format_contract))) return false;
  if (
    ['variant', 'tournament_type', 'satellite_target_id', 'satellite_target'].every(
      (key) => row[key] !== undefined
    )
  )
    return false;
  return /\bsat(?:ellite)?\b/i.test(text(row.name)) ? true : null;
}
function lateTerms(row: Row): { cap: number; current: number; minutes: number; valid: boolean } {
  const fields = [row.current_level, row.late_reg_levels, row.rebuy_levels, row.late_reg_mins];
  const valid =
    row.prize_pool_finalized !== true &&
    fields.every((value) => value == null || (Number.isSafeInteger(value) && number(value) >= 0));
  return {
    cap: number(row.late_reg_levels ?? row.rebuy_levels),
    current: number(row.current_level),
    minutes: number(row.late_reg_mins),
    valid,
  };
}
function lateOpen(row: Row): boolean {
  if (
    !['RUNNING', 'IN_PROGRESS', 'LATE_REG', 'LATE_REGISTRATION'].includes(
      text(row.status).toUpperCase()
    )
  )
    return false;
  const terms = lateTerms(row);
  if (
    !terms.valid ||
    (!terms.cap && !terms.minutes) ||
    (terms.cap > 0 && terms.current >= terms.cap)
  )
    return false;
  return (
    terms.minutes <= 0 || Date.now() < Date.parse(text(row.started_at)) + terms.minutes * 60000
  );
}
function namedConvention(row: Row): string {
  const name = text(row.name).toLowerCase();
  return name.includes('satellite')
    ? 'satellite'
    : /freeroll|free roll/.test(name)
      ? 'freeroll'
      : name.includes('mystery')
        ? 'mystery'
        : /pko|progressive/.test(name)
          ? 'pko'
          : /bounty|ko /.test(name)
            ? 'ko'
            : 'freezeout';
}
function feature(row: Row, key: string, spec: GameFilterSpec, cash: boolean): boolean | null {
  const specFeature = spec.features.find((item) => item.key === key)!;
  if (cash) {
    if (key === 'kill_pot')
      return row.kill_mode === undefined ? null : ['half', 'full'].includes(text(row.kill_mode));
    let settings = object(row.settings);
    if (typeof row.settings === 'string') {
      try {
        settings = object(JSON.parse(row.settings));
      } catch {
        settings = {};
      }
    }
    const read = (field: string) => (row[field] !== undefined ? row[field] : settings[field]);
    const flag = (field: string, defaultValue = false): boolean | null => {
      const value = read(field);
      if (value === undefined) return null;
      if (value === null) return defaultValue;
      if (value === true || value === 'true' || value === 1) return true;
      if (value === false || value === 'false' || value === 0) return false;
      return null;
    };
    const all = (values: (boolean | null)[]): boolean | null =>
      values.includes(false) ? false : values.includes(null) ? null : true;
    const any = (values: (boolean | null)[]): boolean | null =>
      values.includes(true) ? true : values.includes(null) ? null : false;
    const positive = (field: string, integer = false): boolean | null =>
      read(field) === undefined
        ? null
        : Number.isFinite(Number(read(field))) &&
          (integer ? Math.floor(Number(read(field))) : Number(read(field))) > 0;
    const bomb = (): boolean | null => {
      const mode = read('bomb_pot_trigger_mode');
      return all([
        flag('bomb_pot_enabled'),
        mode === undefined
          ? null
          : ['once_per_orbit', 'bomb_pot_only'].includes(text(mode))
            ? true
            : mode === 'timed'
              ? positive('bomb_pot_interval_seconds', true)
              : positive('bomb_pot_frequency', true),
      ]);
    };
    switch (key) {
      case 'ante':
        return all([flag('ante_enabled', true), positive('ante')]);
      case 'auto_straddle':
        return all([flag('straddle_enabled'), flag('auto_utg_straddle')]);
      case 'time_bank':
        return flag('time_bank_enabled', true);
      case 'bomb_pot':
        return bomb();
      case 'bomb_multi_board':
        return all([
          bomb(),
          read('bomb_pot_board_count') != null
            ? number(read('bomb_pot_board_count')) >= 2
            : flag('bomb_pot_double_board'),
        ]);
      case 'rit_choice': {
        const seats = read('max_players');
        if (seats !== undefined && number(seats) > 0 && number(seats) <= 2) return false;
        const enabled = any([
          all([flag('run_it_twice', true), flag('allow_run_it_twice', true)]),
          flag('run_it_twice_enabled'),
        ]);
        return enabled === false ? false : seats === undefined ? null : enabled;
      }
    }
    const values = specFeature.match.map(read).filter((value) => value !== undefined);
    return values.length === 0
      ? null
      : values.some(
          (value) => value === true || value === 'true' || (typeof value === 'number' && value > 0)
        );
  }
  const flag = (field: string, fallback: RegExp): boolean | null =>
    row[field] !== undefined ? row[field] === true : fallback.test(text(row.name)) ? true : null;
  switch (key) {
    case 'pko':
      return row.is_pko !== undefined
        ? row.is_pko === true
        : namedConvention(row) === 'pko'
          ? true
          : null;
    case 'mystery_bounty':
      return row.is_mystery_bounty !== undefined
        ? row.is_mystery_bounty === true
        : namedConvention(row) === 'mystery'
          ? true
          : null;
    case 'bounty': {
      const pko =
        row.is_pko !== undefined
          ? row.is_pko === true
          : namedConvention(row) === 'pko'
            ? true
            : null;
      const mystery =
        row.is_mystery_bounty !== undefined
          ? row.is_mystery_bounty === true
          : namedConvention(row) === 'mystery'
            ? true
            : null;
      if (pko === true || mystery === true) return false;
      const flags = ['is_bounty', 'is_pko', 'is_mystery_bounty'];
      const bounty = flags.some((field) => row[field] === true)
        ? true
        : flags.every((field) => row[field] !== undefined)
          ? false
          : flags.some((field) => row[field] !== undefined)
            ? null
            : ['ko', 'pko', 'mystery'].includes(namedConvention(row))
              ? true
              : null;
      if (bounty !== true) return bounty;
      if (pko === false && mystery === false) return true;
      return flags.some((field) => row[field] !== undefined)
        ? null
        : namedConvention(row) === 'ko'
          ? true
          : null;
    }
    case 'rebuy':
      return flag('is_rebuy', /rebuy/i);
    case 'reentry':
      return flag('is_reentry', /re-entry|reentry/i);
    case 'addon':
      return row.add_on_available === undefined ? null : row.add_on_available === true;
    case 'guaranteed':
      return row.guaranteed_prize === undefined ? null : number(row.guaranteed_prize) > 0;
    case 'satellite':
      return satellite(row);
    case 'late_registration': {
      if (row.prize_pool_finalized === true) return false;
      const terms = lateTerms(row);
      if (terms.valid && (terms.cap > 0 || terms.minutes > 0))
        return row.prize_pool_finalized === undefined ? null : true;
      return row.late_reg_levels !== undefined &&
        row.late_reg_mins !== undefined &&
        (row.late_reg_levels !== null || row.rebuy_levels !== undefined)
        ? false
        : null;
    }
    case 'turbo':
    case 'hyper': {
      if (!['mtt-v1', 'mtt-v2'].includes(text(row.format_contract))) return null;
      let speed = text(row.blind_speed);
      if (!['standard', 'slow', 'turbo', 'hyper_turbo'].includes(speed)) {
        let levels = row.blind_structure;
        if (typeof levels === 'string') {
          try {
            levels = JSON.parse(levels);
          } catch {
            levels = null;
          }
        }
        const opening = Array.isArray(levels)
          ? levels.map(object).find((level) => level.isBreak !== true)
          : undefined;
        const duration = opening
          ? number(opening.durationMinutes ?? opening.duration_minutes) ||
            number(opening.duration) / 60
          : 0;
        if (!duration) return null;
        speed =
          duration <= 2
            ? 'hyper_turbo'
            : duration <= 5
              ? 'turbo'
              : duration >= 12
                ? 'slow'
                : 'standard';
      }
      return speed === (key === 'hyper' ? 'hyper_turbo' : 'turbo');
    }
    case 'private':
      return row.is_private === undefined ? null : row.is_private === true;
    case 'union_event':
      return row.is_xmtt === true || row.union_id != null
        ? true
        : row.is_xmtt === false && row.union_id === null
          ? false
          : null;
    default:
      throw new Error(`Missing independent feature oracle: ${key}`);
  }
}
function style(row: Row): string {
  const key = text(row.cluster_template || object(row.cluster).template_name).toLowerCase();
  if (
    key === 'classic' &&
    row.big_blind_ante_enabled === true &&
    row.nit_game === true &&
    number(row.maintain_percent_min) > 0 &&
    row.bomb_pot_enabled === true
  )
    return 'straight_madness';
  return ['action', 'lightning'].includes(key) ? 'madness' : key;
}
function belongsToObservedFamily(row: Row, type: Tab): boolean {
  if (row.proof_board_census !== true) return false;
  const contract = text(row.format_contract);
  if (type === 'SPIN') return contract === 'spin-v1';
  if (type === 'SNG') return ['sng-v1', 'seat-first-satellite-v1'].includes(contract);
  if (type === 'MTT') return ['mtt-v1', 'mtt-v2'].includes(contract);
  if (type === 'SATELLITE')
    return (
      ['mtt-v1', 'mtt-v2', 'spin-v1', 'sng-v1', 'seat-first-satellite-v1'].includes(contract) &&
      satellite(row) === true
    );
  return false;
}
function independentMatch(
  row: Row,
  value: GameFilterValue,
  spec: GameFilterSpec,
  cash: boolean,
  allRows: Map<string, Row>
): boolean {
  const rawStatus = text(row.status).toUpperCase();
  if (!cash) {
    const start = Date.parse(text(row.start_time));
    const hours = number(row.buy_in_amount) + number(row.buy_in_fee) >= 200 ? 144 : 72;
    if (Number.isFinite(start) && start - Date.now() > hours * 60 * 60 * 1000) return false;
  }
  if (cash && (row.is_deleted === true || ['CLOSED', 'DELETED'].includes(rawStatus))) return false;
  if (
    !cash &&
    ![
      'REGISTERING',
      'LATE_REG',
      'LATE_REGISTRATION',
      'STARTING_SOON',
      'RUNNING',
      'IN_PROGRESS',
      'BAGGED',
    ].includes(rawStatus)
  )
    return false;
  if (!cash && ['mtt-v1', 'mtt-v2'].includes(text(row.format_contract))) {
    const started = Date.parse(text(row.started_at));
    const now = Date.now();
    if (Number.isFinite(started)) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' });
      if (day.format(started) !== day.format(now)) return false;
    } else if (!Number.isFinite(Date.parse(text(row.start_time)))) return false;
    // Delayed registration remains discoverable until its authoritative lifecycle changes.
  }
  const game = variant(row, cash);
  if (
    value.games.length &&
    !spec.games?.every((item) => value.games.includes(item.key)) &&
    game &&
    !value.games.includes(game)
  )
    return false;
  if (value.styles?.length && !value.styles.includes(style(row))) return false;
  const sat = satellite(row);
  if (value.format.length === 1 && sat !== null && (value.format[0] === 'sats') !== sat)
    return false;
  const price = cash ? number(row.big_blind) : number(row.buy_in_amount) + number(row.buy_in_fee);
  if (value.selectedRanges?.length) {
    if (
      !spec.range.presets.some(
        (preset) =>
          value.selectedRanges!.includes(preset.key) && price >= preset.min && price <= preset.max
      )
    )
      return false;
  } else if (
    (value.rangeMin !== spec.range.min || value.rangeMax !== spec.range.max) &&
    (price < value.rangeMin || price > value.rangeMax)
  )
    return false;
  if (spec.seats && (value.seatMin !== spec.seats.min || value.seatMax !== spec.seats.max)) {
    const seats = number(cash ? row.max_players : row.table_size);
    if (seats > 0 && (seats < value.seatMin || seats > value.seatMax)) return false;
  }
  const isGame = cash && Boolean(row.cluster_id);
  const cap = cash
    ? number(row.max_players)
    : ['mtt-v1', 'mtt-v2'].includes(text(row.format_contract))
      ? 0
      : number(row.max_players);
  const taken = isGame
    ? [...allRows.values()]
        .filter(
          (item) =>
            item.cluster_id === row.cluster_id &&
            item.is_deleted !== true &&
            ['waiting', 'running', 'active'].includes(text(item.status).toLowerCase()) &&
            item.lifecycle != null &&
            item.lifecycle !== 'closed'
        )
        .reduce((sum, item) => sum + number(item.current_players), 0)
    : number(row.current_players);
  const status = text(row.status).toUpperCase();
  if (
    value.statuses.length &&
    !value.statuses.some((key) => {
      switch (key) {
        case 'full':
          return !isGame && cap > 0 && taken >= cap;
        case 'empty':
          return taken === 0;
        case 'open':
          return isGame || (cap > 0 && taken < cap);
        case 'running':
          return ['RUNNING', 'IN_PROGRESS'].includes(status);
        case 'open_reg':
          return ['REGISTERING', 'OPEN', 'PENDING'].includes(status);
        case 'late_reg':
          return lateOpen(row);
        case 'starting_soon':
          return (
            ['REGISTERING', 'OPEN', 'PENDING'].includes(status) &&
            Date.parse(text(row.start_time)) <= Date.now() + 3600000
          );
        default:
          throw new Error(`Missing independent status oracle: ${key}`);
      }
    })
  )
    return false;
  return (
    !value.mustHave.some((key) => feature(row, key, spec, cash) === false) &&
    !value.hide.some((key) => feature(row, key, spec, cash) === true)
  );
}

async function assertLobbyControlsInsidePaint(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  const families = await page.locator('.lobby-game-sections__button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const box = button.getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    })
  );
  expect(families).toHaveLength(2);
  expect(Math.abs(families[0].top - families[1].top)).toBeLessThan(1);
  expect(families[1].left).toBeGreaterThan(families[0].left + families[0].width);
  for (const family of families) expect(Math.abs(family.width - family.height)).toBeLessThan(1);
  await expect
    .poll(
      () =>
        page
          .locator(
            '.lobby-game-sections__button:visible, #lobby-game-section-controls .game-bar__type:visible, #lobby-game-section-controls .quickprefs__chip:visible, #lobby-game-section-controls .game-bar__filter-btn:visible, .lobby-sticky-filters > button:visible'
          )
          .evaluateAll((buttons) =>
            buttons.flatMap((button) => {
              const square = button.classList.contains('lobby-game-sections__button');
              const box = button.getBoundingClientRect();
              const ratio = square ? 1105 / 1133 : 3;
              const width = Math.min(box.width, box.height * ratio);
              const height = width / ratio;
              const left = box.left + (box.width - width) / 2;
              const top = box.top + (box.height - height) / 2;
              const face = square
                ? {
                    left: left + (width * 194) / 1105,
                    right: left + (width * 910) / 1105,
                    top: top + (height * 193) / 1133,
                    bottom: top + (height * 915) / 1133,
                  }
                : {
                    left: left + width * 0.12,
                    right: left + width * 0.88,
                    top: top + height * 0.22,
                    bottom: top + height * 0.76,
                  };
              const label = button.querySelector(
                square ? '.lobby-game-sections__well > span' : '.lobby-filter-label__text'
              );
              if (!label) return [{ text: button.textContent, missingLabel: true }];
              const range = document.createRange();
              range.selectNodeContents(label);
              const outside = [...range.getClientRects()].some(
                (rect) =>
                  rect.left < face.left - 1 ||
                  rect.right > face.right + 1 ||
                  rect.top < face.top - 1 ||
                  rect.bottom > face.bottom + 1
              );
              const wrongFrame =
                !square &&
                !getComputedStyle(button).backgroundImage.includes(
                  'chrome-arena-controls-v1/filter-plate.png'
                );
              return outside || wrongFrame
                ? [{ text: label.textContent, face, outside, wrongFrame }]
                : [];
            })
          ),
      {
        message: 'Every control label must fit its actual native painted face on phone and desktop',
      }
    )
    .toEqual([]);
}

/** The native lower glass is measured from the approved master, not the text wrapper. */
async function assertRegistrationInkInsideFrame(page: Page) {
  const copy = await page
    .locator(
      '.has-premium-chassis .lt-tournament-heading__name, .has-premium-chassis .lt-tournament-heading__guarantee, .has-premium-chassis .lt-name__table, .has-premium-chassis .premium-cash-style, .has-premium-chassis .compact-lobby__meta'
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => element.getBoundingClientRect().width && element.textContent?.trim())
        .map((element) => ({ text: element.textContent, color: getComputedStyle(element).color }))
    );
  expect(copy.length, 'The actual lobby must expose game titles or descriptions').toBeGreaterThan(
    0
  );
  expect(copy.filter((item) => item.color !== 'rgb(255, 255, 255)')).toEqual([]);
  await expect
    .poll(
      () =>
        page.locator('tr[data-kind][data-id]:visible').evaluateAll((rows) =>
          rows.flatMap((row) => {
            const frame = row.getBoundingClientRect();
            const minimum = frame.top + frame.width * 0.003 - 1;
            const maximum = frame.top + frame.width * 0.102 + 1;
            return [...row.querySelectorAll('.lt-status,.lt-name__phase')].flatMap((label) => {
              const box = label.getBoundingClientRect();
              if (!box.width || !box.height) return [];
              const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
              const failures: unknown[] = [];
              while (walker.nextNode()) {
                if (!walker.currentNode.textContent?.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(walker.currentNode);
                for (const ink of range.getClientRects()) {
                  if (ink.top < minimum || ink.bottom > maximum)
                    failures.push({
                      id: row.getAttribute('data-id'),
                      text: label.textContent,
                      top: ink.top - frame.top,
                      bottom: ink.bottom - frame.top,
                      minimum: minimum - frame.top,
                      maximum: maximum - frame.top,
                    });
                }
              }
              return failures;
            });
          })
        ),
      { message: 'Registration labels and exact dates must stay inside the native chrome frame' }
    )
    .toEqual([]);
}

async function assertSort(page: Page, type: Tab | 'ALL', sort: string, raw: Map<string, Row>) {
  const cash = CASH.has(type) || type === 'ALL';
  const effective =
    sort === 'recommended'
      ? cash
        ? type === 'ALL'
          ? 'stakes_high'
          : 'stakes_low'
        : type === 'MTT'
          ? 'phase'
          : 'tournament-recommended'
      : sort;
  await expect
    .poll(
      async () => {
        const actual = await page
          .locator('[data-testid="lobby-game-row"][data-id]:visible')
          .evaluateAll((elements) =>
            elements.map((element) => ({
              id: element.getAttribute('data-id')!,
              status: element.getAttribute('data-status') || '',
              kind: element.getAttribute('data-kind') || '',
              pinned: element.matches('.is-featured'),
              favorite: Boolean(
                element.querySelector('button[aria-label="Remove From Favorites"]')
              ),
            }))
          );
        const groups = new Map<string, number[][]>();
        for (const item of actual) {
          if (type !== 'ALL' && (item.pinned || item.favorite)) continue;
          if (type === 'ALL' && item.kind !== 'cash') return ['Unexpected Non-Cash ALL Row'];
          const row = raw.get(item.id);
          if (!row) return ['Missing Raw Row'];
          let clusterPlayers = row.cluster_id
            ? [...raw.values()]
                .filter(
                  (candidate) =>
                    candidate.cluster_id === row.cluster_id &&
                    candidate.is_deleted !== true &&
                    ['waiting', 'running', 'active'].includes(
                      text(candidate.status).toLowerCase()
                    ) &&
                    candidate.lifecycle != null &&
                    candidate.lifecycle !== 'closed'
                )
                .reduce((sum, candidate) => sum + number(candidate.current_players), 0)
            : number(row.current_players);
          if (
            ['lightning', 'pending_off', 'draining'].includes(text(row.cluster_mode)) &&
            row.proof_pool_players != null &&
            !['plo8', 'flo8', 'short_deck', 'pineapple'].includes(variant(row, true))
          )
            clusterPlayers = number(row.proof_pool_players);
          const cap = number(row.max_players);
          const gone =
            !cash &&
            ((!['mtt-v1', 'mtt-v2'].includes(text(row.format_contract)) &&
              (number(row.current_players) >= cap ||
                ['RUNNING', 'IN_PROGRESS'].includes(text(row.status).toUpperCase()))) ||
              text(row.status).toUpperCase() === 'BAGGED');
          const group =
            type === 'ALL'
              ? 'all-cash'
              : cash
                ? !['stakes_low', 'stakes_high'].includes(effective)
                  ? `${variant(row, true)}:${clusterPlayers === 0}`
                  : 'cash-price'
                : String(gone);
          const price = cash
            ? number(row.big_blind) * (/^(flh|flo8)$/.test(variant(row, true)) ? 2 : 1)
            : number(row.buy_in_amount) + number(row.buy_in_fee);
          const start = Date.parse(text(row.start_time));
          const scheduledStart =
            type === 'SATELLITE' &&
            (row.format_contract === 'seat-first-satellite-v1' ||
              row.format_contract === 'spin-v1' ||
              (row.format_contract === 'sng-v1' && number(row.max_players) === 2))
              ? Infinity
              : Date.parse(text(row.start_time));
          const phase = lateOpen(row)
            ? 0
            : ['REGISTERING', 'OPEN', 'PENDING'].includes(text(row.status).toUpperCase())
              ? start <= Date.now() + 3600000
                ? 1
                : 2
              : 3;
          const state = text(row.status).toUpperCase();
          const statusRank = [
            'REGISTERING',
            'OPEN',
            'PENDING',
            'ANNOUNCED',
            'LATE_REG',
            'LATE_REGISTRATION',
          ].includes(state)
            ? 0
            : ['RUNNING', 'IN_PROGRESS', 'BAGGED'].includes(state)
              ? 1
              : 2;
          const enterable =
            ['ANNOUNCED', 'REGISTERING', 'STARTING_SOON'].includes(state) ||
            (['RUNNING', 'LATE_REG', 'LATE_REGISTRATION'].includes(state) && lateOpen(row));
          const statusValue =
            (
              {
                open: 0,
                late_reg: 0,
                starting_soon: 1,
                registering: 2,
                running: 4,
                waitlist: 5,
                full: 6,
                closed: 7,
                completed: 8,
              } as Record<string, number>
            )[item.status] ?? 9;
          const value = effective.startsWith('status_')
            ? [statusValue * (effective === 'status_desc' ? -1 : 1)]
            : effective === 'players_asc'
              ? [clusterPlayers]
              : effective === 'phase'
                ? [phase, start]
                : effective === 'tournament-recommended'
                  ? [statusRank, start, -price, -clusterPlayers]
                  : effective === 'starting_soon'
                    ? [enterable ? 0 : 1, scheduledStart, -price, -clusterPlayers]
                    : [
                        effective === 'players'
                          ? -clusterPlayers
                          : effective === 'stakes_high'
                            ? -price
                            : price,
                      ];
          const values = groups.get(group) || [];
          values.push(type === 'ALL' ? [Number(clusterPlayers === 0), ...value] : value);
          groups.set(group, values);
        }
        return [...groups.entries()].flatMap(([group, values]) =>
          values.slice(1).flatMap((value, i) => {
            const prior = values[i];
            const changed = value.findIndex((number, index) => number !== prior[index]);
            return changed >= 0 && value[changed] < prior[changed] ? [{ group, prior, value }] : [];
          })
        );
      },
      {
        message: `${type}/${sort} must reorder actual values within its pin and availability rules`,
      }
    )
    .toEqual([]);
}

async function setup(page: Page) {
  const setupStarted = Date.now();
  expect(
    /^ca-customization-cert-.*@example\.invalid$/.test(process.env.SP_EMAIL || ''),
    'Only the isolated certificate identity may run this journey'
  ).toBe(true);
  page.setDefaultTimeout(10_000);
  actionTimelines.set(page, []);
  const participation: string[] = [];
  await page.route(
    /\/(?:action|leave|post-bb|buyin|addchips|rebuy|cashout|sitout|seat-move|seat-change|rest\/v1\/(?:table_seats|tournament_players|wallet_transactions|rpc\/(?:fn_cash_game_join|atomic_table_buyin|fn_lightning_join|fn_lightning_buy_in|fn_take_seat_and_buy_in|fn_register_for_tournament|fn_unregister_from_tournament|fn_leave_seat_and_refund|atomic_table_rebuy|process_tournament_rebuy|fn_join_waitlist)))(?:[/?#]|$)/,
    async (route) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      participation.push(new URL(route.request().url()).pathname);
      await route.abort('blockedbyclient');
    }
  );
  const rawRows = new Map<string, Row>();
  diagnosticRows.set(page, rawRows);
  const reads: Promise<void>[] = [];
  const observerErrors: { source: string; message: string }[] = [];
  const lifecycleWitnesses: unknown[] = [];
  const observe = (source: string, work: Promise<void>) => {
    reads.push(
      work.catch((error: unknown) => {
        observerErrors.push({
          source,
          message: error instanceof Error ? error.message : String(error),
        });
      })
    );
  };
  const saves: Record<string, unknown>[] = [];
  const pools = new Map<string, { eligible?: number; players?: number }>();
  const accept = (rows: unknown, boardCensus = false) => {
    if (!Array.isArray(rows)) return;
    for (const value of rows) {
      const row = object(value);
      if (typeof row.id === 'string') {
        const cluster = object(row.cluster);
        rawRows.set(row.id, {
          ...rawRows.get(row.id),
          ...row,
          id: row.id,
          ...(boardCensus ? { proof_board_census: true } : {}),
          ...(cluster.template_name !== undefined
            ? { cluster_template: cluster.template_name }
            : {}),
          ...(cluster.cluster_mode !== undefined ? { cluster_mode: cluster.cluster_mode } : {}),
          proof_pool_players:
            pools.get(text(row.cluster_id))?.players ?? pools.get(text(row.cluster_id))?.eligible,
        });
      }
    }
  };
  // Realtime is an independent raw source too: occupancy/status may change
  // while the player works through the controls. Never compare a fresh board
  // with an obsolete first-load census.
  page.on('websocket', (socket) =>
    socket.on('framereceived', (frame) => {
      try {
        const visit = (value: unknown): void => {
          if (Array.isArray(value)) {
            value.forEach(visit);
            return;
          }
          const data = object(value);
          if (
            typeof data.id === 'string' &&
            rawRows.has(data.id) &&
            ('current_players' in data ||
              'status' in data ||
              'game_variant' in data ||
              'game_type' in data)
          )
            accept([data]);
          for (const field of ['payload', 'data', 'record', 'new', 'records'])
            if (data[field] !== undefined) visit(data[field]);
        };
        visit(
          JSON.parse(
            typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8')
          )
        );
      } catch {
        /* Other transport frames are not lobby row records. */
      }
    })
  );
  const readBody = async (response: import('@playwright/test').Response): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        response.json(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Source response body exceeded 10s')), 10_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const responded = (response: import('@playwright/test').Response) => {
    try {
      const url = new URL(response.url());
      if (!response.ok()) return;
      if (/\/(?:fn_cash_game_lobby|fn_lightning_pool_status)$/.test(url.pathname)) {
        const request = object(response.request().postDataJSON());
        const clusterId = text(request.p_game_id || request.p_cluster_id);
        observe(
          url.pathname,
          (async () => {
            const body = object(await readBody(response));
            const pool = pools.get(clusterId) || {};
            if (url.pathname.endsWith('/fn_cash_game_lobby')) {
              const eligible = object(object(body.lightning).verdict).live_eligible;
              if (eligible != null && Number.isFinite(Number(eligible)))
                pool.eligible = Math.floor(Number(eligible));
            } else if (
              ['BUILDING', 'ACTIVE', 'HOT', 'THIN'].includes(text(body.status).toUpperCase()) &&
              body.players != null &&
              Number.isFinite(Number(body.players))
            )
              pool.players = Math.max(0, Math.round(Number(body.players)));
            pools.set(clusterId, pool);
            for (const row of rawRows.values())
              if (row.cluster_id === clusterId)
                row.proof_pool_players = pool.players ?? pool.eligible;
          })()
        );
        return;
      }
      if (url.pathname.endsWith('/user_lobby_filters') && response.request().method() === 'POST') {
        saves.push(object(response.request().postDataJSON()));
        return;
      }
      if (response.request().method() !== 'GET' && !url.pathname.endsWith('/get_club_home')) return;
      if (!/\/(?:tables|tournaments|get_club_home)$/.test(url.pathname)) return;
      observe(
        url.pathname,
        (async () => {
          const body = await readBody(response);
          // Admit scope from the independent source request, never from
          // the displayed IDs. Union/sibling rows remain in their real census.
          const queryScope = [url.searchParams.get('or'), url.searchParams.get('club_id')].some(
            (value) => value?.includes(CLUB_ID)
          );
          const homeScope =
            url.pathname.endsWith('/get_club_home') &&
            object(response.request().postDataJSON()).p_club_key === CLUB_ID;
          const boardCensus = queryScope || homeScope;
          if (Array.isArray(body)) accept(body, boardCensus);
          else {
            accept(body.tables, boardCensus);
            accept(body.tournaments, boardCensus);
          }
        })()
      );
    } catch (error) {
      observerErrors.push({
        source: new URL(response.url()).pathname,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  page.on('response', responded);
  const finish = async () => {
    page.off('response', responded);
    await Promise.all(reads);
  };
  observationHandles.set(page, { finish, errors: observerErrors, witnesses: lifecycleWitnesses });
  const offer = diamondEntryRead(page);
  await page.goto(`clubs/${CLUB_ID}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await prepareCashLobbyActions(page);
  await expect(page.getByRole('button', { name: 'Cash Games', exact: true })).toBeVisible({
    timeout: 45000,
  });
  await settleDiamondSpinsOffer(page, offer);
  expect(page.url()).not.toMatch(/\/auth\//);
  const owner = await readLobbyPreferenceOwner(page);
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const publishableKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey || !process.env.SP_PASS)
    throw new Error('Configured public client and isolated account authentication are required');
  const client = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const login = await client.auth.signInWithPassword({
    email: process.env.SP_EMAIL!,
    password: process.env.SP_PASS,
  });
  if (login.error || login.data.user?.id !== owner)
    throw new Error(
      'Independent lifecycle reader did not authenticate as the isolated browser owner'
    );
  const refreshLifecycle = async (ids: string[]) => {
    if (!ids.length) return;
    expect(ids.every((id) => /^[0-9a-f-]{36}$/i.test(id))).toBe(true);
    const fields = [
      'id',
      'status',
      'current_players',
      'max_players',
      'table_size',
      'game_type',
      'variant',
      'start_time',
      'started_at',
      'format_contract',
    ];
    const before = ids.map((id) =>
      Object.fromEntries(fields.map((key) => [key, rawRows.get(id)?.[key]]))
    );
    // Read terminal rows too. The app's active-status list legitimately omits them;
    // omission alone never proves deletion or the lifecycle we should expect.
    const { data, error } = await client
      .from('tournaments')
      .select(fields.join(','))
      .in('id', ids)
      .abortSignal(AbortSignal.timeout(10_000));
    if (error || !Array.isArray(data)) {
      observerErrors.push({
        source: 'independent-tournament-lifecycle',
        message: error?.message || 'missing rows',
      });
      throw new Error(`Independent lifecycle read failed: ${error?.message || 'missing rows'}`);
    }
    const rows = data as unknown as Row[];
    lifecycleWitnesses.push({ observedAt: new Date().toISOString(), ids, before, after: rows });
    expect(
      sorted(rows.map((row) => row.id)),
      'Every disputed lifecycle must be independently readable'
    ).toEqual(sorted(ids));
    accept(rows);
  };
  const cache = `ca_advanced_filters_${owner}:${CLUB_ID}`;
  const viewCache = `ca_lobby_view_${owner}:${CLUB_ID}`;
  const rows = page.locator('[data-testid="lobby-game-row"][data-id]:visible');
  const ids = () =>
    rows.evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id')!));
  const state = async (type: Tab): Promise<GameFilterValue> =>
    page.evaluate(({ cache, type }) => JSON.parse(localStorage.getItem(cache) || '{}')[type], {
      cache,
      type,
    });
  const view = () =>
    page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), viewCache);
  const choose = async (type: Tab | 'ALL') => {
    const family = CASH.has(type) || type === 'ALL' ? 'Cash Games' : 'Tournaments';
    const familyButton = page.getByRole('button', { name: family, exact: true });
    if ((await familyButton.getAttribute('aria-expanded')) !== 'true')
      await clickControl(familyButton);
    const tab = page
      .getByRole('tablist', { name: 'Game Type', exact: true })
      .getByRole('tab', { name: type === 'ALL' ? 'ALL' : LABEL[type], exact: true });
    await clickControl(tab);
    await expect(tab).toHaveAttribute('aria-selected', 'true');
  };
  const open = async () => {
    await clickControl(page.getByRole('button', { name: 'Open Sticky Filters', exact: true }));
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    return sheet;
  };
  actionTimelines.get(page)?.push({ control: 'setup', elapsedMs: Date.now() - setupStarted });
  return {
    rawRows,
    reads,
    observerErrors,
    lifecycleWitnesses,
    refreshLifecycle,
    finish,
    saves,
    participation,
    owner,
    cache,
    viewCache,
    rows,
    ids,
    state,
    view,
    choose,
    open,
  };
}

for (const type of TYPES) {
  test(`every ${type} lobby filter matches live rows and persists`, async ({ page }, testInfo) => {
    const h = await test.step('Authenticated Lobby Setup', () => setup(page));
    const spec = FILTER_SPECS[type];
    const cash = CASH.has(type);
    await h.choose(type);
    let sheet = await h.open();
    await clickControl(sheet.getByRole('button', { name: /^Reset / }));
    if (type === 'MTT')
      await clickControl(sheet.getByRole('button', { name: 'Include Satellites', exact: true }));
    await expect.poll(async () => Boolean(await h.state(type))).toBe(true);
    await Promise.all(h.reads);
    await expect
      .poll(async () => (await h.ids()).length, {
        message: `${type} needs a real live baseline cohort`,
      })
      .toBeGreaterThan(0);
    const baseline = await h.ids();
    const unrestricted = await h.state(type);
    expect(unrestricted.statuses).toEqual([]);
    expect(unrestricted.mustHave).toEqual([]);
    expect(unrestricted.hide).toEqual([]);
    expect(unrestricted.format).toEqual([]);
    expect(unrestricted.styles).toEqual([]);
    expect(unrestricted.selectedRanges).toEqual([]);
    expect([unrestricted.rangeMin, unrestricted.rangeMax]).toEqual([
      spec.range.min,
      spec.range.max,
    ]);
    expect([unrestricted.seatMin, unrestricted.seatMax]).toEqual([
      spec.seats?.min ?? 3,
      spec.seats?.max ?? 3,
    ]);
    expect(unrestricted.games).toEqual(type === 'MTT' ? spec.games!.map((item) => item.key) : []);
    expect(
      baseline.every((id) => h.rawRows.has(id)),
      'Every baseline row must have an actual source response'
    ).toBe(true);
    if (!cash) {
      expect(
        baseline.every((id) => belongsToObservedFamily(h.rawRows.get(id)!, type)),
        'The baseline must independently belong to the scoped source census and selected family'
      ).toBe(true);
    }
    const evidence: unknown[] = [];
    const currentCohort = () =>
      cash
        ? baseline
        : [...h.rawRows.values()]
            .filter((row) => belongsToObservedFamily(row, type))
            .map((row) => row.id);
    const check = async (control: string) => {
      const value = await h.state(type);
      expect(value, `${control}: saved account-scoped state`).toBeTruthy();
      let matched: { expected: string[]; actual: string[] } | undefined;
      const started = Date.now();
      let refreshed = false;
      let mismatchSamples = 0;
      const membership: Record<string, unknown> = { kind: 'membership', control, started, value };
      actionTimelines.get(page)?.push(membership);
      persistProgress(page);
      await test.step(`${type}/${control}`, async () => {
        try {
          await expect
            .poll(
              async () => {
                let actual = sorted(await h.ids());
                let expected = sorted(
                  currentCohort().filter((id) =>
                    independentMatch(h.rawRows.get(id)!, value, spec, cash, h.rawRows)
                  )
                );
                if (
                  !cash &&
                  !refreshed &&
                  JSON.stringify(actual) !== JSON.stringify(expected) &&
                  ++mismatchSamples >= 2
                ) {
                  refreshed = true;
                  const disputed = [
                    ...new Set([
                      ...actual.filter((id) => !expected.includes(id)),
                      ...expected.filter((id) => !actual.includes(id)),
                    ]),
                  ];
                  await h.refreshLifecycle(disputed);
                  actual = sorted(await h.ids());
                  expected = sorted(
                    currentCohort().filter((id) =>
                      independentMatch(h.rawRows.get(id)!, value, spec, cash, h.rawRows)
                    )
                  );
                }
                matched = { actual, expected };
                membership.latest = matched;
                persistProgress(page);
                return JSON.stringify(actual) === JSON.stringify(expected)
                  ? []
                  : [{ actual, expected }];
              },
              {
                message: `${type}: ${control} must produce exactly the independently matched live rows`,
              }
            )
            .toEqual([]);
        } finally {
          membership.elapsedMs = Date.now() - started;
          persistProgress(page);
          evidence.push({ control, elapsedMs: Date.now() - started, value, ...matched });
        }
      });
    };
    const section = (title: string) =>
      sheet
        .locator('details')
        .filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    const toggleEvery = async (
      title: string,
      items: { key: string; label: string }[],
      field: keyof GameFilterValue
    ) => {
      const area = section(title);
      for (const item of items) {
        const button = area.getByRole('button', { name: item.label, exact: true });
        await expect(button).toBeVisible();
        const before = (await button.getAttribute('aria-pressed')) === 'true';
        for (const on of [!before, before]) {
          await clickControl(button);
          await expect(button).toHaveAttribute('aria-pressed', String(on));
          // The off branch requires actual absence, not another button's colour.
          expect(((await h.state(type))[field] as string[]).includes(item.key)).toBe(on);
          await check(`${title}/${item.key}/${on}`);
        }
      }
    };
    const union = async (
      title: string,
      items: { key: string; label: string }[],
      field: 'games' | 'format' | 'styles' | 'statuses'
    ) => {
      if (items.length < 2) return;
      const original = (await h.state(type))[field] || [];
      const area = section(title);
      for (const [index, item] of items.entries()) {
        const button = area.getByRole('button', { name: item.label, exact: true });
        if (((await button.getAttribute('aria-pressed')) === 'true') !== index < 2)
          await clickControl(button);
      }
      await check(`${field}/two-choice-union`);
      for (const item of items) {
        const button = area.getByRole('button', { name: item.label, exact: true });
        if (
          ((await button.getAttribute('aria-pressed')) === 'true') !==
          original.includes(item.key)
        )
          await clickControl(button);
      }
      await check(`${field}/union-restored`);
    };
    try {
      await check('baseline');
      await assertRegistrationInkInsideFrame(page);
      const availability = await h.rows.evaluateAll((elements) =>
        elements
          .filter(
            (element) =>
              element.getAttribute('data-status') === 'open' ||
              (['spin', 'sng'].includes(element.getAttribute('data-kind') || '') &&
                element.getAttribute('data-status') === 'registering')
          )
          .map((element) => element.querySelector('.lt-status')?.textContent?.trim())
      );
      for (const label of availability) expect(label).toBe('Seats Available');
      evidence.push({ control: 'registration-labels', availability });
      if (type === 'MTT') {
        const include = sheet.getByRole('button', { name: 'Include Satellites', exact: true });
        await clickControl(include);
        await expect(include).toHaveAttribute('aria-pressed', 'false');
        await check('satellites/excluded');
        await clickControl(include);
        await expect(include).toHaveAttribute('aria-pressed', 'true');
        await check('satellites/included');
      }
      if (spec.games) await toggleEvery('Games', spec.games, 'games');
      if (spec.format) await toggleEvery('Format', spec.format, 'format');
      if (spec.styles) await toggleEvery('Game Style', spec.styles, 'styles');
      if (spec.games) await union('Games', spec.games, 'games');
      if (spec.format) await union('Format', spec.format, 'format');
      if (spec.styles) await union('Game Style', spec.styles, 'styles');
      const priceArea = sheet
        .locator('details')
        .filter({ has: page.getByRole('heading', { name: new RegExp(`^${spec.range.label} ·`) }) });
      for (const preset of spec.range.presets) {
        const button = priceArea.getByRole('button', { name: preset.label, exact: true });
        await clickControl(button);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await check(`price/${preset.key}/on`);
        await clickControl(button);
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await check(`price/${preset.key}/off`);
      }
      // Nonadjacent presets are a union; moving a thumb clears that union.
      await clickControl(
        priceArea.getByRole('button', { name: spec.range.presets[0].label, exact: true })
      );
      await clickControl(
        priceArea.getByRole('button', { name: spec.range.presets[3].label, exact: true })
      );
      await check('price/nonadjacent-union');
      const min = sheet.getByRole('slider', { name: `Minimum ${spec.range.label}`, exact: true });
      const max = sheet.getByRole('slider', { name: `Maximum ${spec.range.label}`, exact: true });
      await min.press('Home');
      await min.press('ArrowRight');
      const step = spec.range.min > 0 && spec.range.min < 1 ? 0.01 : 1;
      expect((await h.state(type)).rangeMin).toBeCloseTo(spec.range.min + step, 6);
      expect((await h.state(type)).selectedRanges).toEqual([]);
      await check('price/minimum-keyboard');
      await max.press('Home');
      expect((await h.state(type)).rangeMax).toBeCloseTo(spec.range.min + step * 2, 6);
      await check('price/maximum-clamped-keyboard');
      await min.press('Home');
      await max.press('End');
      await check('price/restored');
      const seatsArea = sheet
        .locator('details')
        .filter({ has: page.getByRole('heading', { name: /^Table Size/ }) });
      await toggleEvery(
        (await seatsArea.getByRole('heading').textContent())!,
        spec.statuses,
        'statuses'
      );
      await union((await seatsArea.getByRole('heading').textContent())!, spec.statuses, 'statuses');
      if (spec.seats) {
        const minimum = sheet.getByRole('slider', { name: 'Minimum Seats', exact: true });
        const maximum = sheet.getByRole('slider', { name: 'Maximum Seats', exact: true });
        await minimum.press('Home');
        await minimum.press('ArrowRight');
        expect((await h.state(type)).seatMin).toBe(spec.seats.min + 1);
        await check('seats/minimum-keyboard');
        await maximum.press('Home');
        expect((await h.state(type)).seatMax).toBe(spec.seats.min + 2);
        await check('seats/maximum-clamped-keyboard');
        await minimum.press('Home');
        await maximum.press('End');
        await check('seats/restored');
      } else await expect(sheet.getByRole('slider', { name: /Seats$/ })).toHaveCount(0);
      for (const name of ['Required Features', 'Exclude Features']) {
        const area = section(name);
        if (await area.count()) await clickControl(area.locator('summary'));
      }
      const shown = spec.features.filter((item) => !item.capability);
      const gated = spec.features.filter((item) => item.capability);
      for (const item of gated)
        if (
          await section('Required Features')
            .getByRole('button', { name: item.label, exact: true })
            .count()
        )
          shown.push(item);
      for (const item of shown) {
        const required = section('Required Features').getByRole('button', {
          name: item.label,
          exact: true,
        });
        const excluded = section('Exclude Features').getByRole('button', {
          name: item.label,
          exact: true,
        });
        const prior = await h.state(type);
        await clickControl(required);
        await expect(required).toHaveAttribute('aria-pressed', 'true');
        await expect(excluded).toHaveAttribute('aria-pressed', 'false');
        await check(`required/${item.key}`);
        await clickControl(excluded);
        await expect(excluded).toHaveAttribute('aria-pressed', 'true');
        await expect(required).toHaveAttribute('aria-pressed', 'false');
        await check(`excluded/${item.key}/mutual-exclusion`);
        await clickControl(excluded);
        await expect(excluded).toHaveAttribute('aria-pressed', 'false');
        await check(`excluded/${item.key}/off`);
        expect((await h.state(type)).mustHave).toEqual(
          prior.mustHave.filter((key) => key !== item.key)
        );
      }
      evidence.push({
        control: 'capability-gated-catalogue',
        shownFeatures: shown.map((item) => item.key),
        unavailableControls: gated.filter((item) => !shown.includes(item)).map((item) => item.key),
      });
      if (shown.length >= 2) {
        for (const item of shown.slice(0, 2))
          await clickControl(
            section('Required Features').getByRole('button', { name: item.label, exact: true })
          );
        await check('features/required-intersection');
        for (const item of shown.slice(0, 2))
          await clickControl(
            section('Exclude Features').getByRole('button', { name: item.label, exact: true })
          );
        await check('features/excluded-union');
        for (const item of shown.slice(0, 2))
          await clickControl(
            section('Exclude Features').getByRole('button', { name: item.label, exact: true })
          );
        await check('features/restored');
      }
      // Every accordion is independently operable; closing it cannot reset filters.
      for (const details of await sheet.locator('details').all()) {
        const value = await h.state(type);
        const summary = details.locator('summary');
        await clickControl(summary);
        await expect(details).not.toHaveAttribute('open');
        expect(await h.state(type)).toEqual(value);
        await clickControl(summary);
        await expect(details).toHaveAttribute('open', '');
      }
      for (const [key, label] of SORTS.filter(
        ([key]) => !(cash || type === 'SPIN' || type === 'SNG') || key !== 'starting_soon'
      )) {
        const button = section('Sort The Board').getByRole('button', { name: label, exact: true });
        await clickControl(button);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(async () => (await h.view()).sortByTab?.[type]).toBe(key);
        await check(`sort/${key}`);
        await assertSort(page, type, key, h.rawRows);
      }
      // The original quick controls and sheet must write the very same statuses.
      await clickControl(sheet.getByRole('button', { name: 'Close Game Filters', exact: true }));
      const quick = page.locator('.lobby-refinements');
      for (const item of spec.statuses) {
        const button = quick.getByRole('button', { name: item.label, exact: true });
        await clickControl(button);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await check(`quick/${item.key}/on`);
        await clickControl(button);
        await expect(button).toHaveAttribute('aria-pressed', 'false');
        await check(`quick/${item.key}/off`);
      }
      const all = quick.getByRole('button', { name: 'All', exact: true });
      await clickControl(quick.getByRole('button', { name: spec.statuses[0].label, exact: true }));
      await clickControl(all);
      await expect(all).toHaveAttribute('aria-pressed', 'true');
      expect((await h.state(type)).statuses).toEqual([]);
      await check('quick/all');
      const headings = page.locator('.compact-lobby:visible thead');
      await expect(headings.getByRole('button', { name: /^Game$/ })).toHaveCount(0);
      for (const [pattern, key] of [
        [cash ? /^Stakes/ : /^Buy-In/, 'price'],
        [/^Players/, 'players'],
        [/^Status/, 'status'],
      ] as const) {
        const button = headings.getByRole('button', { name: pattern });
        for (let click = 0; click < 2; click++) {
          await clickControl(button);
          const direction = await button.locator('..').getAttribute('aria-sort');
          expect(['ascending', 'descending']).toContain(direction);
          await assertSort(
            page,
            type,
            key === 'price'
              ? direction === 'ascending'
                ? 'stakes_low'
                : 'stakes_high'
              : key === 'players'
                ? direction === 'ascending'
                  ? 'players_asc'
                  : 'players'
                : direction === 'ascending'
                  ? 'status_asc'
                  : 'status_desc',
            h.rawRows
          );
          await expect(page.getByRole('menu')).toHaveCount(0);
        }
      }
      // A combined choice survives closing, an actual acknowledged remote write
      // and a completely new document. No environment-storage injection is used.
      sheet = await h.open();
      await clickControl(sheet.getByRole('button', { name: /^Reset / }));
      const combined = sheet.getByRole('button', { name: 'Small', exact: true });
      await clickControl(combined);
      if (spec.games) {
        const games = section('Games');
        for (const [index, item] of spec.games.entries()) {
          const button = games.getByRole('button', { name: item.label, exact: true });
          if (((await button.getAttribute('aria-pressed')) === 'true') !== (index === 0))
            await clickControl(button);
        }
        expect((await h.state(type)).games).toEqual([spec.games[0].key]);
      }
      await check('combined-game-and-price');
      const saved = await h.state(type);
      await clickControl(sheet.getByRole('button', { name: /^Apply .*Filters$/ }));
      await expect(sheet).toBeHidden();
      await expect
        .poll(
          () =>
            h.saves.some(
              (save) =>
                save.user_id === h.owner &&
                save.club_id === CLUB_ID &&
                JSON.stringify(object(save.filters)[type]) === JSON.stringify(saved)
            ),
          { timeout: 15000 }
        )
        .toBe(true);
      const readback = page.waitForResponse(
        (response) =>
          response.ok() &&
          response.request().method() === 'GET' &&
          new URL(response.url()).pathname.endsWith('/user_lobby_filters') &&
          new URL(response.url()).searchParams.get('user_id') === `eq.${h.owner}` &&
          new URL(response.url()).searchParams.get('club_id') === `eq.${CLUB_ID}` &&
          new URL(response.url()).searchParams.get('select')?.split(',').includes('filters') ===
            true
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      const remote = await (await readback).json();
      expect(object(Array.isArray(remote) ? remote[0] : remote).filters).toBeTruthy();
      expect(object(object(Array.isArray(remote) ? remote[0] : remote).filters)[type]).toEqual(
        saved
      );
      await prepareCashLobbyActions(page);
      await h.choose(type);
      sheet = await h.open();
      expect(await h.state(type)).toEqual(saved);
      await check('combined-game-and-price-after-reload');
      await expect(sheet.getByRole('button', { name: 'Small', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      // Reset affects this tab only, and the close button saves that reset.
      const otherTabs = await page.evaluate(
        ({ cache, type }) =>
          Object.fromEntries(
            Object.entries(JSON.parse(localStorage.getItem(cache) || '{}')).filter(
              ([key]) => key !== type
            )
          ),
        { cache: h.cache, type }
      );
      await clickControl(sheet.getByRole('button', { name: /^Reset / }));
      expect(
        await page.evaluate(
          ({ cache, type }) =>
            Object.fromEntries(
              Object.entries(JSON.parse(localStorage.getItem(cache) || '{}')).filter(
                ([key]) => key !== type
              )
            ),
          { cache: h.cache, type }
        )
      ).toEqual(otherTabs);
      await clickControl(sheet.getByRole('button', { name: 'Close Game Filters', exact: true }));
      expect(h.participation).toEqual([]);
    } finally {
      await testInfo.attach(`filter-audit-${type}.json`, {
        body: Buffer.from(
          JSON.stringify({
            type,
            baseline,
            controls: evidence,
            lifecycleWitnesses: h.lifecycleWitnesses,
            observerErrors: h.observerErrors,
            actions: actionTimelines.get(page),
            participation: h.participation,
          })
        ),
        contentType: 'application/json',
      });
    }
  });
}

test('sticky lobby controls and cross-tab sorting remain accessible and durable', async ({
  page,
}, testInfo) => {
  const h = await test.step('Authenticated Lobby Setup', () => setup(page));
  await h.choose('MTT');
  await assertLobbyControlsInsidePaint(page);
  await testInfo.attach('lobby-square-controls-phone.png', {
    body: await page.locator('.lobby-controls').screenshot(),
    contentType: 'image/png',
  });
  let sheet = await h.open();
  await clickControl(sheet.getByRole('button', { name: /^Reset / }));
  await clickControl(sheet.getByRole('button', { name: 'Recommended', exact: true }));
  await clickControl(sheet.getByRole('button', { name: 'Close Game Filters', exact: true }));
  await expect(h.rows.first()).toBeVisible({ timeout: 30000 });
  const baseline = await h.ids();
  expect(baseline.length).toBeGreaterThan(1);
  const rail = page.getByRole('navigation', { name: 'Quick Lobby Filters', exact: true });
  await h.rows.last().scrollIntoViewIfNeeded();
  await expect(rail).toBeInViewport();
  const geometry = await rail.evaluate((element) => ({
    top: element.getBoundingClientRect().top,
    height: element.getBoundingClientRect().height,
    viewport: innerHeight,
    width: element.getBoundingClientRect().width,
    document: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
  }));
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.top + geometry.height).toBeLessThan(geometry.viewport);
  expect(geometry.document).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.height).toBeLessThanOrEqual(60);
  await testInfo.attach('sticky-lobby-phone.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  // Favorites must remain available even after a cash choice carries to MTT.
  const favorites = rail.getByRole('button', { name: 'Favorites', exact: true });
  await clickControl(favorites);
  await expect(favorites).toHaveAttribute('aria-pressed', 'true');
  await expect(h.rows).toHaveCount(0);
  await clickControl(favorites);
  await expect(favorites).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => sorted(await h.ids())).toEqual(sorted(baseline));
  const quickControls = page.locator('.lobby-refinements');
  await expect(quickControls.getByRole('button', { name: 'Favorites', exact: true })).toHaveCount(
    0
  );
  await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toHaveCount(1);
  const quickFilters = quickControls.getByRole('button', { name: 'Filters And Sort', exact: true });
  await clickControl(quickFilters);
  sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await clickControl(sheet.getByRole('button', { name: 'Close Game Filters', exact: true }));
  // The rail returns to the real game controls, rather than opening another popup.
  await clickControl(rail.getByRole('button', { name: 'Browse Game Types', exact: true }));
  await expect(page.locator('#lobby-game-section-controls')).toBeInViewport();
  const filterPlacement = await quickFilters.evaluate((element) => {
    const running = [...element.parentElement!.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Running'
    )!;
    const filterBox = element.getBoundingClientRect();
    const runningBox = running.getBoundingClientRect();
    return {
      sameRow: Math.abs(filterBox.top - runningBox.top) < 1,
      follows: filterBox.left > runningBox.left,
    };
  });
  expect(filterPlacement).toEqual({ sameRow: true, follows: true });
  await testInfo.attach('lobby-quick-filters-phone.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  // Sheet tab changes must select the actual board before saving its sort.
  sheet = await h.open();
  const tabs = sheet.getByRole('group', { name: 'Game Type', exact: true });
  for (const [type, label, sort] of [
    ['SPIN', 'Spins', 'stakes_high'],
    ['SNG', "Sit N Go's", 'stakes_low'],
    ['SATELLITE', 'Satellites', 'players'],
    ['MTT', 'MTT', 'recommended'],
  ] as const) {
    await clickControl(tabs.getByRole('button', { name: label, exact: true }));
    await expect(page.getByRole('tab', { name: LABEL[type], exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await clickControl(
      sheet.getByRole('button', { name: SORTS.find(([key]) => key === sort)![1], exact: true })
    );
    await expect.poll(async () => (await h.view()).sortByTab?.[type]).toBe(sort);
  }
  const retainedView = await h.view();
  expect(retainedView.sortByTab).toMatchObject({
    SPIN: 'stakes_high',
    SNG: 'stakes_low',
    SATELLITE: 'players',
    MTT: 'recommended',
  });
  // Escape, backdrop, close and Apply all preserve deliberately saved edits.
  const include = sheet.getByRole('button', { name: 'Include Satellites', exact: true });
  await clickControl(include);
  const savedMtt = await h.state('MTT');
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  sheet = await h.open();
  expect(await h.state('MTT')).toEqual(savedMtt);
  await page.setViewportSize({ width: 1280, height: 900 });
  await clickControl(page.locator('.afx-overlay'), { position: { x: 1, y: 1 } });
  await expect(sheet).toBeHidden();
  await page.setViewportSize({ width: 393, height: 852 });
  sheet = await h.open();
  expect(await h.state('MTT')).toEqual(savedMtt);
  // Exact scheduled time is a touch control, not a hover-only tooltip.
  await clickControl(sheet.getByRole('button', { name: 'Close Game Filters', exact: true }));
  const exact = page.getByRole('button', { name: 'Show Exact Start Time', exact: true }).first();
  await expect(exact).toBeVisible();
  await clickControl(exact);
  const countdown = page.getByRole('button', { name: 'Show Countdown', exact: true }).first();
  await expect(countdown.locator('time')).toHaveAttribute('datetime', /\d{4}-\d{2}-\d{2}T/);
  await expect(countdown).toContainText(/\d/);
  await assertRegistrationInkInsideFrame(page);
  await testInfo.attach('lobby-exact-start-time-phone.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await clickControl(countdown);
  await expect(exact).toBeVisible();
  const bounty = page
    .locator('tr[data-game-heading][data-kind="mtt"]:has([data-tournament-icon="bounty"])')
    .first();
  await expect(bounty, 'The bounty emblem must be verified on a real event').toBeVisible();
  await bounty.scrollIntoViewIfNeeded();
  const bountyGeometry = await bounty.evaluate((element) => {
    const icon = element.querySelector('[data-tournament-icon="bounty"]')!;
    const title = element.querySelector('.lt-tournament-heading__name')!;
    const frame = element.getBoundingClientRect();
    const emblem = icon.getBoundingClientRect();
    return {
      width: emblem.width / frame.width,
      inside: emblem.top >= frame.top && emblem.bottom <= frame.bottom,
      besideTitle: emblem.right < title.getBoundingClientRect().left,
      filter: getComputedStyle(icon).filter,
    };
  });
  expect(bountyGeometry.width).toBeGreaterThanOrEqual(0.1);
  expect(bountyGeometry.inside && bountyGeometry.besideTitle).toBe(true);
  expect(bountyGeometry.filter).toBe('brightness(1.35)');
  await testInfo.attach('lobby-white-copy-bounty-phone.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  const labelEvidence = await h.rows.evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.getAttribute('data-id')!,
      kind: element.getAttribute('data-kind'),
      state: element.getAttribute('data-status'),
      label: element.querySelector('.lt-status')?.textContent?.trim(),
      phase: element.querySelector('.lt-name__phase')?.textContent?.trim(),
    }))
  );
  for (const item of labelEvidence) {
    const raw = h.rawRows.get(item.id)!;
    expect(item.phase || '').not.toMatch(/Starts In 0:00$/);
    if (item.state === 'open') expect(item.label).toBe('Seats Available');
    if (item.kind === 'mtt' && lateOpen(raw)) expect(item.label).toBe('Late Reg Open');
    if (
      item.kind === 'mtt' &&
      ['RUNNING', 'IN_PROGRESS'].includes(text(raw.status).toUpperCase()) &&
      !lateOpen(raw)
    )
      expect(item.phase).toBe('Registration Closed');
  }
  await expect
    .poll(() =>
      h.rows.evaluateAll((elements) =>
        elements.flatMap((element) =>
          [...element.querySelectorAll('.lt-status,.lt-name__phase')].flatMap((label) => {
            const box = label.getBoundingClientRect();
            if (!box.width || !box.height) return [];
            const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
            const failures: string[] = [];
            while (walker.nextNode()) {
              if (!walker.currentNode.textContent?.trim()) continue;
              const range = document.createRange();
              range.selectNodeContents(walker.currentNode);
              for (const ink of range.getClientRects())
                if (
                  ink.left < box.left - 1 ||
                  ink.right > box.right + 1 ||
                  ink.top < box.top - 1 ||
                  ink.bottom > box.bottom + 1
                )
                  failures.push(`${element.getAttribute('data-id')}:${label.textContent}`);
            }
            return failures;
          })
        )
      )
    )
    .toEqual([]);
  await testInfo.attach('lobby-registration-labels-phone.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  // Long clocks are checked against their real start timestamps whenever the
  // advertised six-day schedule includes one; the boundary itself is unit-pinned.
  const clocks = await h.rows.evaluateAll((elements) =>
    elements
      .filter(
        (element) =>
          Date.parse(element.getAttribute('data-start-time') || '') - Date.now() >= 86400000
      )
      .map((element) => ({
        id: element.getAttribute('data-id'),
        text: element.querySelector('.premium-lobby-clock__value')?.textContent,
      }))
  );
  expect(clocks.length, 'The live future schedule needs a long-countdown witness').toBeGreaterThan(
    0
  );
  for (const clock of clocks) expect(clock.text).toMatch(/^\d+d \d+h$/);
  // Direct heading sorts never reopen the old clipped menu; Game is inert.
  const headings = page.locator('.compact-lobby:visible thead');
  await expect(headings.getByRole('button', { name: /^Game$/ })).toHaveCount(0);
  for (const label of [/^Buy-In/, /^Players/, /^Status/]) {
    const button = headings.getByRole('button', { name: label });
    await clickControl(button);
    const first = await button.locator('..').getAttribute('aria-sort');
    expect(['ascending', 'descending']).toContain(first);
    await clickControl(button);
    await expect(button.locator('..')).toHaveAttribute(
      'aria-sort',
      first === 'ascending' ? 'descending' : 'ascending'
    );
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
  // ALL is a cash-family sort-only sheet, so every displayed choice is meaningful.
  await h.choose('ALL');
  const allBaseline = await h.ids();
  expect(allBaseline.length).toBeGreaterThan(0);
  const quick = page.locator('.lobby-refinements');
  await clickControl(quick.getByRole('button', { name: 'Running', exact: true }));
  await expect(quick.getByRole('button', { name: 'Running', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const expectedRunning = allBaseline.filter((id) =>
    ['RUNNING', 'IN_PROGRESS'].includes(text(h.rawRows.get(id)?.status).toUpperCase())
  );
  await expect.poll(async () => sorted(await h.ids())).toEqual(sorted(expectedRunning));
  await clickControl(quick.getByRole('button', { name: 'All', exact: true }));
  await expect.poll(async () => sorted(await h.ids())).toEqual(sorted(allBaseline));
  sheet = await h.open();
  await expect(sheet).toHaveAttribute('aria-label', 'Sort');
  await expect(sheet.getByRole('group', { name: 'Game Type', exact: true })).toHaveCount(0);
  for (const [key, label] of SORTS.filter(([key]) => key !== 'starting_soon')) {
    const button = sheet.getByRole('button', { name: label, exact: true });
    await clickControl(button);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await h.view()).sortByTab?.ALL).toBe(key);
    // Sorting preserves the complete ALL cash census, rather than certifying
    // only a button colour or whichever subset happened to remain visible.
    await expect.poll(async () => sorted(await h.ids())).toEqual(sorted(allBaseline));
    await assertSort(page, 'ALL', key, h.rawRows);
  }
  await clickControl(sheet.getByRole('button', { name: 'Done', exact: true }));
  await expect(sheet).toBeHidden();
  await h.choose('HOLDEM');
  sheet = await h.open();
  for (const [type, label] of [
    ['HOLDEM', "Hold'em"],
    ['OMAHA', 'Omaha'],
    ['LIMIT', 'Limit'],
  ] as const) {
    await clickControl(
      sheet
        .getByRole('group', { name: 'Game Type', exact: true })
        .getByRole('button', { name: label, exact: true })
    );
    await expect(page.getByRole('tab', { name: LABEL[type], exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await clickControl(sheet.getByRole('button', { name: 'Recommended', exact: true }));
    await expect.poll(async () => (await h.view()).sortByTab?.[type]).toBe('recommended');
  }
  await clickControl(sheet.getByRole('button', { name: 'Close Game Filters', exact: true }));
  const cashFamily = page.getByRole('button', { name: 'Cash Games', exact: true });
  await clickControl(cashFamily);
  await expect(cashFamily).toHaveAttribute('aria-expanded', 'false');
  await expect(rail).toBeHidden();
  await clickControl(cashFamily);
  await expect(cashFamily).toHaveAttribute('aria-expanded', 'true');
  await expect(rail).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(rail).toBeInViewport();
  await assertLobbyControlsInsidePaint(page);
  await assertRegistrationInkInsideFrame(page);
  await testInfo.attach('sticky-lobby-wide.png', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  expect(h.participation).toEqual([]);
  await testInfo.attach('shared-filter-audit.json', {
    body: Buffer.from(
      JSON.stringify({
        geometry,
        retainedView,
        clocks,
        labelEvidence,
        participation: h.participation,
      })
    ),
    contentType: 'application/json',
  });
});
