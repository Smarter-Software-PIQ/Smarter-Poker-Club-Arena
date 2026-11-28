#!/usr/bin/env node
/**
 * #SmarterDesign - the inventory, read from the code (2026-11-28).
 *
 *   node scripts/smarterdesign-inventory.mjs            print the summary and the to-do list
 *        (exit 3 when any page is UNKNOWN, so "could not tell" is never a clean 0)
 *   node scripts/smarterdesign-inventory.mjs --json     every routed surface, machine-readable
 *   node scripts/smarterdesign-inventory.mjs --markdown print the inventory document
 *   node scripts/smarterdesign-inventory.mjs --write    rewrite docs/club-operations/SMARTERDESIGN-INVENTORY.md
 *   node scripts/smarterdesign-inventory.mjs --claims [filter]
 *        list the open pull requests touching each page still to convert
 *        (ADVISORY: read-only, never blocks anything, exit 3 = COULD NOT TELL)
 *
 * WHY IT EXISTS. The inventory used to be written by hand and went stale in a
 * day: PR #12312 converted seven pages, the document still listed them as
 * to-do, and two lanes started the same work. The #ClubArenaConsole scanner
 * (`.claude/skills/club-arena-console/scripts/find-generic-surfaces.mjs`) could
 * not help: it measures distance from the PAINTED master, so a page on painted
 * SpadeConsole plates scores 0 there - "done" - while under #SmarterDesign
 * (Dan, 2026-11-27) those plates are "THE OLD STYLE". This script measures the
 * other standard, from markers in source, and the committed inventory is its
 * output (pinned by tests/the-smarterdesign-inventory-matches-the-code.law.test.ts).
 *
 * HOW A PAGE IS GRADED. Every <Route> in src/App.tsx is resolved to the page
 * module it renders (guards, boundaries and layouts skipped). The page file, and
 * the page-owned components it renders one hop down, are read for:
 *
 *   root      `arena-workspace` as a class name (the shell every rule hangs off)
 *   mast      <ArenaWorkspaceHeader> (or the `arena-workspace-mast` it draws)
 *   sections  arena-case, arena-section-title, arena-meter, arena-switch,
 *             arena-ledger-row, the ArenaOps kit, <ClubPageSection arena>
 *   painted   <SpadeConsole>, <PlateButton>, <DeckConsole> used as a page
 *             section (a console with onClose, role="dialog" or aria-modal is a
 *             popup, which #ClubArenaConsole governs, and is not counted)
 *   dress     painted radii and gradients in the page's own stylesheet
 *
 *   converted      root + mast, and no painted section left
 *   partial        some arena evidence, but not all of the above
 *   not converted  no arena evidence: painted plates, its own module dress, or a
 *                  plain flat sheet
 *   UNKNOWN        the evidence could not be read (CLAUDE.md 10.86 rule 1): the
 *                  module did not resolve, or the page delegates to something
 *                  this scan cannot follow. Never reported as done.
 *
 * THE ROOT SKIN IS NOT A CONVERSION. Since PR #12299 src/App.tsx wraps the app
 * in <ConsoleSkinProvider value="smarterdesign">, so every SpadeConsole renders
 * as one thin chrome case instead of the painted master. A page built from
 * SpadeConsole sections therefore LOOKS closer than it is: it has no
 * arena-workspace root, no mast, no readouts, no chrome keys. It is graded
 * `not converted` (or `partial`), and the reason says the skin is dressing it.
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = 'src/App.tsx';
export const INVENTORY_DOC = 'docs/club-operations/SMARTERDESIGN-INVENTORY.md';
const HISTORY_DOC = 'docs/club-operations/SMARTERDESIGN-HISTORY.md';
const REPO = process.env.SMARTERDESIGN_REPO || 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';

/* DELIBERATE EXCLUSIONS. Each is off the #SmarterDesign sweep for a written
   reason; deleting a line puts that page back on the list. Matched against the
   page file (exact) or a directory prefix ending in '/'. */
