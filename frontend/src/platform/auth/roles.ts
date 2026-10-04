/**
 * Which roles do what — the one client-side copy of the backend's role
 * groups (`_STAFF` and friends in `onboarding/api/router.py`).
 *
 * The server enforces every one of these; the screen only uses them to hide a
 * control the server would refuse. An allowlist, never `role !== 'DEVELOPER'`:
 * a denylist lets through any role nobody thought of, `API_USER` included.
 */

import type { UserRole } from '@/lib/api/types';

/** OPERATIONS, COMPLIANCE and ADMIN: create, edit and move things in the CRM. */
export function isStaffRole(role: UserRole): boolean {
  return role === 'OPERATIONS' || role === 'COMPLIANCE' || role === 'ADMIN';
}

/**
 * Staff and FINANCER: may read the background check, screening and verification
 * results — what an underwriting view needs. FINANCER (underwriter and financier,
 * one role) reads them and changes nothing; DEVELOPER is refused them (D8).
 */
export function canReadUnderwriting(role: UserRole): boolean {
  return isStaffRole(role) || role === 'FINANCER';
}

/** ADMIN only: qualification criteria and RXIL intake. */
export function isAdminRole(role: UserRole): boolean {
  return role === 'ADMIN';
}
