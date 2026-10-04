/**
 * Saved lists as tabs — build prompt chunk 3; Centrex §4 ("Dynamic List Builder").
 *
 * The lists sit beside the built-in tabs (stages on Deals, journeys on
 * Companies), never on a page of their own. Picking one applies its filters,
 * columns and sort to the very same table; the rows still come from the list's own
 * endpoint with the viewer's role, so masking is the viewer's, never the builder's.
 *
 * Every reader sees every list. "Save as list" is offered where the server says
 * this viewer may build one (`can_create`: ADMIN, DEVELOPER); "Update list" and
 * "Delete" where it says this viewer may change that list (`can_edit`: its
 * creator, or an ADMIN). The current view — filters, columns, sort — is what a
 * save captures, so the filter bar and Customize are the list builder.
 */

import { BookmarkPlus, ListChecks, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button, ConfirmDialog, Dialog, Field, Input } from '@/components';
import { cn } from '@/lib/cn';

import { useCreateSavedList, useDeleteSavedList, useSavedLists, useUpdateSavedList } from '../hooks';
import type { SavedList, SavedListObject, SavedListRequest } from '../types';

export type ListDefinition = Omit<SavedListRequest, 'name' | 'object_type'>;

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function SavedListTabs({
  objectType,
  activeId,
  onSelect,
}: {
  objectType: SavedListObject;
  activeId: string | null;
  onSelect: (list: SavedList) => void;
}) {
  const lists = useSavedLists(objectType).data?.lists ?? [];
  if (lists.length === 0) return null;
  return (
    <div role="group" aria-label="Saved lists" className="flex flex-wrap items-center gap-1">
      <span className="ml-1 mr-0.5 h-4 w-px bg-border" aria-hidden />
      {lists.map((list) => (
        <button
          key={list.id}
          type="button"
          aria-pressed={list.id === activeId}
          onClick={() => onSelect(list)}
          title={list.created_by_name ? `Built by ${list.created_by_name}` : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[13px] font-medium transition-colors',
            list.id === activeId
              ? 'border-brand-500 bg-surface text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          <ListChecks size={13} className="text-ink-faint" />
          {list.name}
        </button>
      ))}
    </div>
  );
}

export function SavedListActions({
  objectType,
  active,
  currentDefinition,
  onSaved,
  onDeleted,
}: {
  objectType: SavedListObject;
  active: SavedList | null;
  /** The view as it stands — what a save captures. */
  currentDefinition: () => ListDefinition;
  onSaved: (list: SavedList) => void;
  onDeleted: () => void;
}) {
  const query = useSavedLists(objectType);
  const create = useCreateSavedList(objectType);
  const update = useUpdateSavedList(objectType);
  const remove = useDeleteSavedList(objectType);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const canCreate = query.data?.can_create ?? false;
  const canEdit = active?.can_edit ?? false;
  if (!canCreate && !canEdit) return null;

  async function saveAs() {
    try {
      const saved = await create.mutateAsync({ name: name.trim(), object_type: objectType, ...currentDefinition() });
      toast.success(`Saved “${saved.name}” — everyone can see it`);
      setNaming(false);
      setName('');
      onSaved(saved);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save the list'));
    }
  }

  async function saveChanges() {
    if (!active) return;
    try {
      const saved = await update.mutateAsync({
        id: active.id,
        body: { name: active.name, object_type: objectType, ...currentDefinition() },
      });
      toast.success(`Updated “${saved.name}”`);
      onSaved(saved);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not update the list'));
    }
  }

  async function deleteList() {
    if (!active) return;
    try {
      await remove.mutateAsync(active.id);
      toast.success(`Deleted “${active.name}”`);
      setConfirmingDelete(false);
      onDeleted();
    } catch (error) {
      toast.error(errorMessage(error, 'Could not delete the list'));
    }
  }

  return (
    <>
      {canCreate && (
        <Button size="sm" variant="ghost" onClick={() => setNaming(true)} title="Save these filters, columns and sort as a list everyone can open">
          <BookmarkPlus size={15} />
          Save as list
        </Button>
      )}
      {canEdit && active && (
        <>
          <Button size="sm" variant="ghost" onClick={() => void saveChanges()} loading={update.isPending} title={`Save the current view into “${active.name}”`}>
            <Save size={15} />
            Update list
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)} aria-label={`Delete list ${active.name}`}>
            <Trash2 size={15} />
          </Button>
        </>
      )}

      <Dialog
        open={naming}
        onOpenChange={setNaming}
        title="Save as list"
        description="The current filters, columns and sort become a tab everyone can open. Each person still sees only what their role allows."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => void saveAs()}>
              Save list
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void saveAs();
          }}
        >
          <Field label="List name" htmlFor="saved-list-name">
            <Input id="saved-list-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ready to fund" />
          </Field>
        </form>
      </Dialog>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Delete “${active?.name ?? ''}”?`}
        description="The tab goes for everyone. Nothing in the list is deleted — it only ever held filters."
        confirmLabel="Delete list"
        confirmVariant="danger"
        loading={remove.isPending}
        onConfirm={() => void deleteList()}
      />
    </>
  );
}
