/**
 * The work-queue table — one implementation behind the Deals list and the
 * Companies list (Centrex §5, "Operational Workbench"). Saved lists (build prompt
 * chunk 3) are to render through it too, so it takes its rows, columns and sort
 * from the caller and fetches nothing itself.
 *
 * Built to carry many columns without feeling crowded: sentence-case headers with
 * no fill (they may take two lines when space is short; cells never do), hairline
 * row dividers, optionally the first column pinned while the rest scroll
 * sideways, and one pinned cell at the end for the row's actions. A click
 * anywhere on a row that is not itself a control opens the row.
 */

import { ArrowDown, ArrowUp } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { Skeleton } from '@/components';
import { cn } from '@/lib/cn';

export interface QueueColumn<Row, Sort extends string, Id extends string = string> {
  id: Id;
  label: string;
  /** A shorter header for a narrow column; `label` stays its name in Customize,
   * the exports and the header's tooltip. */
  shortLabel?: string;
  /** The server sort this column's header asks for; absent, not sortable. */
  sort?: Sort;
  /** The order a first click on the header asks for. */
  firstOrder?: 'asc' | 'desc';
  /** Background-check data: offered only where `canReadUnderwriting` — never to
   * DEVELOPER (decision D8). */
  underwritingOnly?: boolean;
  /** Always shown — a row nobody can recognise is no use. */
  fixed?: boolean;
  /** Numbers and dates line up on the right, as in any ledger. */
  align?: 'right' | 'center';
  /** Hidden until someone turns it on in Customize (the full report has it). */
  hiddenByDefault?: boolean;
  render: (row: Row) => ReactNode;
  /** The same value as plain text, for the CSV exports. */
  text: (row: Row) => string;
}

export interface QueueSort<Sort extends string> {
  sort: Sort;
  order: 'asc' | 'desc';
}

/** A row click opens the row — except when the click was on a link or button
 * inside it, which does its own thing. */
function isInteractive(event: MouseEvent): boolean {
  return (event.target as HTMLElement).closest('a, button, input, label') !== null;
}

const CELL = 'whitespace-nowrap px-2.5 py-2.5 first:pl-4 last:pr-3';
/** Pinned cells keep an opaque background, so rows scrolling under them never
 * show through. */
const PINNED_START = 'sticky left-0 z-[1] bg-surface group-hover:bg-surface-subtle';
const PINNED_END = 'sticky right-0 z-[1] shadow-[-8px_0_8px_-8px_rgba(0,0,0,0.08)]';
const ALIGN = { right: 'text-right', center: 'text-center' } as const;

export function QueueTable<Row, Sort extends string>({
  rows,
  columns,
  rowKey,
  rowHref,
  endCell,
  endLabel,
  pinFirst = false,
  sort,
  onSortChange,
  isLoading = false,
  empty,
  rowTestId,
}: {
  rows: readonly Row[];
  columns: readonly QueueColumn<Row, Sort>[];
  rowKey: (row: Row) => string;
  /** Where a click on the row goes. */
  rowHref: (row: Row) => string;
  /** The pinned last cell — the row's actions. */
  endCell: (row: Row) => ReactNode;
  /** Its header; visually hidden when it is only an arrow. */
  endLabel: { text: string; visible: boolean };
  pinFirst?: boolean;
  sort?: QueueSort<Sort>;
  onSortChange?: (next: QueueSort<Sort>) => void;
  isLoading?: boolean;
  empty: ReactNode;
  rowTestId: string;
}) {
  const navigate = useNavigate();

  const header = (column: QueueColumn<Row, Sort>) => {
    const text = column.shortLabel ?? column.label;
    if (!column.sort || !sort || !onSortChange) return <span title={column.label}>{text}</span>;
    const active = sort.sort === column.sort;
    const next: QueueSort<Sort> = {
      sort: column.sort,
      // A new column starts with the order a reader expects of it.
      order: active ? (sort.order === 'asc' ? 'desc' : 'asc') : (column.firstOrder ?? 'asc'),
    };
    return (
      <button
        type="button"
        onClick={() => onSortChange(next)}
        className={cn(
          'group/sort inline-flex items-center gap-1 text-left transition-colors hover:text-ink',
          column.align === 'right' && 'flex-row-reverse',
          active && 'text-ink',
        )}
        aria-label={`Sort by ${column.label}`}
        title={column.label}
      >
        {text}
        {active ? (
          sort.order === 'asc' ? (
            <ArrowUp size={12} />
          ) : (
            <ArrowDown size={12} />
          )
        ) : (
          <ArrowDown size={12} className="opacity-0 transition-opacity group-hover/sort:opacity-40" />
        )}
      </button>
    );
  };

  const span = columns.length + 1;

  return (
    // `relative`: keeps absolutely-positioned content (a header's sr-only label)
    // inside the scroll box instead of widening the whole page.
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-[13px] tabular-nums">
        <thead>
          <tr className="border-b border-border">
            {columns.map((column, index) => (
              <th
                key={column.id}
                scope="col"
                aria-sort={
                  sort && column.sort === sort.sort
                    ? sort.order === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
                className={cn(
                  CELL,
                  // Headers may take two lines when space is short; cells never do.
                  'whitespace-normal py-2 align-bottom text-xs font-medium leading-tight text-ink-faint',
                  column.align && ALIGN[column.align],
                  pinFirst && index === 0 && 'sticky left-0 z-[1] bg-surface',
                )}
              >
                {header(column)}
              </th>
            ))}
            <th
              scope="col"
              className={cn(CELL, PINNED_END, 'bg-surface py-2 align-bottom text-right text-xs font-medium text-ink-faint')}
            >
              <span className={endLabel.visible ? undefined : 'sr-only'}>{endLabel.text}</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                {columns.map((column) => (
                  <td key={column.id} className={CELL}>
                    <Skeleton className="h-4 w-24" />
                  </td>
                ))}
                <td className={CELL} />
              </tr>
            ))}

          {!isLoading && rows.length === 0 && (
            <tr>
              <td colSpan={span} className="px-5 py-16 text-center text-sm text-ink-muted">
                {empty}
              </td>
            </tr>
          )}

          {!isLoading &&
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                data-testid={rowTestId}
                className="group cursor-pointer transition-colors hover:bg-surface-subtle"
                onClick={(event) => {
                  if (!isInteractive(event)) navigate(rowHref(row));
                }}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.id}
                    className={cn(
                      CELL,
                      'text-ink-muted',
                      column.align && ALIGN[column.align],
                      pinFirst && index === 0 && PINNED_START,
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
                <td className={cn(CELL, PINNED_END, 'bg-surface text-right group-hover:bg-surface-subtle')}>
                  {endCell(row)}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