const EXCLUDED = [
  /* Other approved masters (#SmarterCasinoRealism or painted game art; see the
     club-arena-console skill, step 1.5). */
  ['src/pages/LeaderboardPage.tsx', 'On another approved master (#SmarterCasinoRealism).'],
  ['src/components/challenges/', 'Daily Challenges: on another approved master.'],
  ['src/pages/AchievementsPage.tsx', 'On another approved master (#SmarterCasinoRealism).'],
  ['src/pages/BadBeatJackpotPage.tsx', 'On its own approved Bad Beat Jackpot console.'],
  ['src/pages/DiamondWheelPage.tsx', 'Diamond game on its painted game art.'],
  ['src/pages/DiamondPlinkoPage.tsx', 'Diamond game on its painted game art.'],
  ['src/pages/DiamondCrashPage.tsx', 'Diamond game on its painted game art.'],
  ['src/pages/DiamondChoicePage.tsx', 'Diamond game (Mines, Crossing) on its painted game art.'],
  /* Platform staff desks: internal tools, held to copy laws and the palette
     only. Any route behind PlatformStaffGuard or FinancialAdminGate is one too
     (STAFF_GUARD below), without being listed here. */
  ['src/pages/admin/', 'Platform staff desk (internal tool).'],
  ['src/pages/AdminDashboardPage.tsx', 'Platform staff desk (internal tool).'],
  ['src/pages/DriftIncidentsPage.tsx', 'Platform staff desk (internal tool).'],
  ['src/pages/FinancialAdminHub.tsx', 'Platform staff desk (Financial Admin, internal tool).'],
  ['src/pages/HealthCheckPage.tsx', 'Uptime monitor page, not a product page.'],
  ['src/pages/SimPage.tsx', 'Internal QA harness.'],
  ['src/pages/BusDevToolsPage.tsx', 'Internal developer tool.'],
  ['src/pages/dev/', 'Showcase harness, not a product page.'],
  /* The front door keeps its own dress. */
  ['src/pages/AuthPage.tsx', 'The front door keeps its own dress.'],
  ['src/pages/InvitePage.tsx', 'The front door keeps its own dress.'],
];
/** Every EXCLUDED key must still match a routed page; the law test holds it. */
export const EXCLUDED_KEYS = EXCLUDED.map(([key]) => key);
const STAFF_GUARD = /^(?:PlatformStaffGuard|FinancialAdminGate)$/;

const excludedFor = (file) => {
  for (const [key, why] of EXCLUDED) {
    if (key.endsWith('/') ? file.startsWith(key) : file === key) return why;
  }
  return null;
};

/* Kit and shared plumbing: their USE is the evidence (a <ArenaWorkspaceHeader>
   tag), never their contents, or every page that imports the header would
   inherit the header's own class names. */
const KIT_PREFIXES = [
  'src/components/lobby/ArenaWorkspace',
  'src/components/ops/',
  'src/components/club/ClubPageSection',
  'src/components/common/',
  'src/components/console/',
  'src/components/help/',
  'src/components/layouts/',
  'src/components/auth/',
  'src/components/navigation/',
];
const isKit = (file) => KIT_PREFIXES.some((p) => file.startsWith(p));

/* ------------------------------------------------------------------------- */
/* Source reading                                                            */
/* ------------------------------------------------------------------------- */

const read = (rel) => {
  try {
    return readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
};

/** Comments blanked (length kept), so prose never counts as a marker. Line
 *  comments only when they start a line, so `'https://...'` survives. */
const decomment = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^(\s*)\/\/.*$/gm, (m, lead) => lead + ' '.repeat(m.length - lead.length));

const resolveModule = (fromRel, spec) => {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(fromRel), spec);
  for (const cand of [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    const full = join(ROOT, cand);
    if (existsSync(full) && statSync(full).isFile()) return relative(ROOT, full);
  }
  return null;
};

