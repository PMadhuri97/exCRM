/**
 * The company page — **shell, owner: Developer 2**.
 *
 * A sticky summary header — who the company is and where it stands — over one
 * tab per part of the relationship. The selected tab is in the URL (`?tab=`),
 * so a link, a reload or the back button lands where the reader was.
 *
 * Each tab renders one owner's panel:
 *
 *   Overview           panels/CompanyPanel.tsx          Developer 2
 *   Qualification      panels/QualificationPanel.tsx    Developer 2
 *   Conversation       panels/ConversationPanel.tsx     Developer 3A
 *   Deals              panels/DealsPanel.tsx            Developer 3B
 *   Documents          panels/DocumentsPanel.tsx        Developer 3B
 *   Background check   panels/BackgroundCheckPanel.tsx  Developer 4
 *   History            components/HistoryTimeline.tsx   Developer 1
 *
 * **The contact and activity queries stay here, not in the Conversation
 * panel.** They start with the profile on the first render, so opening the
 * Conversation tab shows them at once rather than starting a second round trip
 * then. The activity pagination state stays with them.
 *
 * The header shows the company's three separate positions — journey,
 * qualification, marker — and offers only the marker moves the server listed.
 * The journey has no control: it is never moved by hand.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import {
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useSearchParamState,
} from '@/components';
import { formatDate } from '@/lib/format';
import { canReadUnderwriting, isStaffRole, useCurrentUser } from '@/platform/auth';

import {
  CompanyHistory,
  JourneyChip,
  LogCallDialog,
  MarkerBadge,
  MarkerControl,
  QualificationChip,
} from '../components';
import {
  useCompanyDeals,
  useExporterActivities,
  useExporterContacts,
  useExporterProfileDetail,
} from '../hooks';
import { COMPANY_TABS, paths, type CompanyTab } from '../paths';
import { rememberCompany } from '../recently-viewed';
import type { ExporterActivityType, ExporterProfileDetail } from '../types';
import { ActivityTimeline } from './panels/ActivityTimeline';
import { BackgroundCheckPanel } from './panels/BackgroundCheckPanel';
import { CompanySummaryCard } from './panels/CompanySummaryCard';
import { CompanyPanel } from './panels/CompanyPanel';
import { ConversationPanel } from './panels/ConversationPanel';
import { DealsPanel } from './panels/DealsPanel';
import { DocumentsPanel } from './panels/DocumentsPanel';
import { QualificationPanel } from './panels/QualificationPanel';

/** Rows per activity page. Lives here because the shell builds the query
 * params and decides whether a next page exists. */
const ACTIVITY_PAGE_SIZE = 8;

const TAB_LABEL: Record<CompanyTab, string> = {
  overview: 'Overview',
  activity: 'Activity',
  qualification: 'Qualification',
  conversation: 'Conversation',
  deals: 'Deals',
  documents: 'Documents',
  'background-check': 'Background check',
  history: 'History',
};

function displayName(profile: ExporterProfileDetail): string {
  return profile.name ?? 'Unnamed company';
}

