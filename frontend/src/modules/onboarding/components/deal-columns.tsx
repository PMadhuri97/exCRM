/**
 * The Deals table's columns — what each shows, how it sorts, and its CSV text.
 *
 * Kept apart from `DealsTable.tsx` so the component file exports only the
 * component. One list, so the table, Customize and both exports can never
 * disagree about what a column is.
 *
 * **No cell wraps.** A cell is one line, or a fixed primary-over-secondary pair
 * (the deal over its id, the company over its journey, the buyer over its
 * country, the opening date over how long it has been open) — so every row is
 * the same height however long a name is. Long names truncate with the full text
 * on hover. Stacking is how the table carries more than its column count.
 *
 * Money comes from the deal's purchase order (chunk 2): its total, and how
 * much of it is invoiced. A deal without a PO says so — nothing is estimated.
 */

import { Link } from 'react-router-dom';

import { formatMoney } from '@/lib/format';

import { DEAL_STAGE_LABEL, JOURNEY_LABEL } from '../constants';
import { paths } from '../paths';
import type {
  BackgroundCheckState,
  DealQueueItem,
  DealQueueSort,
  ExporterJourney,
} from '../types';

import { ShortDate, Stacked, Truncated } from './queue-cells';
import { BackgroundCheckChip } from './BackgroundCheckGauge';
import { BACKGROUND_CHECK_LABEL } from './background-check-labels';
import { JourneyChip } from './CompanyChips';
import { DealStageChip } from './DealStageChip';
import type { QueueColumn } from './QueueTable';

export type DealColumnId =
  | 'reference'
  | 'company'
  | 'buyer'
  | 'stage'
  | 'amount'
  | 'journey'
  | 'background_check'
  | 'created_at'
  | 'days_open'
  | 'handed_over_at'
  | 'updated_at';

/** One column of the Deals table — the shared queue column, for a deal. */
export type DealColumn = QueueColumn<DealQueueItem, DealQueueSort, DealColumnId>;

const DAY_MS = 86_400_000;

/**
 * Whole days the deal has been, or was, in play: to its handover, to its
 * withdrawal (its last change), or to now while it is live.
 */