/** name -> { file, exportName } for every component a module imports. */
function importMap(rel, src) {
  const out = new Map();
  const lazy =
    /const\s+(\w+)\s*=\s*(?:lazyWithRetry|lazy)\(\s*(?:\(\)\s*=>\s*)?\(?\s*(?:\(\)\s*=>\s*)?import\(\s*'([^']+)'\s*\)(?:\s*\.then\(\s*\(?(\w+)\)?\s*=>\s*\(\{\s*default:\s*\3\.(\w+))?/g;
  for (const m of src.matchAll(lazy)) {
    out.set(m[1], { file: resolveModule(rel, m[2]), spec: m[2], exportName: m[4] || 'default' });
  }
  for (const m of src.matchAll(/import\s+([\w\s{},]+?)\s+from\s+'([^']+)'/g)) {
    const clause = m[1];
    const file = resolveModule(rel, m[2]);
    const def = clause.match(/^\s*(\w+)/);
    if (def && !clause.trim().startsWith('{')) {
      out.set(def[1], { file, spec: m[2], exportName: 'default' });
    }
    const named = clause.match(/\{([^}]*)\}/);
    if (named) {
      for (const part of named[1].split(',')) {
        const [orig, alias] = part.trim().split(/\s+as\s+/);
        if (orig) out.set((alias || orig).trim(), { file, spec: m[2], exportName: orig.trim() });
      }
    }
  }
  return out;
}

/** The value of a JSX attribute `name={...}` starting at `at`, braces balanced. */
function balanced(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return src.slice(open + 1, i);
    } else if (c === '"' || c === "'" || c === '`') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) return null;
      i = end;
    }
  }
  return null;
}

/** Every <Route> in App.tsx with its full path and the JSX it renders. */
function readRoutes(src) {
  const routes = [];
  const stack = [];
  const re = /<Route\b|<\/Route>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0] === '</Route>') {
      stack.pop();
      continue;
    }
    /* Find the end of the opening tag, skipping braces and strings. */
    let i = m.index + 6;
    let depth = 0;
    let selfClosing = false;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if ((c === '"' || c === "'") && depth === 0) i = src.indexOf(c, i + 1);
      else if (c === '>' && depth === 0) {
        selfClosing = src[i - 1] === '/';
        break;
      }
    }
    const tag = src.slice(m.index, i + 1);
    re.lastIndex = i + 1;
    const pathMatch = tag.match(/\bpath=(?:"([^"]*)"|\{\s*'([^']*)'\s*\})/);
    const own = pathMatch ? (pathMatch[1] ?? pathMatch[2]) : tag.match(/\bindex\b/) ? '' : null;
    const parent = stack.length ? stack[stack.length - 1] : '';
    const full =
      own === null
        ? parent
        : own.startsWith('/')
          ? own
          : `${parent.replace(/\/$/, '')}/${own}`.replace(/\/+/g, '/');
    const elAt = tag.search(/\belement=\{/);
    const element = elAt >= 0 ? balanced(tag, tag.indexOf('{', elAt)) : null;
    if (element !== null) routes.push({ path: full || '/', element });
    if (!selfClosing) stack.push(full);
  }
  return routes;
}

const WRAPPER = /(?:Guard|Gate|Boundary|ErrorBoundary)$|^(?:Suspense|AppLayout|Fragment)$/;
const REDIRECT = /^Navigate$|Redirect$/;

/* ------------------------------------------------------------------------- */
/* Grading                                                                   */
/* ------------------------------------------------------------------------- */

const ROOT_RE = /(?<![\w-])arena-workspace(?![\w-])/;
const MAST_RE = /<ArenaWorkspaceHeader\b|(?<![\w-])arena-workspace-mast(?![\w-])/;
const SECTION_CLASS_RE =
  /(?<![\w-])arena-(?:case|ops-case|section-title|meter|switch|ledger-row|ops-rows|ops-well|ops-keys)(?![\w-])/g;
const ARENA_ATTR_RE = /(?:^|\s)arena(?:\s|=\{true\}|\/?$)/;
const DIALOG_ATTR_RE = /\bonClose=|role=["']dialog["']|aria-modal/;
const DIALOG_NAME_RE = /(?:Modal|Dialog|Sheet|Popup|Overlay|Drawer|Toast)$/;
const PAINTED_KIT = new Set([
  'src/components/console/SpadeConsole.tsx',
  'src/components/console/DeckConsole.tsx',
]);
const SECTION_KIT = 'src/components/club/ClubPageSection.tsx';
const OPS_KIT = 'src/components/ops/ArenaOps.tsx';

/** Every JSX opening tag in a module, its attributes, and what it resolves to.
 *  Resolved through the module's own imports, because a page may alias
 *  `ClubPageSection as SpadeConsole` (the route #12262 used): the tag NAME says
 *  console, the import says section. */
function jsxTags(rel, src) {
  const imports = importMap(rel, src);
  const out = [];
  for (const m of src.matchAll(/<([A-Z]\w*)\b/g)) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const hit = imports.get(m[1]);
    out.push({
      name: m[1],
      attrs: src.slice(m.index + m[0].length, i),
      file: hit?.file ?? null,
      exportName: hit?.exportName ?? null,
    });
  }
  return out;
}

