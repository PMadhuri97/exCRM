/**
 * Purchase order & invoices — build prompt chunk 2, on the deal page.
 *
 * One deal → exactly one PO → one or more invoices; the deal is not handed
 * over without the PO and at least one invoice (the server says so in the Stage
 * panel's blocked reason, and this panel says it in place).
 *
 * **The PO is recorded from an uploaded document.** Upload it under Paperwork,
 * pick it here, and the form is filled with whatever the configured extractor
 * read from it — or, while none is configured, starts blank for a person to type.
 * Nothing an extractor suggests is saved until someone presses Save.
 *
 * Whether this viewer may record or change anything is the server's `can_edit`
 * (OPERATIONS and ADMIN, on a deal that is not closed) — COMPLIANCE reads only.
 */

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';

import { Button, DetailRow, EmptySection, Field, FormPanel, Input, Panel, Select, Skeleton, Textarea } from '@/components';
import { cn } from '@/lib/cn';
import { formatDate, formatMoney } from '@/lib/format';

import { suggestFields } from '../../api';
import {
  useAddInvoice,
  useDealDocuments,
  usePurchaseOrder,
  useRemoveInvoice,
  useSetPurchaseOrder,
  useUpdateInvoice,
} from '../../hooks';
import type { CrmDocument, Invoice, PurchaseOrder } from '../../types';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// ── The PO form ──────────────────────────────────────────────────────────────

interface PoDraft {
  po_number: string;
  po_date: string;
  currency: string;
  total_amount: string;
  payment_terms: string;
  source_document_id: string;
}

function poDraft(po: PurchaseOrder | null): PoDraft {
  return {
    po_number: po?.po_number ?? '',
    po_date: po?.po_date ?? '',
    currency: po?.currency ?? '',
    total_amount: po?.total_amount ?? '',
    payment_terms: po?.payment_terms ?? '',
    source_document_id: po?.source_document_id ?? '',
  };
}

