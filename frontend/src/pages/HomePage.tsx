/**
 * Home — "my work": what is late, who is due a call back, and how the pipeline
 * stands. Replaces the placeholder dashboard.
 *
 * Built from routes that already exist: the key figures come from the deal
 * summary endpoint (build prompt chunk 0.5), and every number in it is the
 * server's — nothing is counted or invented here. The follow-up, check-back and
 * pipeline cards come from their own routes. All of it is the onboarding
 * module's, reached through its public facade.
 */

import { Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { buttonClasses, PageHeader } from '@/components';
import { humanize } from '@/lib/format';
import {
  CheckBacksDueCard,
  FollowUpsDueCard,
  KeyFigures,
  paths,
  PipelineSummaryCard,
} from '@/modules/onboarding';
import { isStaffRole, useCurrentUser } from '@/platform/auth';

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  const user = useCurrentUser();
  const firstName = user.full_name?.split(' ')[0];

  return (
    <div>
      <PageHeader
        title={`${greeting(new Date())}${firstName ? `, ${firstName}` : ''}`}
        description={`Signed in as ${humanize(user.role).toLowerCase()}. Here is what needs attention.`}
        actions={
          isStaffRole(user.role) && (
            <Link to={paths.newCompany} className={buttonClasses({ variant: 'primary' })}>
              <Plus size={15} />
              Add company
            </Link>
          )
        }
      />

      {/* Every role that reaches Home may read the summary (the CRM read roles). */}
      <KeyFigures linked className="mb-5" />

      <div className="grid gap-5 lg:grid-cols-2">
        <FollowUpsDueCard userId={String(user.id)} />
        <CheckBacksDueCard />
        <div className="lg:col-span-2">
          <PipelineSummaryCard />
        </div>
      </div>
    </div>
  );
}
