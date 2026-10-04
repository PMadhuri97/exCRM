/**
 * React Query hooks for a deal's purchase order and invoices — build prompt
 * chunk 2.
 *
 * Every write answers with the whole paperwork, which goes straight into the
 * cache. It also invalidates the deal (its handover may have just become possible
 * or impossible — the server's `handover_blocked_reason` names a missing PO or
 * invoice), the deal's history, and the Deals list (its amount column).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { addInvoice, getPurchaseOrder, removeInvoice, setPurchaseOrder, updateInvoice } from '../api';
import type { DealPaperwork, InvoiceRequest, SetPurchaseOrderRequest } from '../types';

export function usePurchaseOrder(dealId: string | undefined) {
  return useQuery({
    queryKey: ['purchaseOrder', dealId],
    queryFn: () => getPurchaseOrder(dealId!),
    enabled: Boolean(dealId),
  });
}

function usePaperworkWrite<Vars>(dealId: string, write: (vars: Vars) => Promise<DealPaperwork>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: (paperwork) => {
      queryClient.setQueryData(['purchaseOrder', dealId], paperwork);
      void queryClient.invalidateQueries({ queryKey: ['deal', dealId] });
      void queryClient.invalidateQueries({ queryKey: ['dealHistory', dealId] });
      void queryClient.invalidateQueries({ queryKey: ['dealQueue'] });
    },
  });
}

export function useSetPurchaseOrder(dealId: string) {
  return usePaperworkWrite(dealId, (body: SetPurchaseOrderRequest) => setPurchaseOrder(dealId, body));
}

export function useAddInvoice(dealId: string) {
  return usePaperworkWrite(dealId, (body: InvoiceRequest) => addInvoice(dealId, body));
}

export function useUpdateInvoice(dealId: string) {
  return usePaperworkWrite(dealId, ({ id, body }: { id: string; body: InvoiceRequest }) =>
    updateInvoice(dealId, id, body),
  );
}

export function useRemoveInvoice(dealId: string) {
  return usePaperworkWrite(dealId, (id: string) => removeInvoice(dealId, id));
}
