/**
 * Deals — **owner: Developer 3B** (architecture §9.3, L3-05, L3-06, L3-11b).
 *
 * The company's deal list, the control that opens one, and the way through to
 * a deal. Shown on the company page's Deals tab.
 *
 * **The stage is shown, never chosen here.** A deal moves on `DealDetailPage`,
 * which asks the server which moves it may offer (`allowed_stage_moves`). A list
 * is a place to see and to navigate.
 *
 * **The rows are the Deals table, scoped to this company** (build prompt chunk
 * 1.5): the same component and the same server read as the global list, filtered
 * by `company_id` — not a second list implementation. The company's own columns
 * (its name, journey and background check) are left out: this page already says
 * them. Whether a deal may be opened here still comes from the company's own deal
 * route (`can_open_deal`).
 */

import { FileText, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';

import { Button, buttonClasses, EmptySection, Panel, Skeleton } from '@/components';

import { DEAL_COLUMNS, DealsTable, OpenDealForm, type DealsSort } from '../../components';
import { useCompanyDeals, useDealQueue } from '../../hooks';
import { paths } from '../../paths';

/** The deal columns worth showing inside one company's page. */
const SCOPED_COLUMNS = DEAL_COLUMNS.filter((column) =>
  ['reference', 'buyer', 'stage', 'amount', 'created_at', 'updated_at'].includes(column.id),
);

export function DealsPanel({
  customerId,
  isStaff,
}: {
  customerId: string;
  isStaff: boolean;
}) {
  const [opening, setOpening] = useState(false);
  const [sort, setSort] = useState<DealsSort>({ sort: 'created_at', order: 'desc' });
  // The same query the company page makes for its tab count — no extra request.
  const { data } = useCompanyDeals(customerId);
  const queue = useDealQueue({ companyId: customerId, sort: sort.sort, order: sort.order, limit: 100 });
  const deals = queue.data?.deals ?? [];
  const { isLoading, isError } = queue;
  // The server says whether this viewer may open a deal here (§7.5): a staff role,
  // and a company that is a PROSPECT or CUSTOMER — a LEAD is refused.
  const canOpen = data?.can_open_deal ?? false;

  return (
    <Panel
      title="Deals"
      description="What this company wants financed. A company may have any number, over time and at once."
      actions={
        <>
          <Link to={paths.company(customerId, 'documents')} className={buttonClasses({ size: 'sm' })}>
            <FileText size={14} />
            Company documents
          </Link>
          {/* Offered only where the server would accept it: never to DEVELOPER, and
              never on a LEAD. */}
          {canOpen && !opening && (
            <Button size="sm" variant="primary" onClick={() => setOpening(true)}>
              <Plus size={14} /> Open a deal
            </Button>
          )}
        </>
      }
    >
      {opening && <OpenDealForm customerId={customerId} onClose={() => setOpening(false)} />}

      {isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-12 rounded-lg" />
        </div>
      )}

      {isError && <p className="text-sm text-status-failed">Could not load this company's deals.</p>}

      {!isLoading && !isError && deals.length === 0 && (
        <EmptySection>
          No deals yet.
          {canOpen ? ' Open one when this company has something to finance.' : ''}
          {isStaff && !canOpen ? ' A deal can be opened once the company has been qualified.' : ''}
        </EmptySection>
      )}

      {deals.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <DealsTable
            rows={deals}
            columns={SCOPED_COLUMNS}
            sort={sort}
            onSortChange={setSort}
            empty="No deals yet."
          />
        </div>
      )}
    </Panel>
  );
}
