import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';

/**
 * Returns the branch the current request should be scoped to:
 *   activeBranchId (from the org/branch switcher)
 *   ?? user.branch_id (the JWT default for single-branch users)
 *   ?? ''
 *
 * Single-org users have no switcher, so activeBranchId stays NULL and this
 * collapses to user.branch_id — byte-identical to legacy behavior.
 */
export function useEffectiveBranchId(): string {
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const userBranchId = useAuthStore((s) => s.user?.branch_id);
  return activeBranchId || userBranchId || '';
}

/**
 * Fires `onOrgSwitch` whenever the active organization changes (NOT on first
 * mount). Use to clear page-local state — e.g. a stale `selectedBranchId`
 * holding a UUID from the previous org — when the user switches via the
 * top-bar dropdown.
 */
export function useOnOrgSwitch(onOrgSwitch: () => void) {
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const previousOrgIdRef = useRef<string | null>(activeOrgId);

  useEffect(() => {
    if (previousOrgIdRef.current !== null && previousOrgIdRef.current !== activeOrgId) {
      onOrgSwitch();
    }
    previousOrgIdRef.current = activeOrgId;
    // onOrgSwitch is intentionally excluded — callers don't memoize it and we
    // only care about the activeOrgId change, not callback identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);
}