/** Arena sections in one module: the class names, the ArenaOps kit, and
 *  <ClubPageSection arena> under any local name. */
function arenaSections(rel, src, tags) {
  let n = (src.match(SECTION_CLASS_RE) ?? []).length;
  for (const t of tags) {
    if (t.file === OPS_KIT && /^Arena(?:Readings|Row|State)$/.test(t.exportName)) n++;
    else if (t.file === SECTION_KIT && ARENA_ATTR_RE.test(t.attrs)) n++;
  }
  return n;
}

/** Painted section uses of the console kit in one module (popups excluded). */
function paintedSections(tags) {
  let n = 0;
  for (const t of tags) {
    if (!PAINTED_KIT.has(t.file)) continue;
    if (/^(?:SpadeConsole|DeckConsole)$/.test(t.exportName) && DIALOG_ATTR_RE.test(t.attrs))
      continue;
    n++;
  }
  return n;
}

/** Painted radii and gradients in the stylesheets a module imports beside itself. */
function ownDress(rel, src) {
  let radius = 0;
  let grad = 0;
  const sheets = [];
  for (const m of src.matchAll(/import\s+(?:\w+\s+from\s+)?'(\.[^']+\.css)'/g)) {
    const sheet = relative(ROOT, join(ROOT, dirname(rel), m[1]));
    if (isKit(sheet) || sheet.startsWith('src/styles/')) continue;
    const css = read(sheet);
    if (css === null) continue;
    sheets.push(sheet);
    const style = css.replace(/\/\*[\s\S]*?\*\//g, '');
    radius += [...style.matchAll(/border-radius\s*:\s*([^;}]*)/g)].filter(
      (d) => !/^0[a-z%]*$/.test(d[1].replace(/!important/, '').trim())
    ).length;
    grad += (style.match(/linear-gradient|radial-gradient/g) ?? []).length;
  }
  return { radius, grad, sheets };
}

/** The page-owned components a module renders, one hop down. */
function delegatesOf(rel, src) {
  const imports = importMap(rel, src);
  const out = [];
  const seen = new Set();
  for (const m of src.matchAll(/<([A-Z]\w*)\b/g)) {
    const hit = imports.get(m[1]);
    if (!hit || !hit.file || seen.has(hit.file) || hit.file === rel) continue;
    if (!/\.tsx$/.test(hit.file) || isKit(hit.file)) continue;
    if (DIALOG_NAME_RE.test(m[1])) continue;
    seen.add(hit.file);
    out.push({ name: m[1], file: hit.file });
  }
  return out;
}

