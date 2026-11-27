/**
 * LAW: one table's error stays on its table (2026-11-27).
 *
 * server/src/index.ts used to send every uncaughtException and every
 * unhandledRejection to fatal(), which drains and exits the whole engine. One
 * stray throw in one table's timer, or one rejected promise in one table's
 * hand pipeline, therefore restarted every table on the box and voided every
 * hand in play.
 *
 * The fix is a boundary (server/src/engine/TableFaultBoundary.ts). Every
 * per-table entry point runs through it, so an error that starts there is
 * attributed to that table and contained by restarting only that engine
 * generation (killForRestart). This law keeps every entry point on it:
 *
 *   1. No ServerTableEngine file arms a raw setTimeout, setInterval,
 *      setImmediate or queueMicrotask. It uses tableTimeout, tableInterval,
 *      tableImmediate or tableMicrotask, whose callbacks are contained. The
 *      one exemption is a callback that only settles the promise it was made
 *      for (`new Promise((r) => setTimeout(r, ms))`): settling cannot throw.
 *   2. No ServerTableEngine file drops a promise with a bare `void call()`.
 *      It either attaches its own `.catch` or hands the promise to
 *      detachTableWork, which contains a rejection to the table.
 *   3. The shared DeadlineScheduler hands a throwing callback to its table's
 *      sink, the engine registers that sink while it owns the table, and
 *      index.ts routes the process handlers through routeProcessFault, which
 *      keeps fatal() for everything unattributed.
 *
 * Behaviour is proven by server/src/engine/oneTablesErrorStaysOnItsTable.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = join(__dirname, '..');
const ENGINE_DIR = join(ROOT, 'server', 'src', 'engine');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const RAW_TIMERS = new Set(['setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask']);
const CONTAINED_HELPERS = new Set([
  'tableTimeout',
  'tableInterval',
  'tableImmediate',
  'tableMicrotask',
]);

function engineFiles(): string[] {
  return readdirSync(ENGINE_DIR)
    .filter((f) => /^ServerTableEngine[A-Za-z]*\.ts$/.test(f))
    .filter((f) => !/\.test\.ts$|\.test-support\.ts$/.test(f))
    .sort();
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(join(ENGINE_DIR, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
}

function rawTimerName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee) && RAW_TIMERS.has(callee.text)) return callee.text;
  if (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'globalThis' &&
    RAW_TIMERS.has(callee.name.text)
  ) {
    return callee.name.text;
  }
  return null;
}

function enclosingMethodName(node: ts.Node): string | null {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (ts.isMethodDeclaration(at) && ts.isIdentifier(at.name)) return at.name.text;
  }
  return null;
}

/** Is `name` a parameter of a `new Promise(executor)` that encloses `node`? */
function isPromiseSettler(name: string, node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at; at = at.parent) {
    if (
      (ts.isArrowFunction(at) || ts.isFunctionExpression(at)) &&
      at.parent &&
      ts.isNewExpression(at.parent) &&
      ts.isIdentifier(at.parent.expression) &&
      at.parent.expression.text === 'Promise' &&
      at.parent.arguments?.[0] === at
    ) {
      if (at.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === name)) return true;
    }
  }
  return false;
}

