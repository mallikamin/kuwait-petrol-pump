import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, GitBranch } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { authApi } from '@/api/auth';
import { useAuthStore } from '@/store/auth';

const ALL_BRANCHES = '__all__';

/**
 * Org + branch switcher rendered in the top bar.
 *
 * Visibility rules:
 *  - Hidden entirely when the user has access to one org AND that org has
 *    one branch (no switching is meaningful).
 *  - Org dropdown shown when accessibleOrgs.length > 1.
 *  - Branch dropdown shown when the active org has more than one branch.
 *
 * Switching either dropdown updates the auth store (which the API client
 * reads on every request) and invalidates the React Query cache so all
 * data reloads scoped to the new context.
 */
export function OrgBranchSwitcher() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const accessibleOrgs = useAuthStore((s) => s.accessibleOrgs);
  const setAccessibleOrgs = useAuthStore((s) => s.setAccessibleOrgs);
  const activeOrgId = useAuthStore((s) => s.activeOrgId);
  const activeBranchId = useAuthStore((s) => s.activeBranchId);
  const setActiveOrg = useAuthStore((s) => s.setActiveOrg);
  const setActiveBranch = useAuthStore((s) => s.setActiveBranch);

  // Fetch accessible orgs once after login. We don't refetch on every mount
  // because the list is admin-curated and rarely changes within a session.
  const { data } = useQuery({
    queryKey: ['accessible-orgs'],
    queryFn: () => authApi.getAccessibleOrgs(),
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (data?.orgs) {
      setAccessibleOrgs(data.orgs);
    }
  }, [data, setAccessibleOrgs]);

  const activeOrg = accessibleOrgs.find((o) => o.id === activeOrgId) ?? null;
  const showOrg = accessibleOrgs.length > 1;
  // Render the branch dropdown alongside the org dropdown for cross-org users
  // even when the active org has a single branch — it makes the active scope
  // obvious and stays consistent across orgs as branches are added.
  // Single-org users never see either dropdown (no rows in user_org_access).
  const showBranch = showOrg && (activeOrg?.branches.length ?? 0) >= 1;

  if (!showOrg && !showBranch) return null;

  const handleOrgChange = (orgId: string) => {
    setActiveOrg(orgId);
    // React Query reads org-scoped data; bust the cache so every page refetches.
    queryClient.invalidateQueries();
  };

  const handleBranchChange = (branchId: string) => {
    setActiveBranch(branchId === ALL_BRANCHES ? null : branchId);
    queryClient.invalidateQueries();
  };

  return (
    <div className="flex items-center gap-2">
      {showOrg && (
        <Select value={activeOrgId ?? undefined} onValueChange={handleOrgChange}>
          <SelectTrigger className="h-9 w-[200px]">
            <div className="flex items-center gap-2 overflow-hidden">
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Organization" />
            </div>
          </SelectTrigger>
          <SelectContent>
            {accessibleOrgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
                {o.code ? ` (${o.code})` : ''}
                {o.isPrimary ? ' • primary' : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showBranch && activeOrg && (
        <Select value={activeBranchId ?? ALL_BRANCHES} onValueChange={handleBranchChange}>
          <SelectTrigger className="h-9 w-[180px]">
            <div className="flex items-center gap-2 overflow-hidden">
              <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Branch" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_BRANCHES}>All Branches</SelectItem>
            {activeOrg.branches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
                {b.code ? ` (${b.code})` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
