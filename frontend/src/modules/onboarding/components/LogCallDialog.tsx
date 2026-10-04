/**
 * Log a call — Centrex §6 ("Call Tracking and Follow-up").
 *
 * Centrex opens this from a phone number: who was called and their numbers, the
 * call type (outgoing/incoming), the result, the duration, notes, an optional
 * status update and an optional follow-up call — beside that contact's call
 * history. One Save sends all of it, and the server commits all of it or none: a
 * status move it refuses logs no call, so the person fixes the move and saves once.
 *
 * "Status" here is the conversation gauge (Ready now, Not now, …), offered only as
 * the moves the server lists for this company — a lead has none. The journey is
 * never a status a call can move.
 *
 * Phone numbers are shown as the server sent them: masked for a role that may not
 * see them, and then not dialled from here.
 */

import { Phone, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button, Dialog, Field, Input, Select, Textarea } from '@/components';
import { cn } from '@/lib/cn';
import { formatDateTime, humanize } from '@/lib/format';

import { useExporterActivities, useExporterConversation, useLogCall } from '../hooks';
import type { CallDirection, CallResult, ExporterContact, ExporterConversation } from '../types';

import { CALL_RESULT_LABEL, CALL_RESULTS, formatDuration } from './call-labels';

function isMasked(value: string): boolean {
  return value.includes('•');
}

