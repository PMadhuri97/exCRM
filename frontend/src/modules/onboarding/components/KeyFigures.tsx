/**
 * The key figures — build prompt chunks 0.5 (Home) and 1 (Deals).
 *
 * Every number is the server's (`GET /onboarding/deals/summary`); nothing is
 * counted here. A failed or loading summary shows no numbers at all rather than
 * zeros, because a zero is a claim. No open value yet: deals carry PO totals now
 * (chunk 2), but in more than one currency, and a sum across currencies would be
 * a number that means nothing.
 *
 * With `linked`, each figure opens the list it counts — Home's use, so the strip
 * is a way into the work, not only a report on it.
 */

import { Link } from 'react-router-dom';

import { Skeleton } from '@/components';
import { cn } from '@/lib/cn';

import { useDealSummary } from '../hooks';
import { paths } from '../paths';

function Figure({
  label,
  value,
  caption,
  to,
}: {
  label: string;
  value: string;
  caption: string;
  to?: string;
}) {
  const body = (
    <>
      <p className="truncate text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold leading-none tracking-tight text-ink tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 truncate text-xs text-ink-faint" title={caption}>
        {caption}
      </p>
    </>
  );
  const box = 'block min-w-0 rounded-xl border border-border bg-surface px-4 py-3';
  return to ? (
    <Link to={to} className={cn(box, 'transition-colors hover:border-brand-500')}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

export function KeyFigures({ linked = false, className }: { linked?: boolean; className?: string }) {
  const { data: summary, isLoading } = useDealSummary();

  if (isLoading) {
    return (
      <div className={cn('grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5', className)}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[88px] rounded-xl" />
        ))}
      </div>
    );
  }
  if (!summary) return null;

  // The server sends every stage; the schema types a dict's values as optional.
  const open = summary.stage_counts.OPEN ?? 0;
  const gathering = summary.stage_counts.GATHERING_PAPERWORK ?? 0;
  // A role refused the background check (D8) gets the count of deals opened
  // under its own name — never a "Checks cleared" figure it can't fill.
  const checksVisible = summary.deals_opened_checks_clear !== null;
  const link = (to: string) => (linked ? to : undefined);

  return (
    <section aria-label="Key figures" className={className}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Figure
          label="Live deals"
          value={String(open + gathering)}
          caption={`${gathering} gathering paperwork`}
          to={link(paths.deals)}
        />
        <Figure
          label="New leads"
          value={String(summary.new_leads)}
          caption="Companies added · 30 days"
          to={link(`${paths.companies}?journey=LEAD`)}
        />
        <Figure
          label="New customers"
          value={String(summary.new_customers)}
          caption="Reached Customer · 30 days"
          to={link(`${paths.companies}?journey=CUSTOMER`)}
        />
        <Figure
          label={checksVisible ? 'Checks cleared' : 'Deals opened'}
          value={
            checksVisible
              ? `${summary.deals_opened_checks_clear} / ${summary.deals_opened}`
              : String(summary.deals_opened)
          }
          caption={checksVisible ? 'Opened with the company cleared' : 'Opened · 30 days'}
          to={link(paths.deals)}
        />
        <Figure
          label="Avg. turnaround"
          value={summary.average_turnaround_days === null ? '—' : `${summary.average_turnaround_days} d`}
          caption="Opened → handed over"
          to={link(`${paths.deals}?stage=HANDED_OVER`)}
        />
      </div>
    </section>
  );
}
