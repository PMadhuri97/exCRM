/**
 * The company's summary — the left column of the client dashboard (Centrex §8,
 * "Client Dashboard": standard information and assignments on the left, activity
 * on the right).
 *
 * Everything someone needs before picking up the phone, in one place: whether the
 * relationship is paused or ended, where the company stands (journey, how long,
 * qualification, conversation, background check), who to call and a way to log
 * that call, its identifiers, who owns it, where it came from, and what it has on
 * the deal book. Nothing here is computed beyond a day count: every value is the
 * server's, and identifiers and contact details arrive masked for roles that may
 * not see them.
 */

import { AlertTriangle, CalendarClock, ExternalLink, Mail, Phone, PhoneCall } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Button, Chip } from '@/components';
import { formatDate, formatMoney, humanize } from '@/lib/format';
import { MaskedValue } from '@/platform/mask';

import { BackgroundCheckChip, JourneyChip, QualificationChip } from '../../components';
import { EXPORTER_SOURCE_LABEL } from '../../constants';
import { useBackgroundCheck, useCompanyHistory, useDealQueue, useExporterConversation } from '../../hooks';
import { paths } from '../../paths';
import type { ExporterContact, ExporterProfileDetail } from '../../types';

const DAY_MS = 86_400_000;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-border px-4 py-3 first:border-t-0">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-faint">{title}</h3>
      <dl className="space-y-1.5">{children}</dl>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-[13px]">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="min-w-0 truncate text-ink">{children}</dd>
    </div>
  );
}

function isMasked(value: string): boolean {
  return value.includes('•');
}

