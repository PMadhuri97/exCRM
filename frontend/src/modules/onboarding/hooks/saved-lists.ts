/** React Query hooks for saved lists — build prompt chunk 3. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createSavedList, deleteSavedList, listSavedLists, updateSavedList } from '../api';
import type { SavedListObject, SavedListRequest } from '../types';

export function useSavedLists(objectType: SavedListObject) {
  return useQuery({ queryKey: ['savedLists', objectType], queryFn: () => listSavedLists(objectType) });
}

function useListWrite<Vars, Result>(objectType: SavedListObject, write: (vars: Vars) => Promise<Result>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['savedLists', objectType] }),
  });
}

export function useCreateSavedList(objectType: SavedListObject) {
  return useListWrite(objectType, (body: SavedListRequest) => createSavedList(body));
}

export function useUpdateSavedList(objectType: SavedListObject) {
  return useListWrite(objectType, ({ id, body }: { id: string; body: SavedListRequest }) =>
    updateSavedList(id, body),
  );
}

export function useDeleteSavedList(objectType: SavedListObject) {
  return useListWrite(objectType, (id: string) => deleteSavedList(id));
}
