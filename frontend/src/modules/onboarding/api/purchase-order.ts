/**
 * A deal's purchase order and invoices — build prompt chunk 2.
 *
 * One deal → exactly one PO → one or more invoices. Every call answers with the
 * whole paperwork (the PO, its invoices and the server's `can_edit`), so a screen
 * never patches its own copy after a write.
 */

import { apiRequest } from '@/lib/api/client';

import type {
  DealPaperwork,
  ExtractedFields,
  InvoiceRequest,
  SetPurchaseOrderRequest,
} from '../types';

const base = (dealId: string) => `/onboarding/deals/${dealId}/purchase-order`;

export function getPurchaseOrder(dealId: string): Promise<DealPaperwork> {
  return apiRequest<DealPaperwork>(base(dealId));
}

/** Record the PO, or correct it — one per deal, so a `PUT`. */
export function setPurchaseOrder(dealId: string, body: SetPurchaseOrderRequest): Promise<DealPaperwork> {
  return apiRequest<DealPaperwork>(base(dealId), { method: 'PUT', body });
}

export function addInvoice(dealId: string, body: InvoiceRequest): Promise<DealPaperwork> {
  return apiRequest<DealPaperwork>(`${base(dealId)}/invoices`, { method: 'POST', body });
}

export function updateInvoice(
  dealId: string,
  invoiceId: string,
  body: InvoiceRequest,
): Promise<DealPaperwork> {
  return apiRequest<DealPaperwork>(`${base(dealId)}/invoices/${invoiceId}`, { method: 'PUT', body });
}

export function removeInvoice(dealId: string, invoiceId: string): Promise<DealPaperwork> {
  return apiRequest<DealPaperwork>(`${base(dealId)}/invoices/${invoiceId}`, { method: 'DELETE' });
}

/** What the configured extractor reads from one of the deal's documents —
 * suggestions to confirm. Empty while no extractor is configured. */
export function suggestFields(
  dealId: string,
  documentId: string,
  kind: 'purchase_order' | 'invoice',
): Promise<ExtractedFields> {
  const query = new URLSearchParams({ document_id: documentId, kind });
  return apiRequest<ExtractedFields>(`${base(dealId)}/suggestions?${query.toString()}`);
}