function DocumentPicker({
  documents,
  value,
  onChange,
  label,
}: {
  documents: CrmDocument[];
  value: string;
  onChange: (documentId: string) => void;
  label: string;
}) {
  return (
    <Field label={label} htmlFor={`doc-${label}`} hint="Upload it under Paperwork first. Pre-shipment documents are listed first.">
      <Select id={`doc-${label}`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">No document — typed by hand</option>
        {[...documents]
          .sort((a, b) => Number(b.category === 'PRE_SHIPMENT') - Number(a.category === 'PRE_SHIPMENT'))
          .map((document) => (
            <option key={document.id} value={document.id} disabled={!document.is_downloadable}>
              {document.file_name}
              {document.is_downloadable ? '' : ' (not scanned clean yet)'}
            </option>
          ))}
      </Select>
    </Field>
  );
}

function PoForm({
  dealId,
  initial,
  documents,
  onClose,
}: {
  dealId: string;
  initial: PurchaseOrder | null;
  documents: CrmDocument[];
  onClose: () => void;
}) {
  const save = useSetPurchaseOrder(dealId);
  const [draft, setDraft] = useState<PoDraft>(() => poDraft(initial));
  const [reading, setReading] = useState(false);
  const set = (field: keyof PoDraft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));

  async function pickDocument(documentId: string) {
    set('source_document_id')(documentId);
    if (!documentId) return;
    setReading(true);
    try {
      const suggestion = await suggestFields(dealId, documentId, 'purchase_order');
      if (suggestion.extractor === null) {
        toast.message('No document reader is set up yet — please type the PO details.');
      } else {
        // Only fill what is still empty: a person's typing is never overwritten.
        setDraft((d) => ({
          ...d,
          po_number: d.po_number || suggestion.fields.po_number || '',
          po_date: d.po_date || suggestion.fields.po_date || '',
          currency: d.currency || suggestion.fields.currency || '',
          total_amount: d.total_amount || suggestion.fields.total_amount || '',
          payment_terms: d.payment_terms || suggestion.fields.payment_terms || '',
        }));
        toast.success(`Read by ${suggestion.extractor} — check every field before saving.`);
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Could not read that document'));
    } finally {
      setReading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await save.mutateAsync({
        po_number: draft.po_number.trim(),
        po_date: draft.po_date,
        currency: draft.currency.trim().toUpperCase(),
        total_amount: draft.total_amount.trim(),
        payment_terms: draft.payment_terms.trim() || null,
        source_document_id: draft.source_document_id || null,
      });
      toast.success(initial ? 'Purchase order updated' : 'Purchase order recorded');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save the purchase order'));
    }
  }

  return (
    <FormPanel title={initial ? 'Correct the purchase order' : 'Record the purchase order'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <DocumentPicker
            documents={documents}
            value={draft.source_document_id}
            onChange={(id) => void pickDocument(id)}
            label="Read from document"
          />
        </div>
        <Field label="PO number" htmlFor="po_number" required>
          <Input id="po_number" required maxLength={100} value={draft.po_number} onChange={(e) => set('po_number')(e.target.value)} />
        </Field>
        <Field label="PO date" htmlFor="po_date" required>
          <Input id="po_date" type="date" required value={draft.po_date} onChange={(e) => set('po_date')(e.target.value)} />
        </Field>
        <Field label="Currency" htmlFor="po_currency" required hint="Three letters, e.g. USD, EUR, INR">
          <Input
            id="po_currency"
            required
            minLength={3}
            maxLength={3}
            pattern="[A-Za-z]{3}"
            value={draft.currency}
            onChange={(e) => set('currency')(e.target.value)}
            disabled={Boolean(initial?.invoices.length)}
            title={initial?.invoices.length ? 'Remove the invoices before changing the currency' : undefined}
          />
        </Field>
        <Field label="Total amount" htmlFor="po_total" required>
          <Input
            id="po_total"
            required
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            value={draft.total_amount}
            onChange={(e) => set('total_amount')(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Payment terms" htmlFor="po_terms">
            <Textarea id="po_terms" rows={2} maxLength={2000} value={draft.payment_terms} onChange={(e) => set('payment_terms')(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={save.isPending || reading}>
            Save purchase order
          </Button>
        </div>
      </form>
    </FormPanel>
  );
}

// ── The invoice form ─────────────────────────────────────────────────────────

interface InvoiceDraft {
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: string;
  source_document_id: string;
}

function InvoiceForm({
  dealId,
  currency,
  initial,
  documents,
  onClose,
}: {
  dealId: string;
  currency: string;
  initial: Invoice | null;
  documents: CrmDocument[];
  onClose: () => void;
}) {
  const add = useAddInvoice(dealId);
  const update = useUpdateInvoice(dealId);
  const [draft, setDraft] = useState<InvoiceDraft>({
    invoice_number: initial?.invoice_number ?? '',
    invoice_date: initial?.invoice_date ?? '',
    due_date: initial?.due_date ?? '',
    amount: initial?.amount ?? '',
    source_document_id: initial?.source_document_id ?? '',
  });
  const set = (field: keyof InvoiceDraft) => (value: string) => setDraft((d) => ({ ...d, [field]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      invoice_number: draft.invoice_number.trim(),
      invoice_date: draft.invoice_date,
      due_date: draft.due_date || null,
      amount: draft.amount.trim(),
      source_document_id: draft.source_document_id || null,
    };
    try {
      if (initial) await update.mutateAsync({ id: initial.id, body });
      else await add.mutateAsync(body);
      toast.success(initial ? 'Invoice updated' : 'Invoice added');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save the invoice'));
    }
  }

  return (
    <FormPanel title={initial ? `Correct invoice ${initial.invoice_number}` : 'Add an invoice'} onClose={onClose}>
      <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
        <Field label="Invoice number" htmlFor="invoice_number" required>
          <Input id="invoice_number" required maxLength={100} value={draft.invoice_number} onChange={(e) => set('invoice_number')(e.target.value)} />
        </Field>
        <Field label={`Amount (${currency})`} htmlFor="invoice_amount" required hint="Invoices are in the PO's currency">
          <Input
            id="invoice_amount"
            required
            inputMode="decimal"
            pattern="\d+(\.\d{1,2})?"
            value={draft.amount}
            onChange={(e) => set('amount')(e.target.value)}
          />
        </Field>
        <Field label="Invoice date" htmlFor="invoice_date" required>
          <Input id="invoice_date" type="date" required value={draft.invoice_date} onChange={(e) => set('invoice_date')(e.target.value)} />
        </Field>
        <Field label="Due date" htmlFor="invoice_due">
          <Input
            id="invoice_due"
            type="date"
            min={draft.invoice_date || undefined}
            value={draft.due_date}
            onChange={(e) => set('due_date')(e.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <DocumentPicker
            documents={documents}
            value={draft.source_document_id}
            onChange={set('source_document_id')}
            label="Invoice document"
          />
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={add.isPending || update.isPending}>
            {initial ? 'Save invoice' : 'Add invoice'}
          </Button>
        </div>
      </form>
    </FormPanel>
  );
}

// ── The panel ────────────────────────────────────────────────────────────────

export function PurchaseOrderPanel({ dealId }: { dealId: string }) {
  const { data, isLoading, isError } = usePurchaseOrder(dealId);
  const documents = useDealDocuments(dealId).data?.documents ?? [];
  const remove = useRemoveInvoice(dealId);
  const [editingPo, setEditingPo] = useState(false);
  const [invoiceForm, setInvoiceForm] = useState<Invoice | 'new' | null>(null);

  const po = data?.purchase_order ?? null;
  const canEdit = data?.can_edit ?? false;
  const documentName = (id: string | null) => documents.find((d) => d.id === id)?.file_name;

  async function removeInvoice(invoice: Invoice) {
    if (!window.confirm(`Remove invoice ${invoice.invoice_number}? It stays in this deal's history.`)) return;
    try {
      await remove.mutateAsync(invoice.id);
      toast.success('Invoice removed');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not remove the invoice'));
    }
  }

  return (
    <Panel
      title="Purchase order & invoices"
      description="What this deal is lending against: one purchase order, and one or more invoices against it."
      actions={
        canEdit &&
        !editingPo && (
          <Button size="sm" variant={po ? 'secondary' : 'primary'} onClick={() => setEditingPo(true)}>
            {po ? (
              <>
                <Pencil size={14} /> Edit PO
              </>
            ) : (
              <>
                <Plus size={14} /> Record the PO
              </>
            )}
          </Button>
        )
      }
    >
      {isLoading && <Skeleton className="h-24 rounded-lg" />}
      {isError && <p className="text-sm text-status-failed">Could not load the purchase order.</p>}

      {editingPo && (
        <PoForm dealId={dealId} initial={po} documents={documents} onClose={() => setEditingPo(false)} />
      )}

      {!isLoading && !isError && !po && !editingPo && (
        <EmptySection>
          No purchase order yet. A deal is not handed over without its PO and at least one invoice.
          {canEdit ? ' Upload the PO under Paperwork, then record it here.' : ''}
        </EmptySection>
      )}

      {po && (
        <div className="space-y-4">
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <DetailRow label="PO number">{po.po_number}</DetailRow>
            <DetailRow label="PO date">{formatDate(po.po_date)}</DetailRow>
            <DetailRow label="Total">{formatMoney(po.total_amount, po.currency)}</DetailRow>
            <DetailRow label="Read from">{documentName(po.source_document_id) ?? '—'}</DetailRow>
            {po.payment_terms && <DetailRow label="Payment terms">{po.payment_terms}</DetailRow>}
          </dl>

          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-subtle p-3 text-sm">
            <div>
              <p className="text-xs text-ink-muted">PO total</p>
              <p className="font-semibold tabular-nums text-ink">{formatMoney(po.total_amount, po.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Invoiced</p>
              <p className="font-semibold tabular-nums text-ink">{formatMoney(po.invoiced_amount, po.currency)}</p>
            </div>
            <div>
              <p className="text-xs text-ink-muted">Not yet invoiced</p>
              <p
                className={cn(
                  'font-semibold tabular-nums',
                  Number(po.uninvoiced_amount) < 0 ? 'text-status-failed' : 'text-ink',
                )}
                title={Number(po.uninvoiced_amount) < 0 ? 'The invoices exceed the PO — a question for verification' : undefined}
              >
                {formatMoney(po.uninvoiced_amount, po.currency)}
              </p>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium text-ink">Invoices ({po.invoices.length})</h3>
              {canEdit && invoiceForm === null && (
                <Button size="sm" onClick={() => setInvoiceForm('new')}>
                  <Plus size={14} /> Add invoice
                </Button>
              )}
            </div>

            {invoiceForm !== null && (
              <InvoiceForm
                dealId={dealId}
                currency={po.currency}
                initial={invoiceForm === 'new' ? null : invoiceForm}
                documents={documents}
                onClose={() => setInvoiceForm(null)}
              />
            )}

            {po.invoices.length === 0 ? (
              <EmptySection>No invoices yet. At least one is needed before the handover.</EmptySection>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-[13px] tabular-nums">
                  <thead>
                    <tr className="border-b border-border text-xs text-ink-faint">
                      <th className="px-3 py-2 font-medium">Invoice</th>
                      <th className="px-3 py-2 font-medium">Issued</th>
                      <th className="px-3 py-2 font-medium">Due</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Document</th>
                      {canEdit && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {po.invoices.map((invoice) => (
                      <tr key={invoice.id} data-testid="invoice-row">
                        <td className="px-3 py-2 font-medium text-ink">{invoice.invoice_number}</td>
                        <td className="px-3 py-2 text-ink-muted">{formatDate(invoice.invoice_date)}</td>
                        <td className="px-3 py-2 text-ink-muted">{invoice.due_date ? formatDate(invoice.due_date) : '—'}</td>
                        <td className="px-3 py-2 text-right text-ink">{formatMoney(invoice.amount, invoice.currency)}</td>
                        <td className="max-w-[10rem] truncate px-3 py-2 text-ink-muted">
                          {documentName(invoice.source_document_id) ?? '—'}
                        </td>
                        {canEdit && (
                          <td className="px-3 py-2 text-right">
                            <span className="inline-flex gap-0.5">
                              <Button size="sm" variant="ghost" aria-label={`Edit invoice ${invoice.invoice_number}`} onClick={() => setInvoiceForm(invoice)}>
                                <Pencil size={14} />
                              </Button>
                              <Button size="sm" variant="ghost" aria-label={`Remove invoice ${invoice.invoice_number}`} onClick={() => void removeInvoice(invoice)}>
                                <Trash2 size={14} />
                              </Button>
                            </span>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