/** Tomorrow at 10:00 local, as a `datetime-local` value — a sensible default. */
function tomorrowAtTen(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

export function LogCallDialog({
  customerId,
  companyName,
  contacts,
  initialContactId,
  open,
  onOpenChange,
}: {
  customerId: string;
  companyName: string;
  contacts: readonly ExporterContact[];
  initialContactId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const logCall = useLogCall(customerId);
  const conversation = useExporterConversation(open ? customerId : undefined).data;
  const calls = useExporterActivities(open ? customerId : undefined, {
    activityType: 'CALL',
    limit: 20,
    offset: 0,
  }).data?.activities;

  const primary = contacts.find((c) => c.is_primary_contact) ?? contacts[0];
  const [contactId, setContactId] = useState<string>(initialContactId ?? primary?.id ?? '');
  const [direction, setDirection] = useState<CallDirection>('OUTBOUND');
  const [result, setResult] = useState<CallResult | ''>('');
  const [minutes, setMinutes] = useState('0');
  const [seconds, setSeconds] = useState('00');
  const [notes, setNotes] = useState('');
  const [statusTo, setStatusTo] = useState<ExporterConversation | ''>('');
  const [statusReason, setStatusReason] = useState('');
  const [checkBackOn, setCheckBackOn] = useState('');
  const [followUp, setFollowUp] = useState(false);
  const [followUpAt, setFollowUpAt] = useState(tomorrowAtTen);
  const [followUpSubject, setFollowUpSubject] = useState('');

  const contact = contacts.find((c) => c.id === contactId) ?? null;
  const move = conversation?.allowed_moves.find((m) => m.to === statusTo) ?? null;
  const history = useMemo(
    () => (calls ?? []).filter((call) => !contact || call.contact_id === contact.id),
    [calls, contact],
  );

  async function save() {
    if (!result) return;
    try {
      const duration = (Number(minutes) || 0) * 60 + (Number(seconds) || 0);
      await logCall.mutateAsync({
        contact_id: contact?.id ?? null,
        direction,
        result,
        duration_seconds: duration,
        notes: notes.trim() || null,
        status: statusTo
          ? {
              to: statusTo,
              reason: move?.reason_required ? statusReason.trim() : statusReason.trim() || null,
              check_back_on: move?.check_back_required ? checkBackOn : null,
            }
          : null,
        follow_up_at: followUp ? new Date(followUpAt).toISOString() : null,
        follow_up_subject: followUp ? followUpSubject.trim() || null : null,
      });
      toast.success(followUp ? 'Call logged and follow-up scheduled' : 'Call logged');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not log the call');
    }
  }

  const missingMoveDetail =
    Boolean(move?.reason_required && !statusReason.trim()) || Boolean(move?.check_back_required && !checkBackOn);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Log a call${contact ? ` with ${contact.name}` : ''}`}
      description={companyName}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!result || missingMoveDetail}
            loading={logCall.isPending}
            onClick={() => void save()}
          >
            Save call
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_15rem]">
        {/* ── The call ── */}
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Contact" htmlFor="call-contact">
            <Select id="call-contact" value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">No one in particular</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.role ? ` · ${c.role}` : ''}
                  {c.is_primary_contact ? ' (primary)' : ''}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-[auto_1fr] items-end gap-3 sm:grid-cols-[auto_1fr_auto]">
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink">Call type</span>
              <div role="radiogroup" aria-label="Call type" className="inline-flex rounded-lg border border-border p-0.5">
                {(['OUTBOUND', 'INBOUND'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={direction === value}
                    onClick={() => setDirection(value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm',
                      direction === value ? 'bg-surface-sunken font-medium text-ink' : 'text-ink-muted',
                    )}
                  >
                    {value === 'OUTBOUND' ? <PhoneOutgoing size={14} /> : <PhoneIncoming size={14} />}
                    {value === 'OUTBOUND' ? 'Outgoing' : 'Incoming'}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Call result" htmlFor="call-result" required>
              <Select id="call-result" value={result} onChange={(e) => setResult(e.target.value as CallResult)}>
                <option value="">Choose…</option>
                {CALL_RESULTS.map((value) => (
                  <option key={value} value={value}>
                    {CALL_RESULT_LABEL[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink">Duration</span>
              <span className="inline-flex items-center gap-1">
                <Input
                  aria-label="Duration minutes"
                  inputMode="numeric"
                  className="w-14 text-right"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
                <span className="text-ink-muted">:</span>
                <Input
                  aria-label="Duration seconds"
                  inputMode="numeric"
                  className="w-14"
                  value={seconds}
                  onChange={(e) => setSeconds(e.target.value.replace(/\D/g, '').slice(0, 2))}
                />
              </span>
            </div>
          </div>

          <Field label="Notes about this call" htmlFor="call-notes">
            <Textarea id="call-notes" rows={3} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          {/* ── Update the status ── */}
          <Field
            label="Update status"
            htmlFor="call-status"
            hint={
              conversation && conversation.allowed_moves.length === 0
                ? 'No status to change here — a lead has no conversation yet.'
                : conversation
                  ? `Now: ${humanize(conversation.conversation)}`
                  : undefined
            }
          >
            <Select
              id="call-status"
              value={statusTo}
              disabled={!conversation || conversation.allowed_moves.length === 0}
              onChange={(e) => setStatusTo(e.target.value as ExporterConversation | '')}
            >
              <option value="">Leave as it is</option>
              {conversation?.allowed_moves.map((m) => (
                <option key={m.to} value={m.to}>
                  {humanize(m.to)}
                </option>
              ))}
            </Select>
          </Field>
          {move && (move.reason_required || move.check_back_required) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {move.reason_required && (
                <Field label="Why" htmlFor="call-status-reason" required>
                  <Input id="call-status-reason" value={statusReason} onChange={(e) => setStatusReason(e.target.value)} />
                </Field>
              )}
              {move.check_back_required && (
                <Field label="Check back on" htmlFor="call-check-back" required>
                  <Input id="call-check-back" type="date" value={checkBackOn} onChange={(e) => setCheckBackOn(e.target.value)} />
                </Field>
              )}
            </div>
          )}

          {/* ── Follow-up call ── */}
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
            Schedule a follow-up call
          </label>
          {followUp && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="When" htmlFor="call-follow-up-at">
                <Input id="call-follow-up-at" type="datetime-local" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} />
              </Field>
              <Field label="What for" htmlFor="call-follow-up-subject" hint="Shows on your Follow-ups list">
                <Input
                  id="call-follow-up-subject"
                  maxLength={500}
                  placeholder={contact ? `Call ${contact.name} back` : 'Follow-up call'}
                  value={followUpSubject}
                  onChange={(e) => setFollowUpSubject(e.target.value)}
                />
              </Field>
            </div>
          )}
        </form>

        {/* ── Numbers and call history ── */}
        <aside className="space-y-4 rounded-lg border border-border bg-surface-subtle p-3 text-sm">
          <section aria-label="Phone numbers">
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">Numbers</h3>
            {contact?.phone ? (
              isMasked(contact.phone) ? (
                <p className="font-mono text-xs text-ink-muted" title="Masked for your role">
                  {contact.phone}
                </p>
              ) : (
                <a href={`tel:${contact.phone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 font-medium text-brand-700 hover:underline">
                  <Phone size={13} /> {contact.phone}
                </a>
              )
            ) : (
              <p className="text-ink-faint">No number on file</p>
            )}
            {contact?.email && <p className="mt-1 truncate text-xs text-ink-muted">{contact.email}</p>}
          </section>
          <section aria-label="Call history">
            <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
              Call history{contact ? ` · ${contact.name}` : ''}
            </h3>
            {history.length === 0 ? (
              <p className="text-ink-faint">No calls logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {history.slice(0, 6).map((call) => (
                  <li key={call.id} className="text-xs">
                    <p className="font-medium text-ink">
                      {call.actor_name ?? 'Someone'} · {formatDateTime(call.occurred_at)}
                    </p>
                    <p className="text-ink-muted">
                      {call.call_direction === 'INBOUND' ? 'Incoming' : call.call_direction === 'OUTBOUND' ? 'Outgoing' : 'Call'}{' '}
                      {formatDuration(call.call_duration_seconds)}
                      {call.call_result ? ` · ${CALL_RESULT_LABEL[call.call_result]}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </Dialog>
  );
}
