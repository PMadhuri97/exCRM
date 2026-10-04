/**
 * The Companies list's columns — Centrex's contact list (Centrex §5), for a
 * company: when it was added, where it came from ("file type" — RXIL or not),
 * its legal name, PAN (where Centrex puts the SSN), its primary contact with cell
 * and email, its **status** (the journey: Lead / Prospect / Customer), its
 * qualification, and how long it has held that status.
 *
 * Centrex's split, kept: *status* is the record's current condition, and a
 * *stage* is where a deal is in the work — that lives on the Deals list.
 *
 * PAN, email and phone arrive already masked for every role that may not reveal
 * them — the server does it. PAN renders through `MaskedValue`, so COMPLIANCE and
 * ADMIN get the same reveal control as everywhere else.
 */

import { Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Chip } from '@/components';
import { MaskedValue } from '@/platform/mask';

import { EXPORTER_SOURCE_LABEL, JOURNEY_LABEL, MARKER_LABEL, QUALIFICATION_LABEL } from '../constants';
import { paths } from '../paths';
import type { CompanySort, ExporterProfileListItem } from '../types';

import { ShortDate, Stacked, Truncated } from './queue-cells';
import { JourneyChip, MarkerBadge, QualificationChip } from './CompanyChips';
import type { QueueColumn } from './QueueTable';

export type CompanyColumnId =
  | 'created'
  | 'source'
  | 'company'
  | 'pan'
  | 'contact'
  | 'cell'
  | 'email'
  | 'status'
  | 'qualification'
  | 'time_in_status'
  | 'owner'
  | 'gstin'
  | 'updated_at';

export type CompanyColumn = QueueColumn<ExporterProfileListItem, CompanySort, CompanyColumnId>;

const DAY_MS = 86_400_000;

/** Whole days the company has held its current status (journey). */
export function daysInStatus(row: ExporterProfileListItem, now: Date = new Date()): number | null {
  if (!row.status_since) return null;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(row.status_since)) / DAY_MS));
}

/** A value the server masked for this viewer (`a•••@domain`, `••••2345`). */
export function isMasked(value: string): boolean {
  return value.includes('•');
}

/** The file type as the table says it — short, since it sits in a narrow column.
 * The full label is on hover and in the exports. */
const SOURCE_SHORT: Partial<Record<ExporterProfileListItem['source'], string>> = {
  MANUAL: 'Manual',
  EXISTING_CUSTOMER: 'Existing',
};

const TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const faint = <span className="text-ink-faint">—</span>;

