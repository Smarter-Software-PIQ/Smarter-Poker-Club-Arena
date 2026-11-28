import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #SmarterDesign on the table, the leftovers (2026-11-28). Measured on the
 * live table at 393px after #12280 and #12302: Hand History, Hand Detail,
 * Session Stats, Table Studio, the Invite sheet, Game Rules, the drawer and
 * the loading cover still shouted in capitals or wore gold and orange. Dan:
 * "YELLOW IS NOT A APPROVED COLOR", and every label is Title Case (no
 * `text-transform: uppercase`). This pins both, by reading the stylesheets
 * those surfaces load.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

type Rule = { selector: string; decls: { prop: string; value: string }[] };

/** Innermost `selector { decls }` blocks; an @media body yields its rules. */
function rules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  const re = /([^{}]*)\{([^{}]*)\}/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const selector = m[1].replace(/@[^{]*$/, '').trim();
    if (/^(from|to|[\d.]+%)(\s*,\s*(from|to|[\d.]+%))*$/.test(selector)) continue;
    const decls = m[2]
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d.includes(':'))
      .map((d) => ({
        prop: d.slice(0, d.indexOf(':')).trim().toLowerCase(),
        value: d.slice(d.indexOf(':') + 1).trim(),
      }));
    out.push({ selector, decls });
  }
  return out;
}

function hsl(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h *= 60;
  return [h, s, l];
}

/** Yellow, gold, amber, orange (20-65 deg) and violet, purple, magenta, pink (255-345 deg). */
function bannedColour(value: string): string | null {
  const colours: [number, number, number, string][] = [];
  for (const m of value.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)) {
    let x = m[1];
    if (x.length === 3) x = [...x].map((c) => c + c).join('');
    colours.push([
      parseInt(x.slice(0, 2), 16),
      parseInt(x.slice(2, 4), 16),
      parseInt(x.slice(4, 6), 16),
      m[0],
    ]);
  }
  for (const m of value.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)) {
    colours.push([+m[1], +m[2], +m[3], m[0]]);
  }
  for (const [r, g, b, text] of colours) {
    const [h, s, l] = hsl(r, g, b);
    if (s < 0.25 || l < 0.12 || l > 0.97) continue;
    if ((h >= 20 && h <= 65) || (h >= 255 && h <= 345)) return text;
  }
  return null;
}

const COLOUR_PROPS =
  /^(color|-webkit-text-fill-color|background|background-color|border|border-[a-z-]+|outline|outline-color|box-shadow|text-shadow|fill|stroke|accent-color)$/;

/** Every stylesheet the table's consoles, popups, drawer and sheets load. */
const TABLE_UI_SHEETS = [
  'src/components/table/ActionErrorToast.css',
  'src/components/table/BuyInModal.css',
  'src/components/table/CashClusterHUD.css',
  'src/components/table/ClubProfileModal.css',
  'src/components/table/EmojiPicker.css',
  'src/components/table/GameRulesModal.css',
  'src/components/table/HandDetailModal.css',
  'src/components/table/HandHistoryPanel.css',
  'src/components/table/HeadsUpWaitingModal.css',
  'src/components/table/HeroHubPanel.css',
  'src/components/table/HitRunLeaveConfirm.css',
  'src/components/table/IdentityModal.css',
  'src/components/table/InsuranceModal.css',
  'src/components/table/LightningFoldBar.css',
  'src/components/table/MaintenanceBreakScreen.css',
  'src/components/table/MiniStatsCard.css',
  'src/components/table/MustMoveLobbyModal.css',
  'src/components/table/OnlineFriendInvitePicker.css',
  'src/components/table/RealTimeResultPanel.css',
  'src/components/table/SessionAnalytics.css',
  'src/components/table/SessionHUD.css',
  'src/components/table/SettingsPanel.css',
  'src/components/table/ShareHand.css',
  'src/components/table/SitOutModal.css',
  'src/components/table/TableLoadFailureOverlay.css',
  'src/components/table/TableMenu.css',
  'src/components/table/TableSettingsPanel.css',
  'src/components/table/TableTabBar.css',
  'src/components/table/ThemeSettingsModal.css',
  'src/components/table/TournamentAnnouncementOverlay.css',
  'src/components/table/TournamentLateRegCallToAction.css',
  'src/components/table/TournamentWinnerOverlay.css',
  'src/components/table/WaitListModal.css',
  'src/components/table/WaitlistCallToAction.css',
  'src/components/console/DeckConsole.css',
  'src/components/console/SpadeConsole.css',
  'src/components/handdetail/HandDetailView.css',
  'src/components/handdetail/HandFlagControl.css',
  'src/components/handdetail/HandNoteEditor.css',
  'src/components/handdetail/LogThisHandControl.css',
  'src/components/bbj/BBJInfoModal.css',
  'src/components/tournament/TournamentHUD.css',
  'src/components/tournament/TournamentInfoPanel.css',
  'src/components/wallet/DiamondWalletModal.css',
  'src/pages/MultiTablePage.css',
];

