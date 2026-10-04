/**
 * Deals and buyers — **owner: Developer 3B** (L3-05, L3-06).
 *
 * Created as a stub in the seam commit, together with its
 * `export * from './deals'` line in `api/index.ts`, and filled here — so the
 * barrel, which every owner shares, was never opened twice.
 *
 * **Seam S2 lives here.** Developer 3A's Conversation panel offers to open a deal
 * when the gauge is `READY_NOW`; it imports `openDeal` and `useOpenDeal` through
 * the barrel (`../../api`, `../../hooks`), never from this file directly, and
 * defines no deal request function or deal type of its own (prompt §4.2).
 *
 * A deal's own paths are absolute (`/onboarding/deals/...`) because a deal is its
 * own thing, not a company sub-resource; only the list hangs off a company, which
 * reads as what it is — the deals *of* a company.
 */

import { apiRequest } from '@/lib/api/client';

import type {
  Deal,
  DealList,
  DealListParams,
  DealQueue,
  DealQueueParams,
  DealSummary,
  OpenDealRequest,
  SetDealBuyerRequest,
  TransitionDealStageRequest,
} from '../types';

/**
 * Open a deal on a company.
 *
 * Also sets the company's conversation to `READY_NOW`, server-side and in the same
 * transaction (architecture §3.3) — so a caller that shows the conversation gauge
 * has to refresh it afterwards. `useOpenDeal` does exactly that.
 *
 * No stage: a deal always starts at `OPEN`, and the request has no field for one.
 */
export function openDeal(
  companyId: string,
  body: OpenDealRequest,
): Promise<Deal> {
  return apiRequest<Deal>(`/onboarding/exporters/${companyId}/deals`, {
    method: 'POST',
    body,
  });
}

/** One company's deals, newest first. Every stage unless `stages` narrows it —
 * withdrawn and handed-over deals are part of the company's record. */
export function listCompanyDeals(
  companyId: string,
  params: DealListParams = {},
): Promise<DealList> {
  const query = new URLSearchParams();
  for (const stage of params.stages ?? []) query.append('stage', stage);
  query.set('limit', String(params.limit ?? 50));
  query.set('offset', String(params.offset ?? 0));
  return apiRequest<DealList>(
    `/onboarding/exporters/${companyId}/deals?${query.toString()}`,
  );
}

/**
 * Every company's deals — the Deals list. Filtering, search, sorting and the
 * per-stage tab counts all happen on the server.
 */
export function listDeals(params: DealQueueParams = {}): Promise<DealQueue> {
  const query = new URLSearchParams();
  for (const stage of params.stages ?? []) query.append('stage', stage);
  if (params.q) query.set('q', params.q);
  if (params.companyId) query.set('company_id', params.companyId);
  if (params.openedFrom) query.set('opened_from', params.openedFrom);
  if (params.openedTo) query.set('opened_to', params.openedTo);
  if (params.sort) query.set('sort', params.sort);
  if (params.order) query.set('order', params.order);
  query.set('limit', String(params.limit ?? 50));
  query.set('offset', String(params.offset ?? 0));
  return apiRequest<DealQueue>(`/onboarding/deals?${query.toString()}`);
}

/** The KPI bar over the Deals list; the last 30 days unless a period is given. */
export function getDealSummary(period: { from?: string; to?: string } = {}): Promise<DealSummary> {
  const query = new URLSearchParams();
  if (period.from) query.set('from', period.from);
  if (period.to) query.set('to', period.to);
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiRequest<DealSummary>(`/onboarding/deals/summary${suffix}`);
}

/**
 * One deal, its buyer, and the moves allowed from here.
 *
 * `allowed_stage_moves` is what this deal may do next, as data; a handover that is
 * blocked by assumption A5's guard is absent from it and
 * `handover_blocked_reason` says why, so a screen explains rather than offering a
 * button that 409s.
 */
export function getDeal(dealId: string): Promise<Deal> {
  return apiRequest<Deal>(`/onboarding/deals/${dealId}`);
}

/** Move a deal's stage. `reason` is required for `WITHDRAWN` and refused for
 * anything else — the server words every refusal, and the caller shows it. */
export function transitionDealStage(
  dealId: string,
  body: TransitionDealStageRequest,
): Promise<Deal> {
  return apiRequest<Deal>(`/onboarding/deals/${dealId}/transitions`, {
    method: 'POST',
    body,
  });
}

/** Record or replace the deal's buyer. One buyer per deal, so this is a `PUT`:
 * it replaces that one row rather than adding another. */
export function setDealBuyer(
  dealId: string,
  body: SetDealBuyerRequest,
): Promise<Deal> {
  return apiRequest<Deal>(`/onboarding/deals/${dealId}/buyer`, {
    method: 'PUT',
    body,
  });
}