function containsCall(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** `r`, or `() => r(false)` / `() => reject(new Error('x'))` with r a settler. */
function isSettleOnly(callback: ts.Expression | undefined): boolean {
  if (!callback) return false;
  if (ts.isIdentifier(callback)) return isPromiseSettler(callback.text, callback);
  if (ts.isArrowFunction(callback) && callback.parameters.length === 0) {
    let body: ts.Node = callback.body;
    if (ts.isBlock(body)) {
      if (body.statements.length !== 1) return false;
      const only = body.statements[0];
      if (!ts.isExpressionStatement(only)) return false;
      body = only.expression;
    }
    return (
      ts.isCallExpression(body) &&
      ts.isIdentifier(body.expression) &&
      isPromiseSettler(body.expression.text, body) &&
      !body.arguments.some(containsCall)
    );
  }
  return false;
}

function unparen(node: ts.Expression): ts.Expression {
  let at = node;
  while (ts.isParenthesizedExpression(at)) at = at.expression;
  return at;
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

function scan(): { rawTimers: Finding[]; droppedPromises: Finding[] } {
  const rawTimers: Finding[] = [];
  const droppedPromises: Finding[] = [];
  for (const file of engineFiles()) {
    const sf = parse(file);
    const at = (n: ts.Node): Finding => ({
      file,
      line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
      text: n.getText(sf).split('\n')[0].trim(),
    });
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && rawTimerName(node)) {
        const insideHelper =
          file === 'ServerTableEngineBase.ts' &&
          CONTAINED_HELPERS.has(enclosingMethodName(node) ?? '');
        if (!insideHelper && !isSettleOnly(node.arguments[0])) rawTimers.push(at(node));
      }
      if (ts.isVoidExpression(node)) {
        const operand = unparen(node.expression);
        if (ts.isCallExpression(operand)) {
          const callee = operand.expression;
          const caught = ts.isPropertyAccessExpression(callee) && callee.name.text === 'catch';
          if (!caught) droppedPromises.push(at(node));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { rawTimers, droppedPromises };
}

const fmt = (f: Finding) => `${f.file}:${f.line}  ${f.text}`;

describe("one table's error stays on its table", () => {
  it('scans every ServerTableEngine source file', () => {
    const files = engineFiles();
    expect(files).toContain('ServerTableEngineBase.ts');
    expect(files).toContain('ServerTableEngineDealing.ts');
    expect(files).toContain('ServerTableEngineRunout.ts');
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('arms no raw timer outside the contained helpers', () => {
    const { rawTimers } = scan();
    expect(
      rawTimers.map(fmt),
      'Use this.tableTimeout / tableInterval / tableImmediate / tableMicrotask so a throw ' +
        "kills only this table (engine/TableFaultBoundary.ts), not every table's hand."
    ).toEqual([]);
  });

  it('drops no promise with a bare void', () => {
    const { droppedPromises } = scan();
    expect(
      droppedPromises.map(fmt),
      'Attach a .catch, or use this.detachTableWork(label, promise) so a rejection kills ' +
        'only this table instead of becoming a process-wide unhandledRejection.'
    ).toEqual([]);
  });

  it('the scanner itself catches both shapes it forbids', () => {
    // Guard the guard: a scanner that silently matches nothing passes forever.
    const probe = ts.createSourceFile(
      'probe.ts',
      [
        'class P { m() {',
        '  setTimeout(() => this.work(), 5);',
        '  void this.persist();',
        '  void this.persist().catch(() => {});',
        '  return new Promise((r) => setTimeout(r, 5));',
        '} }',
      ].join('\n'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const timers: string[] = [];
    const voids: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && rawTimerName(node) && !isSettleOnly(node.arguments[0]))
        timers.push(node.getText(probe));
      if (ts.isVoidExpression(node)) {
        const operand = unparen(node.expression);
        if (
          ts.isCallExpression(operand) &&
          !(
            ts.isPropertyAccessExpression(operand.expression) &&
            operand.expression.name.text === 'catch'
          )
        )
          voids.push(node.getText(probe));
      }
      ts.forEachChild(node, visit);
    };
    visit(probe);
    expect(timers).toEqual(['setTimeout(() => this.work(), 5)']);
    expect(voids).toEqual(['void this.persist()']);
  });

  it('the helpers, the scheduler and the process handlers all go through the boundary', () => {
    const base = read('server/src/engine/ServerTableEngineBase.ts');
    expect(base).toContain('tableCallback(this.tableFaultSink, label, work)');
    expect(base).toContain('detachTableWork(this.tableFaultSink, label, work)');
    expect(base).toContain('registerTableFaultSink(this.tableFaultSink)');
    expect(base).toContain("this.killForRestart('contained_fault:' + label)");

    const scheduler = read('server/src/engine/DeadlineScheduler.ts');
    expect(scheduler).toContain('this.containToTable(top, err)');
    expect(scheduler).toContain('tableFaultSinkFor(deadline.tableId)');

    const index = read('server/src/index.ts');
    expect(index).toContain('installProcessFaultHandlers(process, fatal);');
    expect(index).not.toMatch(/process\.on\('(uncaughtException|unhandledRejection)'/);
  });
});
