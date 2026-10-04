/**
 * Saved lists — build prompt chunk 3. A list holds filters, columns and a sort;
 * the rows always come from the list's own endpoint, with the viewer's role.
 */

import { apiRequest } from '@/lib/api/client';

import type { SavedList, SavedListObject, SavedListRequest, SavedLists } from '../types';

export function listSavedLists(objectType: SavedListObject): Promise<SavedLists> {
  return apiRequest<SavedLists>(`/onboarding/saved-lists?object_type=${objectType}`);
}

export function createSavedList(body: SavedListRequest): Promise<SavedList> {
  return apiRequest<SavedList>('/onboarding/saved-lists', { method: 'POST', body });
}

export function updateSavedList(id: string, body: SavedListRequest): Promise<SavedList> {
  return apiRequest<SavedList>(`/onboarding/saved-lists/${id}`, { method: 'PUT', body });
}

export function deleteSavedList(id: string): Promise<void> {
  return apiRequest<void>(`/onboarding/saved-lists/${id}`, { method: 'DELETE' });
}