/** Table-only sheets whose own rules carry no banned hue at all. */
const NO_BANNED_HUE = [
  'src/components/table/RealTimeResultPanel.css',
  'src/components/table/ThemeSettingsModal.css',
  'src/components/table/OnlineFriendInvitePicker.css',
  'src/components/table/HandHistoryPanel.css',
  'src/components/table/GameRulesModal.css',
  'src/components/table/TableMenu.css',
  'src/components/table/TableTabBar.css',
  'src/components/table/MiniStatsCard.css',
  'src/components/table/SessionHUD.css',
  'src/components/table/LiveTablesBar.css',
  'src/components/table/PortraitLock.css',
  'src/components/table/DisconnectToast.css',
];

/**
 * Hand detail, Flag This Hand and Your Note are shared with pages off the
 * table, so their skin lives under `.sc--sd`: every base rule that carries a
 * banned hue has a `.sc--sd` rule for the same class that re-declares it.
 */
const SCOPED_TO_THE_SKIN = [
  'src/components/handdetail/HandDetailView.css',
  'src/components/handdetail/HandFlagControl.css',
  'src/components/handdetail/HandNoteEditor.css',
];

describe('the table surfaces wear the #SmarterDesign inks', () => {
  it('no table console, popup, drawer or sheet stylesheet transforms a label to capitals', () => {
    const offenders: string[] = [];
    for (const file of TABLE_UI_SHEETS) {
      for (const rule of rules(read(file))) {
        for (const d of rule.decls) {
          if (d.prop === 'text-transform' && /uppercase/i.test(d.value)) {
            offenders.push(`${file}: ${rule.selector}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the named live findings are Title Case', () => {
    const named: [string, string][] = [
      ['src/components/table/HandHistoryPanel.css', '.hh-entry__tag'],
      ['src/components/table/RealTimeResultPanel.css', '.rtr__word'],
      ['src/components/console/SpadeConsole.css', '.sc-label'],
      ['src/components/table/ThemeSettingsModal.css', '.theme-asset__tier-badge'],
      ['src/components/table/ThemeSettingsModal.css', '.theme-modal__tab'],
      ['src/components/table/ThemeSettingsModal.css', '.tsc__label'],
      ['src/components/table/ThemeSettingsModal.css', '.tsc-word'],
      ['src/components/table/OnlineFriendInvitePicker.css', '.friend-invite-picker__invite-btn'],
      ['src/components/table/GameRulesModal.css', '.rules-modal__section-title'],
      ['src/pages/TablePage.css', '.table-art-cover__label'],
    ];
    for (const [file, selector] of named) {
      const own = rules(read(file)).filter((r) => r.selector === selector);
      expect(own.length, `${file} ${selector}`).toBeGreaterThan(0);
      for (const r of own) {
        const t = r.decls.find((d) => d.prop === 'text-transform');
        if (t) expect(t.value, `${file} ${selector}`).toBe('none');
      }
    }
  });

  it('the table-only sheets carry no gold, amber, orange, yellow, purple or pink ink', () => {
    const offenders: string[] = [];
    for (const file of NO_BANNED_HUE) {
      for (const rule of rules(read(file))) {
        for (const d of rule.decls) {
          if (!COLOUR_PROPS.test(d.prop)) continue;
          const hit = bannedColour(d.value);
          if (hit) offenders.push(`${file}: ${rule.selector} { ${d.prop}: ${hit} }`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('hand detail, Flag This Hand and Your Note re-ink every gold rule inside the skin', () => {
    const missing: string[] = [];
    for (const file of SCOPED_TO_THE_SKIN) {
      const all = rules(read(file));
      const skin = all.filter((r) => r.selector.includes('.sc--sd'));
      for (const rule of all) {
        if (rule.selector.includes('.sc--sd')) continue;
        for (const d of rule.decls) {
          if (!COLOUR_PROPS.test(d.prop) || !bannedColour(d.value)) continue;
          const last = rule.selector.split(',').map((s) => s.trim().split(/\s+/).pop() as string);
          const family = d.prop.replace(/^-webkit-text-fill-/, '').split('-')[0];
          const covered = last.every((tail) =>
            skin.some(
              (s) =>
                s.selector.split(',').some((part) => part.trim().endsWith(tail)) &&
                s.decls.some((sd) => sd.prop.split('-')[0] === family && !bannedColour(sd.value))
            )
          );
          if (!covered) missing.push(`${file}: ${rule.selector} { ${d.prop} }`);
        }
      }
      for (const s of skin) {
        for (const d of s.decls) {
          expect(bannedColour(d.value), `${file}: ${s.selector}`).toBeNull();
          expect(d.prop, `${file}: ${s.selector}`).not.toMatch(/^animation/);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('Save Note is the lit cobalt primary and Flag This Hand a chrome key, inside the skin', () => {
    const note = read('src/components/handdetail/HandNoteEditor.css');
    expect(note).toMatch(
      /\.sc--sd \.hand-note \.hand-note__save \{[^}]*border-image: var\(--sd-active\)[^}]*#087cfa/
    );
    const flag = read('src/components/handdetail/HandFlagControl.css');
    expect(flag).toMatch(/\.sc--sd \.hand-flag \.hand-flag__btn,[^{]*\{[^}]*var\(--sd-stat\)/);
    expect(flag).toMatch(/min-height: 44px/);
  });

  it('the drawer switches read On and Off, never ON and OFF', () => {
    for (const file of [
      'src/components/table/TableMenu.tsx',
      'src/components/table/TableTabBar.tsx',
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/'ON'|'OFF'/);
    }
    expect(read('src/components/table/TableMenu.tsx')).toMatch(/action\.badge === 'On'/);
  });
});