export function daysOpen(row: DealQueueItem, now: Date = new Date()): number {
  const end =
    row.handed_over_at ??
    (row.stage === 'WITHDRAWN' ? row.updated_at : null) ??
    now.toISOString();
  return Math.max(0, Math.floor((Date.parse(end) - Date.parse(row.created_at)) / DAY_MS));
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/** Up to two initials, for the company's avatar. */
export function initials(name: string | null): string {
  if (!name) return '?';
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** The deal's own id, short — enough to say on a call or find again. */
export function shortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

const faint = <span className="text-ink-faint">—</span>;

export const DEAL_COLUMNS: readonly DealColumn[] = [
  {
    id: 'reference',
    label: 'Deal',
    sort: 'reference',
    fixed: true,
    render: (row) => (
      <Stacked
        primary={
          <Link
            to={paths.deal(row.id)}
            title={row.reference}
            className="block max-w-[13rem] truncate font-medium text-ink hover:text-brand-600 hover:underline"
          >
            {row.reference}
          </Link>
        }
        secondary={<span className="font-mono tracking-tight">#{shortId(row.id)}</span>}
      />
    ),
    text: (row) => row.reference,
  },
  {
    id: 'company',
    label: 'Company',
    sort: 'company_name',
    render: (row) => (
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700"
        >
          {initials(row.company_name)}
        </span>
        <Stacked
          primary={
            <Link
              to={paths.company(row.company_id)}
              title={row.company_name ?? 'Unnamed company'}
              className="block max-w-[12rem] truncate text-ink hover:text-brand-600 hover:underline"
            >
              {row.company_name ?? <span className="italic text-ink-faint">Unnamed company</span>}
            </Link>
          }
          secondary={JOURNEY_LABEL[row.company_journey as ExporterJourney] ?? row.company_journey}
        />
      </span>
    ),
    text: (row) => row.company_name ?? '',
  },
  {
    id: 'buyer',
    label: 'Buyer',
    render: (row) =>
      row.buyer_name ? (
        <Stacked
          primary={<Truncated title={row.buyer_name}>{row.buyer_name}</Truncated>}
          secondary={row.buyer_country}
        />
      ) : (
        <span className="text-ink-faint">Not recorded</span>
      ),
    text: (row) => [row.buyer_name, row.buyer_country].filter(Boolean).join(' · '),
  },
  {
    id: 'stage',
    label: 'Stage',
    sort: 'stage',
    render: (row) => <DealStageChip stage={row.stage} />,
    text: (row) => DEAL_STAGE_LABEL[row.stage],
  },
  {
    id: 'amount',
    label: 'Amount',
    align: 'right',
    // The PO's total (chunk 2), and how much of it is invoiced so far — Centrex's
    // Amount column, from the deal's own purchase order, never estimated.
    render: (row) => {
      if (!row.po_total || !row.po_currency) return <span className="text-ink-faint">No PO yet</span>;
      const invoiced = Number(row.invoiced_total ?? 0);
      const share = Math.round((invoiced / Number(row.po_total)) * 100);
      return (
        <span className="inline-flex flex-col items-end leading-tight">
          <span className="font-medium text-ink">{formatMoney(row.po_total, row.po_currency)}</span>
          <span className="mt-0.5 text-xs text-ink-faint">
            {row.invoice_count === 0
              ? 'no invoice yet'
              : `${plural(row.invoice_count, 'invoice')} · ${share}% invoiced`}
          </span>
        </span>
      );
    },
    text: (row) => (row.po_total && row.po_currency ? `${row.po_currency} ${row.po_total}` : ''),
  },
  {
    id: 'journey',
    label: 'Journey',
    // Already under the company's name; a column of its own for the full report.
    hiddenByDefault: true,
    render: (row) => <JourneyChip journey={row.company_journey as ExporterJourney} />,
    text: (row) => JOURNEY_LABEL[row.company_journey as ExporterJourney] ?? row.company_journey,
  },
  {
    id: 'background_check',
    label: 'Check',
    underwritingOnly: true,
    render: (row) =>
      row.company_background_check ? (
        <BackgroundCheckChip value={row.company_background_check as BackgroundCheckState} />
      ) : (
        faint
      ),
    text: (row) =>
      row.company_background_check
        ? (BACKGROUND_CHECK_LABEL[row.company_background_check as BackgroundCheckState] ??
          row.company_background_check)
        : '',
  },
  {
    id: 'created_at',
    label: 'Opened',
    sort: 'created_at',
    firstOrder: 'desc',
    align: 'right',
    render: (row) => {
      const days = daysOpen(row);
      const closed = row.stage === 'HANDED_OVER' || row.stage === 'WITHDRAWN';
      return (
        <span className="inline-flex flex-col items-end leading-tight">
          <ShortDate value={row.created_at} />
          <span className="mt-0.5 text-xs text-ink-faint">
            {closed ? `took ${plural(days, 'day')}` : `${plural(days, 'day')} open`}
          </span>
        </span>
      );
    },
    text: (row) => row.created_at,
  },
  {
    id: 'days_open',
    label: 'Days open',
    align: 'right',
    hiddenByDefault: true,
    render: (row) => <span className="font-medium text-ink">{daysOpen(row)}</span>,
    text: (row) => String(daysOpen(row)),
  },
  {
    id: 'handed_over_at',
    label: 'Handed over',
    align: 'right',
    hiddenByDefault: true,
    render: (row) => (row.handed_over_at ? <ShortDate value={row.handed_over_at} /> : faint),
    text: (row) => row.handed_over_at ?? '',
  },
  {
    id: 'updated_at',
    label: 'Last activity',
    sort: 'updated_at',
    firstOrder: 'desc',
    align: 'right',
    // Room for Amount at 1440px; "Opened" already says how long it has been open.
    hiddenByDefault: true,
    render: (row) => <ShortDate value={row.updated_at} />,
    text: (row) => row.updated_at,
  },
];
