import React from 'react';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { Table, SimpleTable } from '../../src/components/common/Table';

const css = postcss.parse(
  readFileSync(resolve(__dirname, '../../src/components/common/Table.css'), 'utf8')
);

function matchingDeclarations(element: Element) {
  const declarations: Record<string, string> = {};
  css.walkRules((rule) => {
    if (element.matches(rule.selector)) {
      rule.walkDecls((decl) => {
        declarations[decl.prop] = decl.value;
      });
    }
  });
  return declarations;
}

describe('data-table styles stay outside the poker scene', () => {
  it('does not paint, blur or resize the gameplay container above the tournament dock', () => {
    const { container } = render(
      <div className="table-page table-page--tournament">
        <div className="table-container">
          <div className="table-scaler" />
        </div>
        <div className="tournament-dock" />
      </div>
    );
    for (const selector of ['.table-container', '.table-scaler', '.tournament-dock']) {
      expect(matchingDeclarations(container.querySelector(selector)!)).toEqual({});
    }
  });

  it('keeps the data-table wrapper styles on both maintained table components', () => {
    const { container } = render(
      <>
        <Table
          data={[{ name: 'Alice' }]}
          columns={[{ key: 'name', header: 'Name' }]}
          keyExtractor={(row) => row.name}
          className="custom-report"
        />
        <SimpleTable>
          <tbody>
            <tr>
              <td>Bob</td>
            </tr>
          </tbody>
        </SimpleTable>
      </>
    );
    const tables = container.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      const wrapper = table.parentElement!;
      expect(wrapper.matches('.table-container')).toBe(false);
      expect(matchingDeclarations(wrapper)).toMatchObject({
        width: '100%',
        'overflow-x': 'auto',
        'backdrop-filter': 'blur(12px) saturate(1.3)',
      });
    }
    expect(tables[0].parentElement).toHaveClass('custom-report');
  });
});