const MARKUP_RE = /className=|style=\{\{/;
const HTML_TAG_RE =
  /<(?:div|section|main|article|header|footer|nav|aside|span|p|h[1-6]|ul|ol|li|dl|button|a|form|input|select|textarea|label|table|img|svg|iframe)[\s>/]/;

/** A module whose only JSX is <Navigate> (or none at all): a redirect, not a page. */
const rendersNothing = (src, tags) =>
  !HTML_TAG_RE.test(src) && tags.every((t) => t.name === 'Navigate');

/** A component that carries an opt-in `arena` prop: two dresses in one file. */
const OPT_IN_PROP_RE = /\barena\?\s*:\s*boolean|\barena\s*=\s*false\b/;

/**
 * A SHARED COMPONENT IS NOT THE PAGE'S EVIDENCE. A component rendered by two
 * or more routed pages (RewardsSurfaceHeader, WeeklyAccountingWorkspace ...)
 * carries both of its dresses in its own source: the painted one AND the arena
 * one behind an opt-in `arena` prop or an `.arena-workspace`-scoped sheet
 * (SKILL.md, the shared-component rule). Reading its contents would credit
 * every host with the arena branch, or charge every host with the painted
 * one. So it is read only when the page opts in with `arena`; otherwise the
 * page is graded on its own source.
 */
function grade(file, shared) {
  const raw = read(file);
  if (raw === null) {
    return { status: 'unknown', why: `could not read ${file}` };
  }
  const src = decomment(raw);
  const tags = jsxTags(file, src);
  const optedIn = new Set(
    tags.filter((t) => shared.has(t.file) && ARENA_ATTR_RE.test(t.attrs)).map((t) => t.file)
  );
  const notRead = [
    ...new Set(tags.filter((t) => shared.has(t.file) && !optedIn.has(t.file)).map((t) => t.name)),
  ].sort();
  const delegates = delegatesOf(file, src)
    .filter((d) => !shared.has(d.file) || optedIn.has(d.file))
    .map((d) => ({ ...d, src: read(d.file) }))
    .filter((d) => d.src !== null)
    .map((d) => {
      const dsrc = decomment(d.src);
      return { ...d, src: dsrc, tags: jsxTags(d.file, dsrc) };
    });
  const via = (re) => {
    if (re.test(src)) return file;
    const d = delegates.find((x) => re.test(x.src));
    return d ? d.file : null;
  };
  const rootIn = via(ROOT_RE);
  const mastIn = via(MAST_RE);
  const sections =
    arenaSections(file, src, tags) +
    delegates.reduce((n, d) => n + arenaSections(d.file, d.src, d.tags), 0);
  const paintedIn = [
    [file, paintedSections(tags)],
    ...delegates.map((d) => [d.file, paintedSections(d.tags)]),
  ]
    .filter(([, n]) => n > 0)
    .map(([f, n]) => `\`${f}\` (${n})`);
  const painted =
    paintedSections(tags) + delegates.reduce((n, d) => n + paintedSections(d.tags), 0);
  const dress = ownDress(file, src);
  const hasMarkup = MARKUP_RE.test(src) || delegates.some((d) => MARKUP_RE.test(d.src));
  if (rendersNothing(src, tags)) {
    return { status: 'no-page', why: 'renders no page of its own (a redirect or null)' };
  }
  const evidence = {
    root: rootIn,
    mast: mastIn,
    sections,
    painted,
    radius: dress.radius,
    gradients: dress.grad,
    paintedIn,
    sharedOptedIn: [...optedIn].sort(),
    sharedNotRead: notRead,
  };

  if (rootIn && mastIn && painted === 0) {
    return { status: 'converted', evidence, why: 'arena-workspace root and mast' };
  }
  if (rootIn || mastIn || sections > 0) {
    const missing = [];
    if (!rootIn) missing.push('no arena-workspace root');
    if (!mastIn) {
      missing.push(
        /<PageBar\b/.test(src)
          ? 'no ArenaWorkspaceHeader mast (a PageBar only)'
          : 'no ArenaWorkspaceHeader mast'
      );
    }
    if (painted > 0) missing.push(`painted console section(s) left in ${paintedIn.join(', ')}`);
    return { status: 'partial', evidence, why: missing.join('; ') };
  }
  if (painted > 0) {
    return {
      status: 'not-converted',
      evidence,
      why: `painted console sections in ${paintedIn.join(', ')}; the root smarterdesign skin dresses them, but there is no arena shell`,
    };
  }
  if (dress.radius + dress.grad > 0) {
    return {
      status: 'not-converted',
      evidence,
      why: `its own module dress (${dress.radius} painted radii, ${dress.grad} gradients)`,
    };
  }
  if (hasMarkup) {
    return { status: 'not-converted', evidence, why: 'a plain flat sheet, no frames' };
  }
  return {
    status: 'unknown',
    evidence,
    why: 'no markup of its own and nothing this scan could follow; read the source',
  };
}

/* ------------------------------------------------------------------------- */
/* The inventory                                                             */
/* ------------------------------------------------------------------------- */

export function scan() {
  const appRaw = read(APP);
  if (appRaw === null) throw new Error(`could not read ${APP}`);
  const app = decomment(appRaw);
  const imports = importMap(APP, app);
  const surfaces = new Map();
  for (const route of readRoutes(app)) {
    const tags = [...route.element.matchAll(/<([A-Z]\w*)\b/g)].map((m) => m[1]);
    const leaves = tags.filter((t) => !WRAPPER.test(t));
    if (!leaves.length || leaves.every((t) => REDIRECT.test(t))) continue;
    for (const name of leaves) {
      if (REDIRECT.test(name)) continue;
      const hit = imports.get(name);
      const key = hit && hit.file ? `${hit.file}#${hit.exportName}` : `?${name}`;
      if (!surfaces.has(key)) {
        surfaces.set(key, { component: name, file: hit?.file ?? null, paths: [], open: false });
      }
      surfaces.get(key).paths.push(route.path);
      /* A surface is a staff desk only when EVERY route to it is staff-guarded. */
      if (!tags.some((t) => STAFF_GUARD.test(t))) surfaces.get(key).open = true;
      if (!hit) {
        const at = app.search(new RegExp(`function\\s+${name}\\s*\\(`));
        const body = at >= 0 ? balanced(app, app.indexOf('{', app.indexOf(')', at))) : null;
        surfaces.get(key).inline = body;
      }
    }
  }
  /* Which page-owned components more than one routed page renders. */
  const users = new Map();
  for (const s of surfaces.values()) {
    if (!s.file || excludedFor(s.file)) continue;
    const raw = read(s.file);
    if (raw === null) continue;
    for (const d of delegatesOf(s.file, decomment(raw))) {
      if (!users.has(d.file)) users.set(d.file, new Set());
      users.get(d.file).add(s.file);
    }
  }
  const shared = new Set(
    [...users]
      .filter(([f, u]) => u.size > 1 && OPT_IN_PROP_RE.test(decomment(read(f) ?? '')))
      .map(([f]) => f)
  );
  const rows = [];
  const graded = new Map();
  for (const s of surfaces.values()) {
    const paths = [...new Set(s.paths)].sort();
    if (
      !s.file &&
      s.inline != null &&
      rendersNothing(
        s.inline,
        [...s.inline.matchAll(/<([A-Z]\w*)\b/g)].map((m) => ({ name: m[1] }))
      )
    ) {
      rows.push({
        component: s.component,
        file: null,
        paths,
        status: 'no-page',
        why: `defined inline in \`${APP}\` and renders no page of its own (null or a redirect)`,
      });
      continue;
    }
    if (!s.file) {
      rows.push({
        ...s,
        paths,
        status: 'unknown',
        why: `${s.component} does not resolve to a module from ${APP}`,
      });
      continue;
    }
    const excluded =
      excludedFor(s.file) ??
      (s.open
        ? null
        : 'Platform staff desk (every route to it is behind PlatformStaffGuard or FinancialAdminGate).');
    if (excluded) {
      rows.push({ ...s, paths, status: 'excluded', why: excluded });
      continue;
    }
    if (!graded.has(s.file)) graded.set(s.file, grade(s.file, shared));
    rows.push({ ...s, paths, ...graded.get(s.file) });
  }
  rows.sort((a, b) =>
    `${a.file ?? '~'}#${a.component}`.localeCompare(`${b.file ?? '~'}#${b.component}`)
  );
  const skinProvided = /<ConsoleSkinProvider\s+value="smarterdesign"/.test(app);
  /* An exclusion that matches no routed page is a dead line that reads as a
     ruling; the law test refuses it. */
  const excludedKeysUnused = EXCLUDED_KEYS.filter(
    (key) =>
      !rows.some((r) => r.file && (key.endsWith('/') ? r.file.startsWith(key) : r.file === key))
  );
  return { rows, skinProvided, shared: [...shared].sort(), excludedKeysUnused };
}

const STATUSES = [
  ['not-converted', 'Not converted'],
  ['partial', 'Partial'],
  ['unknown', 'UNKNOWN (read the source; never counted as done)'],
  ['converted', 'Converted'],
  ['excluded', 'Excluded on purpose'],
  ['no-page', 'Renders no page of its own'],
];

const fmtPaths = (paths) => {
  const shown = paths.slice(0, 3).map((p) => `\`${p}\``);
  return paths.length > 3 ? `${shown.join(', ')} and ${paths.length - 3} more` : shown.join(', ');
};

export function markdown({ rows, skinProvided }) {
  const count = (st) => rows.filter((r) => r.status === st).length;
  const lines = [
    '# #SmarterDesign Inventory',
    '',
    '<!-- GENERATED by `node scripts/smarterdesign-inventory.mjs --write`. Do not edit by hand:',
    '     tests/the-smarterdesign-inventory-matches-the-code.law.test.ts fails when this file',
    '     differs from what the scanner reads in src/. The batch history is hand-written in',
    `     ${HISTORY_DOC}. -->`,
    '',
    '#SmarterDesign is the arena workspace language in `src/components/lobby/ArenaWorkspace.css`',
    'and `src/components/ops/ArenaOps.css` (`.claude/skills/smarter-design/SKILL.md`). This list is',
    'read from the code: every route in `src/App.tsx` is resolved to its page module and graded',
    'from markers in source (the page file and the page-owned components it renders one hop down).',
    'How each grade is decided is in the header of `scripts/smarterdesign-inventory.mjs`.',
    '',
    'Before starting a page, check nobody else has it:',
    '',
    '```bash',
    'node scripts/smarterdesign-inventory.mjs --claims',
    '```',
    '',
    `The batch history (what each PR converted, and why) is in [SMARTERDESIGN-HISTORY.md](./SMARTERDESIGN-HISTORY.md).`,
    '',
    '## Summary',
    '',
    `- Not converted: ${count('not-converted')}`,
    `- Partial: ${count('partial')}`,
    `- UNKNOWN: ${count('unknown')}`,
    `- Converted: ${count('converted')}`,
    `- Excluded on purpose: ${count('excluded')}`,
    `- Renders no page of its own: ${count('no-page')}`,
    '',
    skinProvided
      ? '`src/App.tsx` provides `<ConsoleSkinProvider value="smarterdesign">`, so every `SpadeConsole` ' +
        'renders as a thin chrome case instead of the painted master. That is a skin, not a ' +
        'conversion: a page built from console sections still has no arena-workspace root, mast, ' +
        'readouts or chrome keys, and is graded on what its own source carries.'
      : '`src/App.tsx` does not provide the smarterdesign console skin, so every `SpadeConsole` ' +
        'section renders on the painted master.',
    '',
  ];
  for (const [st, title] of STATUSES) {
    const group = rows.filter((r) => r.status === st);
    lines.push(`## ${title} (${group.length})`, '');
    if (!group.length) {
      lines.push('None.', '');
      continue;
    }
    for (const r of group) {
      const where = r.file ? `\`${r.file}\`` : 'no module';
      const why = r.why.replace(/\.$/, '');
      lines.push(`- **${r.component}**, ${where}: ${why}. Routes: ${fmtPaths(r.paths)}.`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/* ------------------------------------------------------------------------- */
/* Claims (advisory)                                                         */
/* ------------------------------------------------------------------------- */

const ghAsync = (args) =>
  new Promise((done, fail) => {
    execFile(
      'gh',
      args,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 },
      (err, stdout, stderr) =>
        err
          ? fail(
              new Error(
                String(stderr || err.message)
                  .trim()
                  .split('\n')[0]
              )
            )
          : done(stdout)
    );
  });

/**
 * Every open PR with the files it touches, or { error } when GitHub could not
 * be read. REST only: GraphQL is refused in some agent sessions. One list call,
 * then one paginated files call per PR, eight at a time. Any failure anywhere
 * makes the whole answer an error: a partial PR list would report a page as
 * unclaimed because the PR that claims it was the one that failed to load.
 */
async function openPullRequests() {
  let list;
  try {
    list = await ghAsync([
      'api',
      '--paginate',
      `repos/${REPO}/pulls?state=open&per_page=100`,
      '--jq',
      '.[] | {number, title, branch: .head.ref, draft, updated: .updated_at}',
    ]);
  } catch (e) {
    return { error: `listing open pull requests failed: ${e.message}` };
  }
  let prs;
  try {
    prs = list
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return { error: 'GitHub answered the pull request list with something that is not JSON' };
  }
  let failed = null;
  let next = 0;
  const worker = async () => {
    while (next < prs.length && !failed) {
      const pr = prs[next++];
      try {
        const out = await ghAsync([
          'api',
          '--paginate',
          `repos/${REPO}/pulls/${pr.number}/files?per_page=100`,
          '--jq',
          '.[].filename',
        ]);
        pr.files = out.split('\n').filter(Boolean);
      } catch (e) {
        failed = `could not read the files of #${pr.number}: ${e.message}`;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed) return { error: failed };
  return { prs };
}

/** The files that make up one page: the module, its sheets, its page-owned delegates. */
function pageFiles(file) {
  const raw = read(file);
  if (raw === null) return [file];
  const src = decomment(raw);
  const out = new Set([file]);
  for (const s of ownDress(file, src).sheets) out.add(s);
  for (const d of delegatesOf(file, src)) out.add(d.file);
  return [...out];
}

/** A PR that reads as design work on a page, by its title or branch. */
const DESIGN_PR_RE = /smarter\s*-?design|#smarterdesign|arena[\s-]workspace|\bredesign|\brestyle/i;

async function claims(filter) {
  const { rows } = scan();
  const todo = rows.filter(
    (r) =>
      ['not-converted', 'partial', 'unknown'].includes(r.status) &&
      (!filter || `${r.component} ${r.file ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
  );
  const res = await openPullRequests();
  if (res.error) {
    console.log(`UNKNOWN: could not read open pull requests from ${REPO} (${res.error}).`);
    console.log(
      'No page below is reported as unclaimed. Check the open PRs by hand before starting.'
    );
    for (const r of todo) console.log(`  UNKNOWN  ${r.component}  ${r.file ?? ''}`);
    return 3;
  }
  console.log(
    `${res.prs.length} open pull request(s) read from ${REPO}. ADVISORY: nothing is blocked.\n` +
      'CLAIMED  = an open PR that reads as design work touches the page; coordinate with it.\n' +
      'touched  = only other open PRs touch it; expect a merge, not a duplicate.\n' +
      'unclaimed = no open PR touches the page, its sheets or its page-owned components.\n'
  );
  for (const r of todo) {
    const files = r.file ? pageFiles(r.file) : [];
    const hits = res.prs
      .filter((pr) => pr.files.some((f) => files.includes(f)))
      .sort((x, y) => String(y.updated).localeCompare(String(x.updated)));
    const label = `${r.component}  ${r.file ?? '(no module)'}  [${r.status}]`;
    if (!hits.length) {
      console.log(`  unclaimed  ${label}`);
      continue;
    }
    const design = hits.some((pr) => DESIGN_PR_RE.test(`${pr.title} ${pr.branch}`));
    console.log(`  ${design ? 'CLAIMED   ' : 'touched   '} ${label}`);
    for (const pr of hits) {
      const touched = pr.files.filter((f) => files.includes(f)).join(', ');
      const tag = DESIGN_PR_RE.test(`${pr.title} ${pr.branch}`) ? ' [#SmarterDesign]' : '';
      console.log(
        `             #${pr.number}${pr.draft ? ' (draft)' : ''}${tag} updated ${String(pr.updated).slice(0, 10)}: ${pr.title} [${pr.branch}] touches ${touched}`
      );
    }
  }
  return 0;
}

/* ------------------------------------------------------------------------- */
/* CLI                                                                       */
/* ------------------------------------------------------------------------- */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--claims')) {
    const filter = args.filter((a) => !a.startsWith('--'))[0];
    process.exit(await claims(filter));
  }
  const result = scan();
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else if (args.includes('--markdown')) {
    process.stdout.write(markdown(result));
  } else if (args.includes('--write')) {
    writeFileSync(join(ROOT, INVENTORY_DOC), markdown(result));
    console.log(`wrote ${INVENTORY_DOC}`);
  } else {
    const { rows } = result;
    for (const [st, title] of STATUSES) {
      console.log(`${title}: ${rows.filter((r) => r.status === st).length}`);
    }
    console.log('');
    for (const r of rows.filter((x) =>
      ['not-converted', 'partial', 'unknown'].includes(x.status)
    )) {
      console.log(
        `${r.status.padEnd(14)} ${r.component.padEnd(34)} ${r.file ?? '(unresolved)'}  ${r.why}`
      );
    }
    if (rows.some((r) => r.status === 'unknown')) process.exitCode = 3;
  }
}