export function ExporterDetailPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const currentUser = useCurrentUser();
  // DEVELOPER reads the CRM (masked) but writes nothing and cannot load
  // verification results — the backend refuses those with 403 — so it gets no
  // Background check tab at all rather than a tab that renders nothing. FINANCER
  // reads that tab (underwriting needs it); what it may change there is the
  // server's `allowed_moves` and `capabilities`, which offer it nothing.
  const isStaff = isStaffRole(currentUser.role);
  const canViewChecks = canReadUnderwriting(currentUser.role);
  const tabs = canViewChecks
    ? COMPANY_TABS
    : COMPANY_TABS.filter((value) => value !== 'background-check');
  const { data: profile, isLoading, isError, refetch } = useExporterProfileDetail(customerId);
  const [tab, setTab] = useSearchParamState<CompanyTab>('tab', tabs, 'overview');
  const [activityType, setActivityType] = useState<ExporterActivityType | ''>('');
  const [activityPage, setActivityPage] = useState(0);

  // Feeds the Companies list's "Recently viewed" bar (this browser only).
  useEffect(() => {
    if (profile) rememberCompany({ id: profile.customer_id, name: profile.name ?? 'Unnamed lead' });
  }, [profile]);

  const contactQuery = useExporterContacts(customerId);
  const activityParams = useMemo(
    () => ({
      activityType: activityType || undefined,
      limit: ACTIVITY_PAGE_SIZE,
      offset: activityPage * ACTIVITY_PAGE_SIZE,
    }),
    [activityType, activityPage],
  );
  const activityQuery = useExporterActivities(customerId, activityParams);
  const dealsQuery = useCompanyDeals(customerId);

  // ── The call pop-up (Centrex §6). `?call=primary` opens it on arrival — the
  // Companies list's Call action — and is then cleared, so a reload does not reopen.
  const [searchParams, setSearchParams] = useSearchParams();
  const [call, setCall] = useState<{ open: boolean; contactId: string | null }>({ open: false, contactId: null });
  const openCall = (contactId: string | null) => setCall({ open: true, contactId });
  useEffect(() => {
    if (searchParams.get('call') && profile && isStaff) {
      const contactsNow = contactQuery.data?.contacts ?? profile.contacts;
      const primary = contactsNow.find((c) => c.is_primary_contact) ?? contactsNow[0];
      setCall({ open: true, contactId: primary?.id ?? null });
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('call');
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, profile, isStaff, contactQuery.data, setSearchParams]);

  if (!customerId) {
    return <p className="text-sm text-status-failed">Company id is missing.</p>;
  }

  if (isLoading) {
    return (
      <div className="space-y-5" aria-label="Loading company">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-28 rounded-lg" />
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }

  if (isError || !profile) {
    return (
      <ErrorState title="Couldn't load this company." onRetry={() => void refetch()}>
        The record may no longer exist or the request failed.{' '}
        <Link to={paths.companies} className="font-medium text-brand-600 underline">
          Back to companies
        </Link>
      </ErrorState>
    );
  }

  // The detail response embeds contacts, so the page shows those until the
  // dedicated contacts query resolves — no empty flash on first paint.
  const contacts = contactQuery.data?.contacts ?? profile.contacts;
  const activities = activityQuery.data?.activities ?? [];
  const hasNextActivityPage = activities.length === ACTIVITY_PAGE_SIZE;
  const dealCount = dealsQuery.data?.total;

  return (
    // One `Tabs` root around the sticky header and the panels, so the triggers
    // and the contents share its ids (the tab <-> tabpanel wiring).
    <Tabs value={tab} onValueChange={(next) => setTab(next as CompanyTab)}>
      <div className="sticky -top-5 z-10 -mx-4 mb-5 border-b border-border bg-surface-subtle/95 px-4 pt-1 backdrop-blur sm:-top-6 sm:-mx-6 sm:px-6">
        <PageHeader
          back={{ to: paths.companies, label: 'Companies' }}
          title={displayName(profile)}
          meta={
            <>
              <JourneyChip journey={profile.journey} />
              <QualificationChip state={profile.qualification} />
              <MarkerBadge marker={profile.marker} reason={profile.marker_reason} />
            </>
          }
          description={
            <>
              Added {formatDate(profile.date_added)}
              {profile.marker_reason ? ` · ${profile.marker_reason}` : ''}
            </>
          }
          // Only the moves the server listed for this user; none, nothing.
          actions={
            <MarkerControl customerId={customerId} moves={profile.allowed_marker_moves ?? []} />
          }
        />

        <TabsList aria-label="Company sections" className="mt-3 border-b-0">
          {tabs.map((value) => (
            <TabsTrigger key={value} value={value}>
              {TAB_LABEL[value]}
              {value === 'deals' && dealCount !== undefined && dealCount > 0 && (
                <span className="rounded-full bg-surface-sunken px-1.5 text-xs tabular-nums text-ink-muted">
                  {dealCount}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-44 lg:self-start">
          <CompanySummaryCard
            profile={profile}
            contacts={contacts}
            canLogCalls={isStaff}
            canViewChecks={canViewChecks}
            onLogCall={openCall}
          />
        </div>
        <div className="min-w-0">
      <TabsContent value="overview">
        <CompanyPanel profile={profile} canEdit={isStaff} />
      </TabsContent>
      <TabsContent value="activity">
        <ActivityTimeline
          customerId={customerId}
          contacts={contacts}
          canLogCalls={isStaff}
          onLogCall={() => openCall(null)}
        />
      </TabsContent>
      <TabsContent value="qualification">
        <QualificationPanel customerId={customerId} />
      </TabsContent>
      <TabsContent value="conversation">
        <ConversationPanel
          customerId={customerId}
          contacts={contacts}
          contactsLoading={contactQuery.isLoading}
          activities={activities}
          activitiesLoading={activityQuery.isLoading}
          activitiesFetching={activityQuery.isFetching}
          activityType={activityType}
          onActivityTypeChange={setActivityType}
          activityPage={activityPage}
          onActivityPageChange={setActivityPage}
          hasNextActivityPage={hasNextActivityPage}
          isStaff={isStaff}
        />
      </TabsContent>
      <TabsContent value="deals">
        <DealsPanel customerId={customerId} isStaff={isStaff} />
      </TabsContent>
      <TabsContent value="documents">
        <DocumentsPanel customerId={customerId} isStaff={isStaff} />
      </TabsContent>
      <TabsContent value="background-check">
        <BackgroundCheckPanel customerId={customerId} canView={canViewChecks} />
      </TabsContent>
      <TabsContent value="history">
        <CompanyHistory customerId={customerId} />
      </TabsContent>
        </div>
      </div>

      {call.open && (
        <LogCallDialog
          key={call.contactId ?? 'none'}
          customerId={customerId}
          companyName={displayName(profile)}
          contacts={contacts}
          initialContactId={call.contactId}
          open={call.open}
          onOpenChange={(open: boolean) => setCall((current) => ({ ...current, open }))}
        />
      )}
    </Tabs>
  );
}