export const COMPANY_COLUMNS: readonly CompanyColumn[] = [
  {
    id: 'created',
    label: 'Created',
    sort: 'date_added',
    firstOrder: 'desc',
    render: (row) => (
      <Stacked primary={<ShortDate value={row.date_added} />} secondary={TIME.format(new Date(row.date_added))} />
    ),
    text: (row) => row.date_added,
  },
  {
    id: 'source',
    label: 'File type',
    render: (row) =>
      row.source === 'RXIL' ? (
        <Chip tone="brand">RXIL</Chip>
      ) : (
        <span className="text-ink-muted" title={EXPORTER_SOURCE_LABEL[row.source]}>
          {SOURCE_SHORT[row.source] ?? EXPORTER_SOURCE_LABEL[row.source]}
        </span>
      ),
    text: (row) => EXPORTER_SOURCE_LABEL[row.source],
  },
  {
    id: 'company',
    label: 'Business name',
    sort: 'name',
    fixed: true,
    render: (row) => (
      <Stacked
        primary={
          <Link
            to={paths.company(row.customer_id)}
            title={row.name ?? 'Unnamed lead'}
            className="block max-w-[11rem] truncate font-medium text-ink hover:text-brand-600 hover:underline"
          >
            {row.name ?? <span className="italic font-normal text-ink-faint">Unnamed lead</span>}
          </Link>
        }
        secondary={[row.country, row.industry].filter(Boolean).join(' · ') || undefined}
      />
    ),
    text: (row) => row.name ?? '',
  },
  {
    id: 'pan',
    label: 'PAN',
    render: (row) => <MaskedValue value={row.pan} className="text-xs" />,
    text: (row) => row.pan ?? '',
  },
  {
    id: 'contact',
    label: 'Primary contact',
    render: (row) =>
      row.primary_contact_name ? (
        <Truncated title={row.primary_contact_name}>{row.primary_contact_name}</Truncated>
      ) : (
        <span className="text-ink-faint">None yet</span>
      ),
    text: (row) => row.primary_contact_name ?? '',
  },
  {
    id: 'cell',
    label: 'Cell',
    render: (row) =>
      row.primary_contact_phone ? (
        <span className="text-xs tabular-nums">{row.primary_contact_phone}</span>
      ) : (
        faint
      ),
    text: (row) => row.primary_contact_phone ?? '',
  },
  {
    id: 'email',
    label: 'Email',
    align: 'center',
    render: (row) => {
      const email = row.primary_contact_email;
      if (!email) return faint;
      // Live only when it reached this viewer unmasked — a masked address cannot
      // be written to. Otherwise the icon stays, dimmed, with the masked address.
      return isMasked(email) ? (
        <span
          className="inline-flex h-6 w-6 items-center justify-center text-ink-faint/50"
          title={`${email} — masked for your role`}
        >
          <Mail size={15} />
        </span>
      ) : (
        <a
          href={`mailto:${email}`}
          title={email}
          aria-label={`Email ${row.primary_contact_name ?? row.name ?? 'the company'}`}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition hover:bg-surface-sunken hover:text-ink"
        >
          <Mail size={15} />
        </a>
      );
    },
    text: (row) => row.primary_contact_email ?? '',
  },
  {
    id: 'status',
    label: 'Status',
    // The relationship marker (Paused / Ended) sits under the status rather than
    // beside it, so the column stays one chip wide.
    render: (row) => (
      <span className="inline-flex flex-col items-start gap-0.5 leading-tight">
        <JourneyChip journey={row.journey} />
        {row.marker !== 'NONE' && (
          <span className="scale-90 origin-left">
            <MarkerBadge marker={row.marker} reason={row.marker_reason} />
          </span>
        )}
      </span>
    ),
    text: (row) =>
      [JOURNEY_LABEL[row.journey], row.marker !== 'NONE' ? MARKER_LABEL[row.marker] : null]
        .filter(Boolean)
        .join(' · '),
  },
  {
    id: 'qualification',
    label: 'Qualification',
    render: (row) => <QualificationChip state={row.qualification} />,
    text: (row) => QUALIFICATION_LABEL[row.qualification],
  },
  {
    id: 'time_in_status',
    label: 'Time in status',
    shortLabel: 'In status',
    sort: 'status_since',
    // Oldest status first — the ones that have sat longest are the ones to chase.
    firstOrder: 'asc',
    align: 'right',
    render: (row) => {
      const days = daysInStatus(row);
      return days === null ? (
        faint
      ) : (
        <span
          className="font-medium text-ink"
          title={row.status_since ? `Since ${new Date(row.status_since).toDateString()}` : undefined}
        >
          {days} {days === 1 ? 'day' : 'days'}
        </span>
      );
    },
    text: (row) => String(daysInStatus(row) ?? ''),
  },
  // ── Off by default: in Customize, and always in the full report ──
  {
    id: 'owner',
    label: 'Relationship manager',
    hiddenByDefault: true,
    render: (row) => row.relationship_manager ?? faint,
    text: (row) => row.relationship_manager ?? '',
  },
  {
    id: 'gstin',
    label: 'GSTIN',
    hiddenByDefault: true,
    render: (row) => (
      <span className="inline-flex items-center gap-1.5">
        <MaskedValue value={row.gstins[0] ?? null} className="text-xs" />
        {row.gstins.length > 1 && <span className="text-xs text-ink-faint">+{row.gstins.length - 1}</span>}
      </span>
    ),
    text: (row) => row.gstins.join(' '),
  },
  {
    id: 'updated_at',
    label: 'Last updated',
    hiddenByDefault: true,
    align: 'right',
    render: (row) => <ShortDate value={row.updated_at} />,
    text: (row) => row.updated_at,
  },
];
