import type { ReactNode } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Hide on small screens (mobile shows a card list instead). */
  hideOnMobile?: boolean;
  align?: 'left' | 'right' | 'center';
  headerClassName?: string;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  /** Mobile card renderer; when omitted the first two columns are shown as a card. */
  renderCard?: (row: T) => ReactNode;
  empty?: ReactNode;
  loading?: boolean;
}

export function DataTable<T>({ columns, rows, rowKey, onRowClick, renderCard, empty, loading }: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-ink-100" />
        ))}
      </div>
    );
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-ink-200 bg-ink-50/80">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-ink-600 ${
                    column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                  } ${column.headerClassName ?? ''}`}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-b border-ink-100 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-brand-50/40' : ''}`}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-2.5 align-middle ${
                      column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                    }`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-ink-100 md:hidden">
        {rows.map((row, index) => (
          <li
            key={rowKey(row, index)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={`px-4 py-3 ${onRowClick ? 'cursor-pointer active:bg-ink-50' : ''}`}
          >
            {renderCard ? (
              renderCard(row)
            ) : (
              <div className="space-y-1">
                {columns.slice(0, 3).map((column) => (
                  <div key={column.key} className="flex items-start justify-between gap-3 text-sm">
                    <span className="shrink-0 text-xs text-ink-400">{column.header}</span>
                    <span className="min-w-0 text-right">{column.render(row)}</span>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100] }: PaginationProps) {
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-4 py-3">
      <p className="text-xs text-ink-500">
        {from}–{to} / মোট {total}
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <select
            aria-label="প্রতি পৃষ্ঠায় সারি"
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="h-9 rounded-lg border border-ink-300 bg-white px-2 text-sm"
          >
            {pageSizeOptions.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        )}
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="পূর্ববর্তী">
          <Icon name="chevronLeft" size={16} />
        </Button>
        <span className="min-w-[74px] text-center text-xs text-ink-600">
          পৃষ্ঠা {page} / {pageCount}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="পরবর্তী">
          <Icon name="chevronRight" size={16} />
        </Button>
      </div>
    </div>
  );
}