export function CompanySummaryCard({
  profile,
  contacts,
  canLogCalls,
  canViewChecks,
  onLogCall,
}: {
  profile: ExporterProfileDetail;
  contacts: readonly ExporterContact[];
  /** Staff log calls; FINANCER and DEVELOPER read. */
  canLogCalls: boolean;
  canViewChecks: boolean;
  onLogCall: (contactId: string | null) => void;
}) {
  const customerId = profile.customer_id;
  const conversation = useExporterConversation(customerId).data;
  const check = useBackgroundCheck(canViewChecks ? customerId : undefined).data;
  const journeyRows = useCompanyHistory(customerId, { dimension: 'journey', limit: 1 }).data?.entries;
  const deals = useDealQueue({ companyId: customerId, limit: 100 }).data?.deals ?? [];

  const primary = contacts.find((c) => c.is_primary_contact) ?? contacts[0] ?? null;
  const since = journeyRows?.[0]?.occurred_at ?? profile.date_added;
  const daysInStatus = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / DAY_MS));

  const live = deals.filter((d) => d.stage === 'OPEN' || d.stage === 'GATHERING_PAPERWORK');
  // PO totals of live deals, per currency — never summed across currencies.
  const liveTotals = new Map<string, number>();
  for (const deal of live) {
    if (deal.po_total && deal.po_currency) {
      liveTotals.set(deal.po_currency, (liveTotals.get(deal.po_currency) ?? 0) + Number(deal.po_total));
    }
  }

  return (
    <aside aria-label="Company summary" className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      {profile.marker !== 'NONE' && (
        <div
          role="status"
          className={
            profile.marker === 'ENDED'
              ? 'flex items-start gap-2 bg-status-failed/10 px-4 py-2.5 text-[13px] text-status-failed'
              : 'flex items-start gap-2 bg-status-review/10 px-4 py-2.5 text-[13px] text-status-review'
          }
        >
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold">
              {profile.marker === 'ENDED' ? 'This relationship has ended.' : 'This relationship is paused.'}
            </strong>
            {profile.marker_reason ? ` ${profile.marker_reason}` : ''}
          </span>
        </div>
      )}

      {/* ── Who and where they stand ── */}
      <div className="px-4 pt-4 pb-3">
        <p className="text-base font-semibold leading-tight text-ink">{profile.name ?? 'Unnamed company'}</p>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          {[profile.industry, profile.country].filter(Boolean).join(' · ') || 'No industry or country yet'}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <JourneyChip journey={profile.journey} />
          <span
            className="rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink-muted"
            title={`In this status since ${formatDate(since)}`}
          >
            {daysInStatus} {daysInStatus === 1 ? 'day' : 'days'}
          </span>
          <QualificationChip state={profile.qualification} />
          {check && <BackgroundCheckChip value={check.value} />}
        </div>
      </div>

      <Section title="Contact">
        {primary ? (
          <>
            <Row label="Primary">
              {primary.name}
              {primary.role && <span className="text-ink-muted"> · {primary.role}</span>}
            </Row>
            <Row label="Cell">
              {primary.phone ? (
                isMasked(primary.phone) ? (
                  <span className="font-mono text-xs text-ink-muted" title="Masked for your role">
                    {primary.phone}
                  </span>
                ) : (
                  <a href={`tel:${primary.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                    <Phone size={12} /> {primary.phone}
                  </a>
                )
              ) : (
                <span className="text-ink-faint">—</span>
              )}
            </Row>
            <Row label="Email">
              {primary.email ? (
                isMasked(primary.email) ? (
                  <span className="font-mono text-xs text-ink-muted" title="Masked for your role">
                    {primary.email}
                  </span>
                ) : (
                  <a href={`mailto:${primary.email}`} className="inline-flex items-center gap-1 hover:text-brand-600">
                    <Mail size={12} /> {primary.email}
                  </a>
                )
              ) : (
                <span className="text-ink-faint">—</span>
              )}
            </Row>
            {contacts.length > 1 && (
              <Row label="Others">
                <Link to={paths.company(customerId, 'conversation')} className="text-brand-700 hover:underline">
                  {contacts.length - 1} more {contacts.length === 2 ? 'contact' : 'contacts'}
                </Link>
              </Row>
            )}
          </>
        ) : (
          <p className="text-[13px] text-ink-faint">No contacts yet.</p>
        )}
        {canLogCalls && (
          <Button size="sm" variant="primary" className="mt-2 w-full" onClick={() => onLogCall(primary?.id ?? null)}>
            <PhoneCall size={14} /> Log a call
          </Button>
        )}
      </Section>

      <Section title="Relationship">
        <Row label="Conversation">
          {conversation ? (
            <span className="inline-flex items-center gap-1.5">
              {humanize(conversation.conversation)}
              {conversation.check_back_on && (
                <span className="inline-flex items-center gap-0.5 text-xs text-status-review">
                  <CalendarClock size={12} /> {formatDate(conversation.check_back_on)}
                </span>
              )}
            </span>
          ) : (
            '—'
          )}
        </Row>
        <Row label="Assigned to">{profile.relationship_manager ?? <span className="text-ink-faint">Nobody yet</span>}</Row>
        <Row label="File type">
          {profile.source === 'RXIL' ? <Chip tone="brand">RXIL</Chip> : EXPORTER_SOURCE_LABEL[profile.source]}
        </Row>
        <Row label="Created">{formatDate(profile.date_added)}</Row>
        <Row label="Modified">{formatDate(profile.updated_at)}</Row>
      </Section>

      <Section title="Identifiers">
        <Row label="Customer ID">
          <span className="font-mono text-xs">{customerId.replace(/-/g, '').slice(0, 8).toUpperCase()}</span>
        </Row>
        <Row label="PAN">
          <MaskedValue value={profile.pan} className="text-xs" />
        </Row>
        <Row label="GSTIN">
          <MaskedValue value={profile.gstins[0] ?? null} className="text-xs" />
          {profile.gstins.length > 1 && <span className="ml-1 text-xs text-ink-faint">+{profile.gstins.length - 1}</span>}
        </Row>
        <Row label="IEC">
          <MaskedValue value={profile.iec} className="text-xs" />
        </Row>
        <Row label="CIN">
          <MaskedValue value={profile.cin} className="text-xs" />
        </Row>
      </Section>

      <Section title="Business">
        <Row label="Established">{profile.year_established ?? '—'}</Row>
        <Row label="Website">
          {/* Linked only when it is http(s): a value stored before the server
              refused other schemes (`javascript:` …) stays text, never a link. */}
          {profile.website && !/^https?:\/\//i.test(profile.website) ? (
            <span className="text-ink-muted">{profile.website}</span>
          ) : profile.website ? (
            <a href={profile.website} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
              {profile.website.replace(/^https?:\/\//, '')} <ExternalLink size={11} />
            </a>
          ) : (
            '—'
          )}
        </Row>
        <Row label="Markets">{profile.export_markets?.length ? profile.export_markets.join(', ') : '—'}</Row>
        <Row label="Products">{profile.products?.length ? profile.products.join(', ') : '—'}</Row>
      </Section>

      <Section title="Deals">
        <Row label="On the book">
          <Link to={paths.company(customerId, 'deals')} className="text-brand-700 hover:underline">
            {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
          </Link>
          {live.length > 0 && <span className="text-ink-muted"> · {live.length} live</span>}
        </Row>
        <Row label="Live PO value">
          {liveTotals.size === 0
            ? '—'
            : [...liveTotals].map(([currency, total]) => formatMoney(total, currency)).join(' · ')}
        </Row>
      </Section>
    </aside>
  );
}
