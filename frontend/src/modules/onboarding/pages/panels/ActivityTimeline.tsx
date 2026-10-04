/**
 * Activity — the client dashboard's timeline (Centrex §8, "Complete Audit
 * History").
 *
 * One list, newest first, of everything that happened with this company: the calls
 * (which way, how it went, how long, with whom, the notes), notes, meetings, emails
 * and follow-ups people logged, and every change the system recorded — journey,
 * qualification, conversation, deals, documents, background check. Each entry has a
 * type badge, what happened, when and who, as Centrex's history does.
 *
 * Read from the two append-only sources that already exist (the activity log and
 * the company history), the latest page of each — the History tab still pages
 * through every recorded change.
 */

import { PhoneCall, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button, EmptySection, Panel, Select, Skeleton } from '@/components';
import { cn } from '@/lib/cn';
import { formatDateTime, humanize } from '@/lib/format';

import { CALL_RESULT_LABEL, formatDuration } from '../../components/call-labels';
import { useCompanyHistory, useExporterActivities } from '../../hooks';
import type { ExporterActivity, ExporterContact, HistoryEntry } from '../../types';

type Filter = 'ALL' | 'CALLS' | 'LOGGED' | 'CHANGES';
const FILTER_LABEL: Record<Filter, string> = {
  ALL: 'All activity',
  CALLS: 'Calls',
  LOGGED: 'Notes, meetings & follow-ups',
  CHANGES: 'Recorded changes',
};

type Item =
  | { kind: 'activity'; at: string; activity: ExporterActivity }
  | { kind: 'change'; at: string; entry: HistoryEntry };

const BADGE: Record<string, string> = {
  CALL: 'bg-brand-50 text-brand-700',
  NOTE: 'bg-surface-sunken text-ink-muted',
  MEETING: 'bg-status-info/10 text-status-info',
  EMAIL: 'bg-status-info/10 text-status-info',
  TASK: 'bg-status-review/10 text-status-review',
  FOLLOW_UP: 'bg-status-review/10 text-status-review',
  CHANGE: 'bg-surface-sunken text-ink-muted',
};

function Badge({ kind, label }: { kind: string; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-24 shrink-0 justify-center rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-wide',
        BADGE[kind] ?? BADGE.CHANGE,
      )}
    >
      {label}
    </span>
  );
}

function changeTitle(entry: HistoryEntry): string {
  const dimension = humanize(entry.dimension);
  if (entry.from_value && entry.to_value && entry.from_value !== entry.to_value) {
    return `${dimension}: ${humanize(entry.from_value)} → ${humanize(entry.to_value)}`;
  }
  if (entry.event_type && !entry.event_type.startsWith('lifecycle')) {
    return `${dimension}: ${humanize(entry.event_type)}`;
  }
  return `${dimension}: ${humanize(entry.to_value)}`;
}

function ActivityRow({ activity, contacts }: { activity: ExporterActivity; contacts: readonly ExporterContact[] }) {
  const isCall = activity.activity_type === 'CALL';
  const contact = activity.contact_id ? contacts.find((c) => c.id === activity.contact_id) : null;
  const DirectionIcon =
    activity.call_direction === 'INBOUND' ? PhoneIncoming : activity.call_direction === 'OUTBOUND' ? PhoneOutgoing : PhoneCall;
  return (
    <li className="flex gap-3 py-3" data-testid="timeline-activity">
      <Badge kind={activity.activity_type} label={humanize(activity.activity_type)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{activity.subject}</p>
        {isCall && (activity.call_result || activity.call_duration_seconds !== null) && (
          <p className="mt-0.5 inline-flex flex-wrap items-center gap-x-2 text-xs text-ink-muted">
            <DirectionIcon size={12} />
            {activity.call_result && <span>{CALL_RESULT_LABEL[activity.call_result]}</span>}
            {activity.call_duration_seconds !== null && <span>· {formatDuration(activity.call_duration_seconds)}</span>}
            {contact && <span>· {contact.name}</span>}
          </p>
        )}
        {activity.notes && <p className="mt-1 whitespace-pre-line text-[13px] text-ink-muted">{activity.notes}</p>}
        <p className="mt-1 text-xs text-ink-faint">
          {formatDateTime(activity.occurred_at)} · {activity.actor_name ?? 'Someone'}
          {activity.due_at && <span className="text-status-review"> · due {formatDateTime(activity.due_at)}</span>}
        </p>
      </div>
    </li>
  );
}

function ChangeRow({ entry }: { entry: HistoryEntry }) {
  return (
    <li className="flex gap-3 py-3" data-testid="timeline-change">
      <Badge kind="CHANGE" label={humanize(entry.dimension)} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{changeTitle(entry)}</p>
        {entry.reason && <p className="mt-0.5 text-[13px] text-ink-muted">{entry.reason}</p>}
        <p className="mt-1 text-xs text-ink-faint">
          {formatDateTime(entry.occurred_at)} · {entry.actor_name ?? 'System'}
        </p>
      </div>
    </li>
  );
}

export function ActivityTimeline({
  customerId,
  contacts,
  canLogCalls,
  onLogCall,
}: {
  customerId: string;
  contacts: readonly ExporterContact[];
  canLogCalls: boolean;
  onLogCall: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('ALL');
  const activities = useExporterActivities(customerId, { limit: 50, offset: 0 });
  const history = useCompanyHistory(customerId, { limit: 50 });

  const items = useMemo<Item[]>(() => {
    const logged: Item[] = (activities.data?.activities ?? [])
      .filter((a) =>
        filter === 'ALL' ? true : filter === 'CALLS' ? a.activity_type === 'CALL' : filter === 'LOGGED' ? a.activity_type !== 'CALL' : false,
      )
      .map((activity) => ({ kind: 'activity', at: activity.occurred_at, activity }));
    const changes: Item[] =
      filter === 'ALL' || filter === 'CHANGES'
        ? (history.data?.entries ?? []).map((entry) => ({ kind: 'change', at: entry.occurred_at, entry }))
        : [];
    return [...logged, ...changes].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [activities.data, history.data, filter]);

  const loading = activities.isLoading || history.isLoading;

  return (
    <Panel
      title="Activity"
      description="Everything that happened with this company — calls, notes, follow-ups and every recorded change — newest first."
      actions={
        <div className="flex items-center gap-2">
          <Select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)} className="h-8 w-56 py-0">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((value) => (
              <option key={value} value={value}>
                {FILTER_LABEL[value]}
              </option>
            ))}
          </Select>
          {canLogCalls && (
            <Button size="sm" variant="primary" onClick={onLogCall}>
              <PhoneCall size={14} /> Log a call
            </Button>
          )}
        </div>
      }
    >
      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      )}
      {!loading && items.length === 0 && <EmptySection>Nothing here yet.</EmptySection>}
      {!loading && items.length > 0 && (
        <ul className="divide-y divide-border/70">
          {items.map((item) =>
            item.kind === 'activity' ? (
              <ActivityRow key={`a-${item.activity.id}`} activity={item.activity} contacts={contacts} />
            ) : (
              <ChangeRow key={`h-${item.entry.id}`} entry={item.entry} />
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}
