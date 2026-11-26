import type { ReactNode } from 'react';
import './StatsDataTable.css';

export interface StatsDataColumn<Row> {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
}

interface Props<Row> {
  caption: string;
  columns: Array<StatsDataColumn<Row>>;
  rows: Row[];
  rowKey: (row: Row, index: number) => string;
}

export default function StatsDataTable<Row>({ caption, columns, rows, rowKey }: Props<Row>) {
  if (rows.length === 0) return null;
  return (
    <details className="stats-data-table">
      <summary>Show Data Table</summary>
      <div className="stats-data-table__scroll" tabIndex={0} aria-label={`${caption} Table`}>
        <table
          className={columns.length > 4 ? 'stats-data-table__extended' : undefined}
          data-columns={columns.length}
          role="table"
        >
          <caption>{caption}</caption>
          <thead>
            <tr role="row">
              {columns.map((column) => (
                <th scope="col" key={column.key}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey(row, index)} role="row">
                {columns.map((column, columnIndex) =>
                  columnIndex === 0 ? (
                    <th scope="row" key={column.key}>
                      {columns.length === 4 && (
                        <span className="stats-data-table__extra-label" aria-hidden="true">
                          {column.label}
                        </span>
                      )}
                      {column.render(row)}
                    </th>
                  ) : (
                    <td key={column.key}>
                      <span className="stats-data-table__extra-label" aria-hidden="true">
                        {column.label}
                      </span>
                      <span className="stats-data-table__reading">{column.render(row)}</span>
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
