/**
 * The two cell shapes the Deals table's columns are built from. Components
 * only, kept apart from `deal-columns.tsx` (react-refresh's rule).
 */

import type { ReactNode } from 'react';

import { formatDate } from '@/lib/format';

/** One line, cut off with the full text on hover — never wrapped. */
export function Truncated({ children, title }: { children: ReactNode; title: string }) {
  return (
    <span title={title} className="block max-w-[13rem] truncate text-ink">
      {children}
    </span>
  );
}

/** A primary line over a muted secondary one — both truncate, neither wraps, and
 * the pair is capped so a long secondary line cannot widen its column. */
export function Stacked({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <span className="flex min-w-0 max-w-[13rem] flex-col leading-tight">
      {primary}
      {secondary && <span className="mt-0.5 truncate text-xs text-ink-faint">{secondary}</span>}
    </span>
  );
}

const SHORT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const SHORT_WITH_YEAR = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** "30 Sep" this year, "30 Sep 2025" otherwise — the full date on hover. A
 * table's dates are scanned, not read, and the year is noise until it differs. */
export function ShortDate({ value }: { value: string }) {
  const date = new Date(value);
  const label = (date.getFullYear() === new Date().getFullYear() ? SHORT : SHORT_WITH_YEAR).format(date);
  return <time dateTime={value} title={formatDate(value)}>{label}</time>;
}
